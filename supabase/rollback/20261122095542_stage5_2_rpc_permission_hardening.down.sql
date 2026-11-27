-- Rollback for 20261122095542_stage5_2_rpc_permission_hardening.sql.
-- Re-enables the previously observed PUBLIC/anon grants; use only if rolling back is approved.

GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_operate_booth(uuid, uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_momo_transaction_reference() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_dashboard(uuid, uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_momo_transaction(uuid, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_momo_transaction(uuid, text, text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_account_id(uuid, uuid, text) TO PUBLIC, anon, authenticated;
