# Stage 5.2 Handover — Production RPC ACL Audit and Schema Drift

## Current status

Repository: `Emmanuel9535/ghanaian-creator-streaming`. The requested branch is `stage5-2-production-security-audit`. Initial exact-subject commit `83f3639b8b6ab7239dfc0da606ad2f62dde67608` was pushed with subject `Stage 5.2: Harden production RPC permissions and audit schema`; this handover and active migration filenames are being synchronized to the production ledger in a normal, non-force-pushed follow-up. The live application details are also in [the production-apply addendum](STAGE-5.2-PRODUCTION-APPLY-ADDENDUM.md).

The user explicitly authorized the exact sequence Stage 5.1 → Stage 5.2. Both were applied successfully to Supabase. Stage 5.1 precedes Stage 5.2 in the live ledger, and post-application catalog checks verified its security changes and Stage 5.2's ACL effects. No production financial rows were written by either migration. No Stage 6 functionality was implemented; no production promotion or reset/drop/truncate/recreation was performed.

## Production ledger and schema history

Supabase project `txeobytsmfjbweoyetqh` is `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.166`. The initial read-only snapshot had ten entries through `20261122081656`. The live ledger now has those ten entries followed by:

| Version | Name | Result |
|---|---|---|
| `20261122095443` | `stage5_1_tenant_idempotency_and_rpc_security` | Applied successfully first |
| `20261122095542` | `stage5_2_rpc_permission_hardening` | Applied successfully second |

The active local files have been renamed to those exact server-generated versions so future migration tooling recognizes the applied history and preserves order. This is filename synchronization only; SQL payloads are unchanged. The Stage 5.2 rollback is in `supabase/rollback/20261122095542_stage5_2_rpc_permission_hardening.down.sql`.

The pre-Stage-5.1/5.2 ledger contained: `20260828080413 initial_platform_foundation`; `20261122000606 business_onboarding`; `20261122001735 transactions`; `20261122014214 stage_4_financial_ledger`; `20261122015151 stage4_1_dashboard_access_hardening`; `20261122021128 stage_5_expenses_schema`; `20261122021143 stage_5_expenses_recording_rpc`; `20261122021155 stage_5_expenses_workflow_rpc`; `20261122081505 stage5_expense_cashbook_read_rpcs`; `20261122081656 stage5_rpc_access_hardening`.

### Live-schema/history drift (classified; no invented migrations)

- `auth` and `auth.users` are Supabase platform-managed. `public.profiles`, `handle_new_user`, and `on_auth_user_created` are represented in the active initial migration.
- `public.current_user_role()`, `public.is_admin()`, and role-aware legacy profile policies correspond to archived `supabase/legacy_migrations/0002_auth_hardening.sql`; the old changes are not represented as separate entries in the recovered live migration ledger. The Stage 5.1 safe self-update policy is now present.
- Live `public.payments`, its indexes/RLS policies, `touch_payment_updated_at()`, and `payments_set_updated_at` correspond to archived `0003_payments.sql`; removal of the broad payment update policy is in archived `0004_payment_update_hardening.sql`. Neither is in the recovered live ledger. Their production creation event cannot be inferred. These files were not replayed or assigned synthetic versions.
- No object was proven manually created. The active recovered history still does not reconstruct all live legacy auth/payment objects; resolve that history/origin gap deliberately before claiming full reproducibility or beginning Stage 6.

## RPC audit: pre-migration design and application callers

The audited routines are `SECURITY DEFINER` with fixed `search_path = public`. Before the two migrations, the first ten functions below had effective `PUBLIC` and `anon` execution as well as authenticated/service-role access. No anonymous workflow was required. The existing Stage 5 expense/cashbook RPCs were already client-protected. App callers use the authenticated Supabase client; no `supabaseAdmin.rpc()` financial call was found. The repository service-role client is used by payment API routes, so existing `service_role` grants were preserved.

| Function/signature | Authorization, effects, and caller |
|---|---|
| `financial_dashboard(uuid,uuid)` | Stage 4.1 membership and owner/assigned-booth scope; reads financial/accounting tables. `app/dashboard/page.tsx`. |
| `post_momo_transaction(uuid,text)` | Requires authenticated user, request ID, successful transaction, and booth authorization; writes postings, ledger, balances, commissions. `app/new-transaction/page.tsx`. |
| `reverse_momo_transaction(uuid,text,text)` | Owner authorization and reason; writes reversal ledger/posting and updates balances/status. No direct `.rpc()` app caller identified. |
| `financial_account_id(uuid,uuid,text)` | Unguarded ID lookup in financial accounts; no repository caller. No client execution required; restricted to service role. |
| `can_operate_booth(uuid,uuid)` | Checks membership and owner/attendant assignment; transaction/expense RPC and transaction RLS helper. Before Stage 5.1 it did not validate booth/business association; that guard is now present. |
| `is_business_member(uuid)` / `is_business_owner(uuid)` | Authenticated RLS and workflow helpers for active membership or OWNER membership. No anon workflow. |
| `current_user_role()` / `is_admin()` | Archived auth/RLS helpers used for role/admin checks. No anon workflow. |
| `generate_momo_transaction_reference()` | Transaction-insert default sequence/reference; anon direct execution not needed. |
| `record_expense(uuid,uuid,uuid,text,bigint,timestamptz,uuid,text,text,text)` | Authenticated request ID, booth authorization, same-business category and idempotency checks; writes expense/history and can post for owners. `app/expenses/page.tsx`. Stage 5.1 now checks booth/business association. |
| `approve_expense(uuid,text)` / `reject_expense(uuid,text)` | Business-owner authorization; changes expense and history. `app/expenses/page.tsx`. |
| `reverse_expense(uuid,text,text)` | Owner, posted-state, reason and request-ID checks; writes reversal and updates balances/state. `app/expenses/page.tsx`. |
| `expense_dashboard_summary(uuid,uuid)` | Member access; owner for business-wide or assigned booth; reads scoped summaries. `app/expenses/page.tsx`. |
| `cashbook_page(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,integer)` | Membership/owner/assigned booth and account/page scope; reads ledger, postings, expenses, transactions and profiles. `app/cashbook/page.tsx`. |
| `generate_expense_reference()` | Expense reference sequence default; no anonymous execution required. |
| `_post_expense_locked(uuid,uuid)` | Internal helper called by authorized expense RPCs; locked posting writes. Not an app RPC. Owner-only execution is retained. |

## Stage 5.2 permission migration and live result

The ACL-only migration `supabase/migrations/20261122095542_stage5_2_rpc_permission_hardening.sql` affects the ten targets: `is_business_member(uuid)`, `is_business_owner(uuid)`, `can_operate_booth(uuid,uuid)`, `current_user_role()`, `is_admin()`, `generate_momo_transaction_reference()`, `financial_dashboard(uuid,uuid)`, `post_momo_transaction(uuid,text)`, `reverse_momo_transaction(uuid,text,text)`, and `financial_account_id(uuid,uuid,text)`. It changes grants only; no function bodies, tables, policies, or rows are changed in Stage 5.2.

Post-apply Supabase catalog queries verified all reviewed functions remain `SECURITY DEFINER`, with no effective anon or `PUBLIC` execution:

- The first nine listed targets retain `authenticated` and `service_role` execution.
- `financial_account_id(uuid,uuid,text)` is service-role-only; authenticated access is intentionally removed because the helper has no authorization predicate and no app caller.
- `record_expense`, `approve_expense`, `reject_expense`, `reverse_expense`, `expense_dashboard_summary`, `cashbook_page`, and `generate_expense_reference` retain authenticated/service-role execution and deny anon.
- Internal `_post_expense_locked(uuid,uuid)` remains owner-only; anon, authenticated, and service role cannot execute it.

Stage 5.1 behavior checks confirmed the booth-business association, idempotency protection, and safe profile-update policy. The prior broad `profiles_update_own` policy is absent; `Users can update safe profile fields` applies to authenticated users with a role-preserving check except for admins. Its expense/transaction function-body changes and the ACL-only Stage 5.2 change were applied in the authorized order.

The reversible Stage 5.2 down script restores the pre-migration PUBLIC/anon grants and the authenticated grant on `financial_account_id`; it is deliberately not executed because it would reopen anonymous execution. Production migration state should be changed only through an explicitly approved rollback sequence.

## Validation and limits

- `npm ci` succeeded; npm reported 8 dependency vulnerabilities (2 moderate, 5 high, 1 critical).
- `npm run lint` passed with two existing `react-hooks/exhaustive-deps` warnings (`app/setup/page.tsx:50`, `app/transactions/page.tsx:13`).
- `npx tsc --noEmit` passed with no diagnostics.
- `npm run build` passed; Next.js compiled and generated 23 static pages, with the same hook warnings.
- `git diff --check` passed before this filename/document synchronization; it will be rerun before the follow-up commit.
- A disposable local PostgreSQL 16 replay and Stage 5.2 ACL regression passed. Checks covered version-order replay, effective privileges, function-body hashes, rollback/re-apply, and owner/assigned-attendant read-path smoke tests. Fixture rows were rolled back; this was not production testing.
- No live authenticated owner/attendant acceptance accounts were used. Hosted posting/reversal, expense approval/reversal, cashbook/dashboard workflow, and database connectivity remain **untested end-to-end**.

## Vercel preview and Stage 6 readiness

The initial requested commit's preview `dpl_8EqyghHGLjBfJuKpLMFTpEtABzG6` (`https://ghanaian-creator-streaming-igkuq9io6.vercel.app`) reached `READY`. Unauthenticated `/`, `/dashboard`, and `/api/health` requests redirected to Vercel SSO. No temporary share link was created; authenticated routes, database connectivity, and app acceptance remain unverified. Existing Stage 5.1 previews were also `READY`, but SSO prevented protected-route inspection. The sync follow-up preview reached `READY`; see the push-status section below.

Stage 6 reconciliation is **not ready** until the legacy live-schema/history gap is deliberately reconciled and production owner/attendant acceptance has been completed in a safe authorized environment. No Stage 6 functionality was implemented.


## Follow-up push and preview status (2026-11-22)

The migration filename/document synchronization was committed and pushed normally as `c7547fb09930e8ce3eb5fbeb0c6e3103fc05191d` (`Stage 5.2: Sync migration versions to production ledger`). Vercel deployment `dpl_H5412qseKinZgVJvnVWjhq3QUfCK` for that commit reached `READY` at `https://ghanaian-creator-streaming-gwwg50by3.vercel.app`. This supersedes the pending-preview sentence above. It does not establish authenticated route access or live financial workflow acceptance; those remain untested behind Vercel SSO.
