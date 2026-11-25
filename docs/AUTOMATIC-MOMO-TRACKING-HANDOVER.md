# Automatic MoMo tracking handover

## What is implemented

This branch is based on the supplied upgraded Vercel deployment branch `momo-transaction-experience` at commit `280a66f`. It adds a separate Android companion module under `android/` and a non-destructive Supabase migration named `20261124030000_automatic_momo_tracking.sql`.

The companion uses Android `NotificationListenerService` only after the user grants notification access. It requires provider package names to be explicitly entered by the user, parses only selected MTN, Telecel/Vodafone, and AT Money notification text, stores evidence in a Keystore-backed encrypted local outbox, and retries synchronization when connectivity returns. Every event has a deterministic event key and is inserted through an authenticated Supabase RPC with a unique `(business_id, device_id, event_key)` constraint. The authenticated access token, workspace settings, provider allowlist, and local evidence are also kept in encrypted Android preferences.

The web control-plane pages are `/automatic-tracking` and `/automatic-tracking/review`. The review inbox loads only the signed-in user's business alerts and candidate pending transactions. It explains match reasons, blocks confirmation for pending/failed/reversed/unknown provider outcomes, and requires an explicit operator confirmation before calling the database confirmation RPC.

The `automatic_alert_review` migration adds `observed_status`, review history, `confirm_momo_alert`, and `reject_momo_alert`. Confirmation locks both records, verifies business, booth, network, type, amount, provider reference, and current status, marks the transaction manually confirmed, marks the alert confirmed, records review history, and invokes the existing guarded financial posting RPC in the same transaction. If posting fails, the confirmation rolls back.

## Deliberate safety boundary

The parser produces evidence, not a successful financial record. Missing amounts, types, references, or provider identity lower confidence and require review. The migration never creates a `transactions` row and never changes a transaction status. A later authenticated review flow must match an alert to an existing transaction or create a manual transaction using the existing business rules. Only an already confirmed transaction may flow into financial calculations.

The notification listener is not an SMS-permission workaround. It does not request `READ_SMS`, `RECEIVE_SMS`, or call-log permissions. It also does not read arbitrary notifications: the user must supply the provider app package names. This avoids silently broad monitoring, but means the user must know the installed provider app package and that some provider apps may not publish transaction alerts as notifications.

## Genuine limitations and approvals

A web browser cannot read a phone's SMS inbox or run a reliable background monitor. Android's official default-handler guidance and Google Play's sensitive-permission policy make SMS access a regulated product decision. This branch therefore uses notification access as a separate, consented signal source; it does not represent it as SMS access and does not guarantee that every provider alert is exposed through notifications.

MTN's official developer portal documents collection, transfer, refund, notification, status, and balance APIs, but provider onboarding is required and the inspected material does not establish a general agent-SMS or agent-statement feed. Telecel's public official pages inspected provide merchant registration and an authenticated agent portal, not a public agent statement API. AT Money's official terms mention confirmation SMS messages and mini statements, but the inspected public source does not document a public agent API. No unofficial integration is claimed here.

A production Play release still needs a signed Android build, a privacy policy, data-safety declarations, device testing, and a decision about whether notification access is acceptable for the final distribution channel. Provider API/webhook onboarding remains outstanding for authoritative server-side confirmation.

## Test status

Static repository validation was run against the upgraded web project before this branch was changed. The Android SDK, `adb`, Gradle, and Kotlin compiler were not available in the sandbox, so no APK was built and no physical Android device test was performed. The required tests remain: representative anonymized alerts for all three providers; duplicates and offline replay; notification removal; missing fields; failed and reversal wording; background operation under Android battery restrictions; sync authentication failures; and end-to-end review-to-ledger confirmation on a real device and Supabase project.

The migration is now applied to Supabase project `txeobytsmfjbweoyetqh` as `automatic_momo_tracking`, followed by `automatic_momo_tracking_device_id_fix` and `automatic_alert_review`. The ingestion RPC was tested under the `authenticated` database role with an active owner context and returned `REVIEW_REQUIRED` without creating a transaction. A duplicate replay returned the same event, an unauthorized non-member was rejected by RLS, and all test transactions were rolled back; no test events remain in the database. A full rolled-back confirmation test changed a temporary pending MTN deposit to `SUCCESSFUL`, set `MANUALLY_CONFIRMED`, inherited the provider reference, created one posting, and marked the alert `CONFIRMED`. A pending alert was rejected by the confirmation guard and produced zero postings. The web lint/build passes with only three pre-existing hook warnings in unrelated pages. No Vercel project was repointed: the existing project `momo-ledger` is already linked to `Emmanuel9535/momo-ledger`, which is the repository and branch serving the supplied deployment. The automatic-tracking commit was nevertheless deployed to the existing Vercel production target after a successful Next.js build.

## Official references

[1]: https://support.google.com/googleplay/android-developer/answer/10208820?hl=en "Google Play SMS and Call Log permissions policy"
[2]: https://developer.android.com/guide/topics/permissions/default-handlers "Android default handlers and sensitive permissions"
[3]: https://developer.android.com/reference/android/service/notification/NotificationListenerService "Android NotificationListenerService reference"
[4]: https://momodeveloper.mtn.com/ "MTN MoMo developer portal"
[5]: https://telecel.com.gh/personal/telecel-cash/merchant-registration/ "Telecel Ghana merchant registration"
[6]: https://telecel.com.gh/agent/login/ "Telecel Ghana agent portal"
[7]: https://www.at.com.gh/learn-more/-terms-%26-conditions-for-atmoney "AT Money terms and conditions"

## Daily fresh openings

The daily-opening workflow is available at `/opening` and is linked from reconciliation as **Fresh opening**. It uses the append-only `daily_openings` table with one record per booth and business date, storing physical cash plus MTN, Telecel, and AT float in pesewas. This is deliberately separate from the immutable onboarding tables `business_opening_balances` and `booth_opening_balances`, so recording today cannot overwrite yesterday's opening or a historical close.

An owner or booth-assigned active agent can create an opening for the booth they are authorised to use. The same authenticated workflow can edit that booth/date record when a handover count or booth assignment was entered incorrectly. Updates are performed through `update_daily_opening`, preserve the operating date, enforce non-negative balances and booth membership, and write the previous values to `daily_opening_edit_history` before changing the current record. There is no delete path. Reconciliation remains a separate close process; the opening page displays historical daily openings, while reconciliation preserves its own cutoff-based expected values and approval lock.

The daily-opening migration was applied to Supabase project `txeobytsmfjbweoyetqh` as `daily_openings`, followed by `editable_daily_openings` and a corrective function-definition migration. Metadata verification confirmed the table RPCs exist with the expected signatures. The web lint/build passes; the repository retains the three pre-existing hook warnings in reports, sales, and setup.
