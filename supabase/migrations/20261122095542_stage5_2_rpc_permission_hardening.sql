-- Stage 5.2: least-privilege EXECUTE grants for production financial RPCs.
-- ACL-only: no function definitions, table data, schema objects, or ledger rows change.
--
-- IMPORTANT: Stage 5.1 was applied first and recorded in production as
-- 20261122095443_stage5_1_tenant_idempotency_and_rpc_security. This migration was then
-- recorded as 20261122095542_stage5_2_rpc_permission_hardening; keep filenames aligned.
--
-- All functions below retain authenticated/service_role execution except the unguarded,
-- unused-by-app financial_account_id lookup, which retains trusted service_role only.

-- Membership helpers are used by authenticated RLS policies and RPCs. Keep those callers,
-- but do not expose membership/owner predicates to anonymous/PUBLIC callers.
REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated, service_role;

-- Booth authorization helper is invoked by authenticated RLS policies and workflow RPCs.
REVOKE ALL ON FUNCTION public.can_operate_booth(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_operate_booth(uuid, uuid) TO authenticated, service_role;

-- Profile/payment RLS policies depend on these authenticated helper functions.
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- This is the default for transactions.internal_reference. Authenticated transaction inserts
-- and trusted server operations must continue to generate references.
REVOKE ALL ON FUNCTION public.generate_momo_transaction_reference() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_momo_transaction_reference() TO authenticated, service_role;

-- Read-only dashboard: owner may request business-wide totals; attendants are restricted
-- by the function body to their assigned booth. Called by app/dashboard/page.tsx.
REVOKE ALL ON FUNCTION public.financial_dashboard(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_dashboard(uuid, uuid) TO authenticated, service_role;

-- Financial posting and owner reversal retain their authenticated workflow and server grants.
REVOKE ALL ON FUNCTION public.post_momo_transaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_momo_transaction(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reverse_momo_transaction(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_momo_transaction(uuid, text, text) TO authenticated, service_role;

-- No repository/application caller or authorization check exists for this ID lookup.
-- Remove client execution entirely; retain trusted service-role access for any approved backend use.
REVOKE ALL ON FUNCTION public.financial_account_id(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_account_id(uuid, uuid, text) TO service_role;
