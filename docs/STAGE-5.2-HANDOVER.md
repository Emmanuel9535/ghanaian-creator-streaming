# Stage 5.2 Handover — Production RPC ACL Audit and Schema Drift

## Scope and production decision

Repository: `Emmanuel9535/ghanaian-creator-streaming`. Starting commit: `9336e9c25f566de775ac0e205f87e1be178ae8b8` on `stage5-1-migration-recovery`. Work is on `stage5-2-production-security-audit`; the requested commit subject is `Stage 5.2: Harden production RPC permissions and audit schema`.

Stage 5.2 prepares an ACL-only migration and rollback script. No Stage 6 reconciliation implementation was added. No production SQL was applied, and no live financial rows, schema objects, or migration-ledger entries were changed. Although a later instruction asked to apply the production migration, application was held: the live migration ledger does not contain Stage 5.1, the Stage 5.2 migration is ordered after it, and the live `can_operate_booth`/`record_expense` definitions still lack the booth-to-business association guard that Stage 5.1 adds. Applying only Stage 5.2 would tighten anonymous ACLs but leave that authenticated cross-business integrity/security issue unresolved and would put the migration out of the recorded sequence. Resolve/reconcile Stage 5.1 and review the exact production effects before any production migration.

## Production snapshot and migration history

Read-only inspection of Supabase project `txeobytsmfjbweoyetqh` showed `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.166`. The live migration ledger has exactly these ten entries and stops at `20261122081656`:

| Version | Name |
|---|---|
| `20260828080413` | `initial_platform_foundation` |
| `20261122000606` | `business_onboarding` |
| `20261122001735` | `transactions` |
| `20261122014214` | `stage_4_financial_ledger` |
| `20261122015151` | `stage4_1_dashboard_access_hardening` |
| `20261122021128` | `stage_5_expenses_schema` |
| `20261122021143` | `stage_5_expenses_recording_rpc` |
| `20261122021155` | `stage_5_expenses_workflow_rpc` |
| `20261122081505` | `stage5_expense_cashbook_read_rpcs` |
| `20261122081656` | `stage5_rpc_access_hardening` |

Repository migration `20261122090128_stage5_1_tenant_idempotency_and_rpc_security.sql` is not applied in production. Stage 5.2 (`20261122094500`) is a separate local file after that prerequisite. The live active history must not be represented as if it includes Stage 5.1 or Stage 5.2.

## RPC/function audit and permission plan

All listed functions are `SECURITY DEFINER` with a fixed `search_path = public` in their recovered/archived definitions. The table distinguishes `anon` effective execution from direct `PUBLIC` grants: for the first ten functions, production has both direct `anon` and `PUBLIC` EXECUTE, so anonymous callers are effective. `postgres` is the function owner. No function below requires anonymous execution.

| Function/signature | Live effective EXECUTE before | Auth checks / data effects / app use |
|---|---|---|
| `financial_dashboard(uuid, uuid)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Stage 4.1 requires an active membership and restricts attendants to their assigned booth; reads `business_members`, `financial_accounts`, `transactions`, `commission_records`, and `transaction_accounting_treatments`. Direct app caller: `app/dashboard/page.tsx`. Anonymous is not required. |
| `post_momo_transaction(uuid, text)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Requires a non-null `auth.uid()`, stable request ID, successful transaction, and `can_operate_booth`. Locks/reads transaction, account, treatment and posting rows; writes postings, ledger entries, account balances and commission records. Direct app caller: `app/new-transaction/page.tsx`. Anonymous is not required. |
| `reverse_momo_transaction(uuid, text, text)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Requires authenticated business-owner authorization and a reason; writes a reversal posting and ledger entries, updates account balances, transaction status and commission state. No direct application `.rpc()` caller was found. Anonymous is not required. |
| `financial_account_id(uuid, uuid, text)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Unguarded lookup of an ID in `financial_accounts`; no authorization predicate and no repository/app caller. Anonymous and authenticated client execution are not required. Proposed exception: service role only. |
| `can_operate_booth(uuid, uuid)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Checks active membership and owner/attendant assignment; called by transaction/expense RPCs and transaction RLS. **Live function does not verify that the booth belongs to the supplied business.** Stage 5.1 adds that association check; it remains unapplied. |
| `is_business_member(uuid)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Checks active membership for `auth.uid()`; used by RLS policies and financial workflows. No anonymous workflow is required. |
| `is_business_owner(uuid)` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Checks active OWNER membership for `auth.uid()`; used by RLS and expense/reversal workflows. No anonymous workflow is required. |
| `current_user_role()` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Reads `profiles.role` for `auth.uid()` (defaults to `viewer`); an auth/RLS helper from archived legacy `0002_auth_hardening.sql`. No anonymous workflow is required. |
| `is_admin()` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Uses `current_user_role()` and tests administrator/super-admin; an auth/RLS helper from archived legacy `0002_auth_hardening.sql`. No anonymous workflow is required. |
| `generate_momo_transaction_reference()` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Advances the MoMo reference sequence and returns a reference; used as `transactions.internal_reference` default during authenticated transaction insertion. Anonymous direct invocation is not required. |
| `record_expense(uuid, uuid, uuid, text, bigint, timestamptz, uuid, text, text, text)` | `authenticated`, `service_role` (not anon/PUBLIC) | Requires authentication, a stable request ID, `can_operate_booth`, and a category for the same business; writes expenses/status history and may call the internal posting helper for owners. Direct app caller: `app/expenses/page.tsx`. Live body also lacks the booth-to-business association check; Stage 5.1 adds it. |
| `approve_expense(uuid, text)` | `authenticated`, `service_role` (not anon/PUBLIC) | Requires business-owner authorization; updates expense/history and posts through the internal helper. Direct app caller: `app/expenses/page.tsx`. |
| `reject_expense(uuid, text)` | `authenticated`, `service_role` (not anon/PUBLIC) | Requires owner authorization and a reason; updates expense status/notes and history. Direct app caller: `app/expenses/page.tsx`. |
| `reverse_expense(uuid, text, text)` | `authenticated`, `service_role` (not anon/PUBLIC) | Requires owner authorization, posted state, reason and request ID; writes reversal posting/ledger, adjusts account balance and expense state. Direct app caller: `app/expenses/page.tsx`. |
| `expense_dashboard_summary(uuid, uuid)` | `authenticated`, `service_role` (not anon/PUBLIC) | Requires member access; owner for business-wide, assigned booth for booth scope. Reads expenses/categories/business settings/accounts. Direct app caller: `app/expenses/page.tsx`. |
| `cashbook_page(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, integer)` | `authenticated`, `service_role` (not anon/PUBLIC) | Requires member/owner/assigned-booth access and validates account/page scope; reads opening balances, accounts, ledger, postings, expenses, transactions and profiles. Direct app caller: `app/cashbook/page.tsx`. |
| `generate_expense_reference()` | `authenticated`, `service_role` (not anon/PUBLIC) | Reference-sequence default for expense insertion; no anonymous access is granted or needed. |
| `_post_expense_locked(uuid, uuid)` | `postgres` only; no effective client or service-role EXECUTE | Internal expense posting helper called from authorized expense RPCs; reads/locks expense/account rows and writes posting, ledger, balance and status records. Not an app RPC. |

`app/dashboard/page.tsx`, `app/new-transaction/page.tsx`, `app/expenses/page.tsx`, and `app/cashbook/page.tsx` use the authenticated Supabase client. No direct `supabaseAdmin.rpc()` call was found; the repository's service-role client is used for payment API routes. Existing `service_role` grants on the reviewed financial functions are retained to avoid removing an externally managed trusted backend path, but no in-repository financial RPC caller using that role was identified. The functions' own `auth.uid()`/owner checks still apply when a trusted caller has no user JWT.

### Exact Stage 5.2 permission effects

Migration `supabase/migrations/20261122094500_stage5_2_rpc_permission_hardening.sql` affects only these ten signatures:

- `is_business_member(uuid)`
- `is_business_owner(uuid)`
- `can_operate_booth(uuid, uuid)`
- `current_user_role()`
- `is_admin()`
- `generate_momo_transaction_reference()`
- `financial_dashboard(uuid, uuid)`
- `post_momo_transaction(uuid, text)`
- `reverse_momo_transaction(uuid, text, text)`
- `financial_account_id(uuid, uuid, text)`

For the first nine, the before privileges are `PUBLIC + anon + authenticated + service_role` (plus owner); proposed privileges are `authenticated + service_role` (plus owner). For `financial_account_id`, before is the same; proposed is `service_role` only (plus owner). `PUBLIC` and `anon` are revoked for all ten; authenticated access is preserved for nine and explicitly removed only from the unguarded, unused `financial_account_id` helper. The Stage 5 expense/cashbook RPCs are already protected and are not changed. No function body, table, policy, row, financial record, or migration ledger entry changes in Stage 5.2.

Rollback is in `supabase/rollback/20261122094500_stage5_2_rpc_permission_hardening.down.sql`. It restores the previously observed `PUBLIC`/`anon` grants and the prior authenticated grant on `financial_account_id`; service-role grants are unchanged. Running it intentionally reopens anonymous execution and therefore requires an approved rollback decision.

## Live schema versus recovered history

| Live object/discrepancy | Classification | Notes |
|---|---|---|
| `auth` schema and `auth.users` | Expected external/platform-managed | Supabase Auth owns this system schema/table. |
| `public.profiles`, `handle_new_user`, and `on_auth_user_created` | Reproduced by active migration | Present in `20260828080413_initial_platform_foundation.sql`. |
| `public.current_user_role()` / `public.is_admin()` and role-aware legacy profile policies | Historical schema drift | Definitions/policy changes match archived `supabase/legacy_migrations/0002_auth_hardening.sql`; no corresponding version exists in the live ten-entry ledger. |
| `public.payments`, its indexes, RLS policies, `touch_payment_updated_at()` and `payments_set_updated_at` trigger | Historical schema drift | Archived definitions exist in `0003_payments.sql`; removal of the broad update policy is in `0004_payment_update_hardening.sql`. Neither appears in the live migration ledger. Their production creation event cannot be inferred from that ledger. Do not invent migration versions or replay the archive blindly. |
| Stage 5.1 security changes | Missing migration in production | Repository SQL exists, but the production ledger does not contain version `20261122090128`; it fixes booth/business association checks, idempotency conflict behavior and profile-update authorization. |
| Stage 5.2 permission hardening | Prepared only | Not applied to production. |

No object was classified as proven manually created. No additional unresolved database object beyond the history/origin gap for the archived legacy objects was identified in this audit. The active ten-migration sequence does not reconstruct every live legacy auth/payment object.

## Validation results

- `npm ci`: completed; npm reported 8 dependency vulnerabilities (2 moderate, 5 high, 1 critical).
- `npm run lint`: passed with two existing `react-hooks/exhaustive-deps` warnings (`app/setup/page.tsx:50`, `app/transactions/page.tsx:13`).
- `npx tsc --noEmit`: passed (no diagnostics).
- `npm run build`: passed; Next.js compiled, lint/type validation completed, and 23 static pages were generated. The same two hook warnings remain.
- `git diff --check`: passed.
- Disposable SQL validation: a local PostgreSQL 16 cluster on `127.0.0.1:55432` was bootstrapped with test-only `anon`, `authenticated`, `service_role`, `auth.users`, and `auth.uid()`. The ten recovered migrations plus Stage 5.1 replayed with stop-on-error, then Stage 5.2 was applied locally. Assertions passed for no effective anon/PUBLIC execution on the ten targets, retained authenticated/service-role access as specified, `financial_account_id` authenticated denial, unchanged function-body hashes, rollback restoration, and re-application.
- The committed read-only assertion script `supabase/tests/stage5_2_rpc_permission_regression.sql` passed against that disposable database.
- A disposable authenticated-role smoke test passed: an owner read its own dashboard/cashbook/expense summary; an assigned attendant read its booth-scoped versions; cross-business dashboard access and attendant-wide dashboard access were denied; a cross-business booth check returned false. Test fixture rows were rolled back.
- The prior Stage 5.1 handover records successful local transaction posting/reversal, expense posting/reversal, idempotency, RLS, and profile checks before Stage 5.2. Stage 5.2 did not modify function bodies. These are local tests, not production acceptance tests. No live owner or attendant test account was available/used, and no live financial workflow is claimed tested.

## Vercel previews

Both existing Stage 5.1 previews are `READY` on the existing project:

| Deployment | URL | Commit/ref | State |
|---|---|---|---|
| `dpl_9imdRtXAa6XBtqWfKwS6fChgJoYU` | `ghanaian-creator-streaming-p9in1z9lr.vercel.app` | `25b7740b81ec14bbaa7c5bbc702d3d02a28a966d`, `stage5-1-migration-recovery` | `READY` |
| `dpl_4EpvKEp3CfNYgbMHfH5nDaQafnRi` | `ghanaian-creator-streaming-56pmbopc7.vercel.app` | `9336e9c25f566de775ac0e205f87e1be178ae8b8`, `stage5-1-migration-recovery` | `READY` |

Unauthenticated checks of `/`, `/dashboard`, and `/api/health` on both deployment URLs were redirected to Vercel SSO. Page, database-connectivity, and financial UI acceptance could not be inspected without authorization. No temporary Vercel share link was created (those links are accessible to anyone holding the link for up to 23 hours). The deployments' READY state does not prove authenticated route or database connectivity.

## Remaining blockers and Stage 6 readiness

Production remains exposed to the ten observed anonymous/PUBLIC grants listed above, and the live booth/business association gap remains until Stage 5.1 is reconciled/applied. Stage 5.2 only narrows EXECUTE privileges; it does not repair function behavior. No production migration was applied even after the later request to do so, because the prerequisite migration/order and known authenticated cross-business issue make that action unsafe as-is.

The requested branch/commit push is being handled separately from production schema changes. Stage 6 reconciliation is **not ready to begin** until Stage 5.1/5.2 production migration history and ACL state are reconciled, authenticated owner/attendant acceptance is performed against a safe preview or test environment, and the remaining legacy schema drift is deliberately resolved. No Stage 6 functionality was implemented here.
