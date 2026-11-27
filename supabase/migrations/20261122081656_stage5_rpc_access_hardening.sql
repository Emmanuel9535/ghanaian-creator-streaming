-- Supabase may grant newly created/replaced functions directly to anon or PUBLIC.
-- Expense workflow and read-model RPCs are tenant-scoped financial operations.
-- Authenticated callers must still satisfy each function's own membership/owner checks.
revoke all on function public.expense_dashboard_summary(uuid, uuid) from public, anon;
revoke all on function public.cashbook_page(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.expense_dashboard_summary(uuid, uuid) to authenticated;
grant execute on function public.cashbook_page(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, integer) to authenticated;

revoke all on function public.record_expense(uuid, uuid, uuid, text, bigint, timestamptz, uuid, text, text, text) from public, anon;
revoke all on function public.approve_expense(uuid, text) from public, anon;
revoke all on function public.reject_expense(uuid, text) from public, anon;
revoke all on function public.reverse_expense(uuid, text, text) from public, anon;
grant execute on function public.record_expense(uuid, uuid, uuid, text, bigint, timestamptz, uuid, text, text, text) to authenticated;
grant execute on function public.approve_expense(uuid, text) to authenticated;
grant execute on function public.reject_expense(uuid, text) to authenticated;
grant execute on function public.reverse_expense(uuid, text, text) to authenticated;

-- Internal posting must only run through the authorized workflow RPCs above.
revoke all on function public._post_expense_locked(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.generate_expense_reference() from public, anon;