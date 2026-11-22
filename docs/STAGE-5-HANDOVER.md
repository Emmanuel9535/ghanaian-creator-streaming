# Stage 5 Handover — Expenses and Cashbook

## Scope and source

Implemented on branch `stage5-expenses-cashbook`, based on Stage 4.1 commit `66555ba31608cb53a9b39b4d055b7eddf02f839a` (`stage4-1`). This handover covers the expenses workflow, expense dashboard, and ledger-backed cashbook. No production deployment or promotion was performed.

## Delivered

- `/expenses` now supports expense recording against configured financial accounts, attendant submissions, owner approval/rejection and reversal, category management, status/audit history, filtering and pagination, and owner summaries.
- `/cashbook` reads a bounded page of movements from the ledger, with account, booth, type and date filters; it includes opening-balance records and does not fetch the complete history into the browser.
- `expense_dashboard_summary` and `cashbook_page` are security-definer read RPCs with explicit business/owner/booth authorization and bounded cashbook page sizes.
- Expenses use the existing atomic ledger workflow; the frontend does not update financial balances directly.
- Receipt upload remains disabled. No private receipt bucket and supporting storage policies were present, so the UI does not upload or expose private receipt files.

## Supabase migrations

Project: `txeobytsmfjbweoyetqh`.

The live project already had these Stage 5 migrations applied before this repository work: `20261122021128 stage_5_expenses_schema`, `20261122021143 stage_5_expenses_recording_rpc`, and `20261122021155 stage_5_expenses_workflow_rpc`. Their SQL source files were not present in the Stage 4.1 Git branch; that source/reproducibility gap should be resolved before treating a fresh-project replay as supported.

This branch adds and applied:

- `0008_stage5_expense_cashbook_read_rpcs.sql` (live migration `20261122081505 stage5_expense_cashbook_read_rpcs`): authorized expense summary and bounded, ledger-backed cashbook read models.
- `0009_stage5_rpc_access_hardening.sql` (live migration `20261122081656 stage5_rpc_access_hardening`): removes `PUBLIC`/`anon` execute access from the user-facing Stage 5 RPCs and the report RPCs; explicitly leaves the internal `_post_expense_locked` helper inaccessible to `PUBLIC`, `anon`, `authenticated`, and `service_role`.

## Security and consistency verification

A live PostgreSQL privilege query confirmed `anon_can_execute=false` for `expense_dashboard_summary`, `cashbook_page`, `record_expense`, `approve_expense`, `reject_expense`, `reverse_expense`, and `_post_expense_locked`. The first six retain `authenticated_can_execute=true`; the internal posting helper has `authenticated_can_execute=false`. The report/workflow RPCs are `SECURITY DEFINER` with `search_path=public` and perform business/owner/booth checks. `_post_expense_locked` is intended to be called only by the authorized security-definer workflow functions.

RLS is enabled on `expenses`, `expense_categories`, and `expense_status_history`. Live policy inspection confirmed that expense/history reads are limited to active business membership and the owner's business or the attendant's assigned booth; category reads require business membership and management requires owner status. Expense mutations continue through the RPC workflow rather than direct client table writes.

A read-only account consistency query found four configured accounts, all with no ledger entries yet; each current balance matched its opening balance. This checks the initial state only and is not a behavioral transaction test.

## Checks and limitations

- `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Lint/build emit two existing hook-dependency warnings in `app/setup/page.tsx` and `app/transactions/page.tsx`.
- The repository has no test script. Authenticated owner/attendant acceptance tests were not run because no test accounts were available. Do not treat the absence of anonymous RPC execution privileges as proof that the complete authenticated business workflow has passed acceptance testing.
- `npm audit` reported 8 vulnerabilities (2 moderate, 5 high, 1 critical) in the existing dependency tree; the suggested remediation involved major upgrades and was not applied blindly.
- Secure receipt storage is unsupported until a private storage bucket, access policies and an authenticated retrieval path are configured.
- The original schema/recording/workflow migration SQL files are absent from this branch despite being applied remotely; fresh-database reproducibility is therefore incomplete.

## Stage 6 guidance

1. Recover and commit the source SQL for the three pre-existing Stage 5 migrations (or replace them with a documented, idempotent baseline that matches the deployed schema) before relying on clean-environment replay.
2. Add authenticated acceptance coverage for owner and attendant roles: booth/business isolation, pending/rejected non-impact, exactly-once posting, overdraft restrictions, no effect on transaction principal/commission, and auditable reversal behavior.
3. If receipt support is required, provision private storage with policies and test owner/attendant access and signed retrieval before enabling upload in the UI.
4. Review and plan dependency vulnerability remediation as a separate compatible upgrade.
5. After the pushed branch receives a Vercel preview, verify it there; keep production promotion a separate explicit decision.
