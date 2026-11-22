# Stage 5.1 Handover — Migration Recovery and Security Verification

## Scope and status

Work was continued on `stage5-1-migration-recovery`, starting at `49f0da016ab744886f43dd13d5df7656b84b8b21`. This handover covers migration-source recovery, a separate security-hardening migration, disposable-database replay and regression checks, application checks, and preview metadata. No Stage 6 work was started.

The authorized Supabase project `txeobytsmfjbweoyetqh` was queried read-only and remained `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.166. Its migration ledger still contains exactly the ten versions in the table below. No migration was applied, no production data or schema was modified, and no database reset, drop, truncate, or recreation was performed against Supabase. The only database created or recreated during this work was the disposable local `stage51_test` database on PostgreSQL 16 at `127.0.0.1:55432`.

## Migration provenance and replay order

The active `supabase/migrations/` directory now contains the ten exact SQL sources recovered from the authorized Supabase ledger, followed by one separately named Stage 5.1 security migration. Each of the ten recovered source files matches its ledger statement's recorded SHA-256 and byte length; source bytes were not normalized. The new security migration is not in the live ledger and has not been applied remotely.

| Version | Active migration | Provenance |
|---|---|---|
| `20260828080413` | `initial_platform_foundation` | Exact ledger statement |
| `20261122000606` | `business_onboarding` | Exact ledger statement |
| `20261122001735` | `transactions` | Exact ledger statement; matched the old `0006_transactions.sql` byte-for-byte |
| `20261122014214` | `stage_4_financial_ledger` | Exact ledger statement |
| `20261122015151` | `stage4_1_dashboard_access_hardening` | Exact ledger statement |
| `20261122021128` | `stage_5_expenses_schema` | Exact ledger statement recovered from the ledger |
| `20261122021143` | `stage_5_expenses_recording_rpc` | Exact ledger statement recovered from the ledger |
| `20261122021155` | `stage_5_expenses_workflow_rpc` | Exact ledger statement recovered from the ledger |
| `20261122081505` | `stage5_expense_cashbook_read_rpcs` | Exact ledger statement; the old numbered file had an additional revoke absent from the ledger |
| `20261122081656` | `stage5_rpc_access_hardening` | Exact ledger statement |
| `20261122090128` | `stage5_1_tenant_idempotency_and_rpc_security` | New Stage 5.1 security migration; not yet applied to Supabase |

All nine files from the original Stage 5 commit were copied byte-for-byte to `supabase/legacy_migrations/`, with checksums recorded in that directory's README. This keeps provenance and prior work intact while preventing old numbered filenames from being mistaken for the authoritative remote migration history. In particular, the old `0005` differed from the ledger source in comments/newline, `0007` and `0009` differed by final newline, and `0008` carried an extra `anon` revoke. Historical corrections were not silently folded into those files; the active files now use the ledger bytes.

The live ledger does not contain entries corresponding to the archived repository migrations `0001`–`0004`, although read-only schema inspection found live profile/payment objects and policies corresponding to some of those repository-era changes. Their exact committed SQL is preserved in the archive, but they have not been assigned synthetic versions or inserted into the active migration path. This is a real migration-history/schema drift: replaying the active ledger-recovered history reconstructs the ten recorded migrations, but does not by itself recreate every repository-only payment/auth object observed live. Do not run a production migration push/reset or claim full production-schema reproducibility until that drift has been reconciled deliberately.

## Security changes in the separate Stage 5.1 migration

The new migration is based on the exact ledger function definitions and changes only the affected functions and ACLs. It adds an explicit booth-to-business existence check in `record_expense` and hardens `can_operate_booth` to require the booth to belong to the submitted business before checking active membership/role. A booth ID from another business now fails before any expense is recorded.

The idempotency collision paths in `record_expense`, `reverse_expense`, `post_momo_transaction`, and `reverse_momo_transaction` now return identifiers only for a matching same-business/same-booth target operation. Expense recording additionally requires the same actor and matching request payload for a replay. A key already used for a different tenant, booth, target, or posting kind fails with the generic SQLSTATE `23505` message `Idempotency key conflict`; the conflicting record's IDs and references are not returned. Same-target retries remain idempotent. The transaction posting/reversal workflows retain their existing membership/owner authorization checks and ledger posting behavior.

Stage 4 `financial_dashboard`, `post_momo_transaction`, and `reverse_momo_transaction` retain `authenticated` and `service_role` execute access while `PUBLIC` and `anon` access is revoked. `financial_account_id`, which has no repository caller and has no authorization guard, is revoked from `PUBLIC`, `anon`, and `authenticated`, while trusted `service_role` access is retained. `can_operate_booth` and the default reference generator retain authenticated/server execution but lose `PUBLIC` and anonymous execution. The migration also removes the broad `profiles_update_own` policy, whose permissive update rule overlapped the safe-field policy, and installs a safe profile update policy that prevents a normal user from changing their own role while allowing safe fields and admin updates.

The changes above are local migration content only. The production ACL recheck still shows the legacy Stage 4 RPCs and unguarded helper executable by `anon`; that state will remain until a separately approved database migration is applied. No such application was performed as part of this task.

## Verification results

A fresh empty disposable database on the isolated local PostgreSQL 16 cluster was used to replay all ten recovered ledger migrations in lexical version order, then the new Stage 5.1 migration. Replay completed successfully with stop-on-error enabled. The minimal local bootstrap provided Supabase-compatible `anon`, `authenticated`, and `service_role` roles, an `auth.users` fixture, and `auth.uid()`. A test-only profile table grant mirrored Supabase platform grants; it is not part of the committed migration or production.

The isolated SQL regression suite passed these checks:

- A booth owned by Business B was rejected when submitted under Business A.
- Cross-business idempotency collisions for transaction posting, transaction reversal, expense recording, and expense reversal returned only the generic conflict; no foreign posting/expense identifiers or references were returned.
- Same-tenant expense and transaction posting retries returned the same operation metadata and did not create duplicate postings.
- Transaction and expense reversals replayed idempotently; test cash and float balances returned to their original values exactly once.
- Direct `ledger_entries` reads under authenticated Business A and Business B identities returned no rows from the other business in either direction.
- Owner A could read its own dashboard, but not Business B's; owner B was blocked from posting or reversing Business A's transaction. An assigned attendant could access its booth dashboard but not the business-wide dashboard.
- Anonymous execution was denied for the three inherited Stage 4 financial RPCs; authenticated and `service_role` execution remained allowed. `financial_account_id` was denied to `anon` and `authenticated`, while trusted `service_role` execution remained allowed.
- Safe profile display-name update remained allowed, while a normal user's role escalation to `administrator` was rejected.
- RLS remained enabled on the inspected profile, business, booth, transaction, posting, ledger, account, and expense tables.

These are local PostgreSQL behavior tests. They do not constitute a live Supabase acceptance test, a concurrency/stress test, or a test of every owner/attendant workflow in the hosted application. Business-wide financial table policies and the expense status-history policy currently allow active members to read business-scoped rows more broadly than assigned-booth scope; no cross-business access was observed. Whether booth-level visibility should be narrower is an open product/security decision and was not broadened or silently changed here.

## Application and preview verification

The repository provides `lint`, `build`, `start`, and `dev` scripts but no `test` script or checked-in automated application test suite. Final post-change checks passed: `npm run lint` (two warnings remain: missing `load` dependencies in `app/setup/page.tsx:50` and `app/transactions/page.tsx:13`), `npx tsc --noEmit`, and `npm run build`. The local SQL regression suite above is the only automated test suite available in the repository context; no application tests are claimed.

Read-only Vercel metadata confirms the existing preview deployment `dpl_946Sr4dgikJbs6B3zEBSbfY4fadw` is `READY` at `https://ghanaian-creator-streaming-nyv85frfy.vercel.app`, from branch `stage5-expenses-cashbook` and commit `49f0da016ab744886f43dd13d5df7656b84b8b21`. This continuation verified deployment metadata only. The previous session reported that SSO prevented unauthenticated page-content verification; no share/bypass link or protection change was created. The recovery branch preview is a separate deployment check to make after the branch is pushed.

## Remaining caveats and handover

The Stage 5.1 migration has passed a clean local replay, but it has not been applied to the hosted database. Production remains in the previously observed ACL state until a separately reviewed application. The payment/auth migration drift also means the current active migration set is not a complete reproduction of every object found in the live schema. The archived numbered SQL remains available for source comparison and is not an instruction to reapply it.

No Vercel production promotion, Supabase production migration, force-push, or Stage 6 work is included in this handover. The requested commit subject is `Stage 5.1: Recover migrations and verify deployment`; the branch should be pushed only to `stage5-1-migration-recovery` after final checks pass. The new recovery-branch preview status will be recorded after push; existing preview page contents remain unverified because of the SSO barrier.
