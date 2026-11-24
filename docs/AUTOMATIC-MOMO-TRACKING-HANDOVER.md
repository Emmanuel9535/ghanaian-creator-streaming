# Automatic MoMo tracking handover

## What is implemented

This branch is based on the supplied upgraded Vercel deployment branch `momo-transaction-experience` at commit `280a66f`. It adds a separate Android companion module under `android/` and a non-destructive Supabase migration named `20261124030000_automatic_momo_tracking.sql`.

The companion uses Android `NotificationListenerService` only after the user grants notification access. It requires provider package names to be explicitly entered by the user, parses only selected MTN, Telecel/Vodafone, and AT Money notification text, stores evidence in a Keystore-backed encrypted local outbox, and retries synchronization when connectivity returns. Every event has a deterministic event key and is inserted through an authenticated Supabase RPC with a unique `(business_id, device_id, event_key)` constraint. The authenticated access token, workspace settings, provider allowlist, and local evidence are also kept in encrypted Android preferences.

The web control-plane page is `/automatic-tracking`. It describes the review-first behavior and does not claim that provider APIs or automatic success posting exist.

## Deliberate safety boundary

The parser produces evidence, not a successful financial record. Missing amounts, types, references, or provider identity lower confidence and require review. The migration never creates a `transactions` row and never changes a transaction status. A later authenticated review flow must match an alert to an existing transaction or create a manual transaction using the existing business rules. Only an already confirmed transaction may flow into financial calculations.

The notification listener is not an SMS-permission workaround. It does not request `READ_SMS`, `RECEIVE_SMS`, or call-log permissions. It also does not read arbitrary notifications: the user must supply the provider app package names. This avoids silently broad monitoring, but means the user must know the installed provider app package and that some provider apps may not publish transaction alerts as notifications.

## Genuine limitations and approvals

A web browser cannot read a phone's SMS inbox or run a reliable background monitor. Android's official default-handler guidance and Google Play's sensitive-permission policy make SMS access a regulated product decision. This branch therefore uses notification access as a separate, consented signal source; it does not represent it as SMS access and does not guarantee that every provider alert is exposed through notifications.

MTN's official developer portal documents collection, transfer, refund, notification, status, and balance APIs, but provider onboarding is required and the inspected material does not establish a general agent-SMS or agent-statement feed. Telecel's public official pages inspected provide merchant registration and an authenticated agent portal, not a public agent statement API. AT Money's official terms mention confirmation SMS messages and mini statements, but the inspected public source does not document a public agent API. No unofficial integration is claimed here.

A production Play release still needs a signed Android build, a privacy policy, data-safety declarations, device testing, and a decision about whether notification access is acceptable for the final distribution channel. Provider API/webhook onboarding remains outstanding for authoritative server-side confirmation.

## Test status

Static repository validation was run against the upgraded web project before this branch was changed. The Android SDK, `adb`, Gradle, and Kotlin compiler were not available in the sandbox, so no APK was built and no physical Android device test was performed. The required tests remain: representative anonymized alerts for all three providers; duplicates and offline replay; notification removal; missing fields; failed and reversal wording; background operation under Android battery restrictions; sync authentication failures; and end-to-end review-to-ledger confirmation on a real device and Supabase project.

The migration was not applied to Supabase in this session. It must be reviewed and applied through the project's migration process before the companion can synchronize. No Vercel project was repointed: the existing project `momo-ledger` is already linked to `Emmanuel9535/momo-ledger`, which is the repository and branch serving the supplied deployment. The automatic-tracking commit was nevertheless deployed to the existing Vercel production target after a successful Next.js build.

## Official references

[1]: https://support.google.com/googleplay/android-developer/answer/10208820?hl=en "Google Play SMS and Call Log permissions policy"
[2]: https://developer.android.com/guide/topics/permissions/default-handlers "Android default handlers and sensitive permissions"
[3]: https://developer.android.com/reference/android/service/notification/NotificationListenerService "Android NotificationListenerService reference"
[4]: https://momodeveloper.mtn.com/ "MTN MoMo developer portal"
[5]: https://telecel.com.gh/personal/telecel-cash/merchant-registration/ "Telecel Ghana merchant registration"
[6]: https://telecel.com.gh/agent/login/ "Telecel Ghana agent portal"
[7]: https://www.at.com.gh/learn-more/-terms-%26-conditions-for-atmoney "AT Money terms and conditions"
