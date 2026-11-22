# Stage 5.2 Production Apply Addendum

This addendum supersedes the initial Stage 5.2 handover's pre-application status. The user explicitly authorized the exact Stage 5.1 → Stage 5.2 production sequence. The initial handover and associated branch commit were prepared before that approval.

## Production application

Supabase project `txeobytsmfjbweoyetqh` (`ACTIVE_HEALTHY`, PostgreSQL 17.6.1.166) had the expected ten migration entries through `20261122081656` immediately before applying changes.

1. Stage 5.1 prerequisite applied first and recorded in the live ledger as version `20261122095443`, name `stage5_1_tenant_idempotency_and_rpc_security`. It replaced four transaction/expense workflow bodies, fixed the booth/business association checks, updated the profile self-update policy, and tightened some ACLs. No table data migration was included.
2. Stage 5.2 applied second and recorded as version `20261122095542`, name `stage5_2_rpc_permission_hardening`. It changes RPC EXECUTE ACLs only; no function bodies, table rows, or financial records are changed.

Both applications returned success. The final ledger contains the ten recovered migrations followed by `20261122095443` Stage 5.1 and `20261122095542` Stage 5.2.

## Post-apply verification

Read-only Supabase catalog queries verified all reviewed functions remain `SECURITY DEFINER` and effective grants are:

- `is_business_member(uuid)`, `is_business_owner(uuid)`, `can_operate_booth(uuid,uuid)`, `current_user_role()`, `is_admin()`, `generate_momo_transaction_reference()`, `financial_dashboard(uuid,uuid)`, `post_momo_transaction(uuid,text)`, and `reverse_momo_transaction(uuid,text,text)`: `anon=false`, `authenticated=true`, `service_role=true`; no `PUBLIC` EXECUTE ACL remains.
- `financial_account_id(uuid,uuid,text)`: `anon=false`, `authenticated=false`, `service_role=true`; no `PUBLIC` EXECUTE ACL remains.
- Existing Stage 5 RPCs (`record_expense`, `approve_expense`, `reject_expense`, `reverse_expense`, `expense_dashboard_summary`, `cashbook_page`, `generate_expense_reference`) remain `anon=false`, `authenticated=true`, `service_role=true`.
- Internal `_post_expense_locked(uuid,uuid)` remains callable only by its owner (`postgres`); it is not executable by `anon`, `authenticated`, or `service_role`.

Catalog verification confirmed `can_operate_booth` joins the booth to its owning business before checking active membership/role. `record_expense` verifies the booth belongs to the supplied business and includes request-payload/actor/tenant idempotency conflict checks. The transaction posting/reversal and expense reversal bodies contain the expected generic idempotency conflict checks. The prior broad `profiles_update_own` policy is absent; `Users can update safe profile fields` is present for `authenticated`, with `WITH CHECK` preventing self-role changes unless `is_admin()`.

No production owner/attendant accounts were available, so hosted transaction posting, expense approval/reversal, dashboard, and cashbook workflows remain untested end-to-end. The effective ACLs, migration order, key function definitions, and profile policy were verified via read-only catalog inspection. No production financial record was created or changed by these migration payloads.

## Repository version synchronization

The Supabase CLI assigned server versions `20261122095443` and `20261122095542`, instead of the original local draft filenames `20261122090128` and `20261122094500`. The active Stage 5.1 and Stage 5.2 migration filenames now match the live ledger exactly and sort in production order. The Stage 5.2 rollback filename and the migration references in its header and regression test were also synchronized. A local `git diff --check`, ordered filename review, and rerun of `supabase/tests/stage5_2_rpc_permission_regression.sql` passed against the disposable PostgreSQL 16 database.

## Git and preview

The initial requested commit is `83f3639b8b6ab7239dfc0da606ad2f62dde67608` on pushed branch `stage5-2-production-security-audit`, with exact subject `Stage 5.2: Harden production RPC permissions and audit schema`. Its Vercel preview `dpl_8EqyghHGLjBfJuKpLMFTpEtABzG6` (`https://ghanaian-creator-streaming-igkuq9io6.vercel.app`) reached `READY`. Unauthenticated requests to `/`, `/dashboard`, and `/api/health` redirected to Vercel SSO; no temporary share link was created, so authenticated page, database-connectivity, and financial acceptance checks remain blocked. The normal follow-up push and its preview check are still pending at the time of this revision.


## Follow-up sync commit and preview

The filename/reference and handover synchronization was pushed normally as commit `c7547fb09930e8ce3eb5fbeb0c6e3103fc05191d` (`Stage 5.2: Sync migration versions to production ledger`) on `stage5-2-production-security-audit`. Vercel deployment `dpl_H5412qseKinZgVJvnVWjhq3QUfCK` (`https://ghanaian-creator-streaming-gwwg50by3.vercel.app`) reached `READY`. This supersedes the earlier pending-preview note. The preview's authenticated workflow and database checks remain unverified behind SSO.
