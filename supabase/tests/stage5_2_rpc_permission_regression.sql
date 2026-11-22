-- Post-migration ACL regression for 20261122094500_stage5_2_rpc_permission_hardening.sql.
-- Read-only: run after the migration on an isolated Supabase-compatible PostgreSQL database.
DO $$
DECLARE
  check_row record;
  function_oid oid;
  public_execute boolean;
BEGIN
  FOR check_row IN
    SELECT * FROM (VALUES
      ('public.is_business_member(uuid)', true),
      ('public.is_business_owner(uuid)', true),
      ('public.can_operate_booth(uuid,uuid)', true),
      ('public.current_user_role()', true),
      ('public.is_admin()', true),
      ('public.generate_momo_transaction_reference()', true),
      ('public.financial_dashboard(uuid,uuid)', true),
      ('public.post_momo_transaction(uuid,text)', true),
      ('public.reverse_momo_transaction(uuid,text,text)', true),
      ('public.financial_account_id(uuid,uuid,text)', false)
    ) AS expected(signature, authenticated_execute)
  LOOP
    function_oid := to_regprocedure(check_row.signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Missing expected RPC/helper: %', check_row.signature;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = function_oid) THEN
      RAISE EXCEPTION 'Expected SECURITY DEFINER for %', check_row.signature;
    END IF;
    IF has_function_privilege('anon', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', check_row.signature;
    END IF;
    IF has_function_privilege('authenticated', function_oid, 'EXECUTE') IS DISTINCT FROM check_row.authenticated_execute THEN
      RAISE EXCEPTION 'Unexpected authenticated privilege for %', check_row.signature;
    END IF;
    IF NOT has_function_privilege('service_role', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost execution on %', check_row.signature;
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
      WHERE p.oid = function_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) INTO public_execute
    FROM pg_proc p WHERE p.oid = function_oid;
    IF public_execute THEN
      RAISE EXCEPTION 'PUBLIC can execute %', check_row.signature;
    END IF;
  END LOOP;

  -- Expense/cashbook access must remain authenticated-only (plus trusted server role).
  FOR check_row IN
    SELECT * FROM (VALUES
      ('public.expense_dashboard_summary(uuid,uuid)'),
      ('public.cashbook_page(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,integer)'),
      ('public.record_expense(uuid,uuid,uuid,text,bigint,timestamptz,uuid,text,text,text)'),
      ('public.approve_expense(uuid,text)'),
      ('public.reject_expense(uuid,text)'),
      ('public.reverse_expense(uuid,text,text)')
    ) AS protected(signature)
  LOOP
    function_oid := to_regprocedure(check_row.signature);
    IF function_oid IS NULL THEN RAISE EXCEPTION 'Missing existing Stage 5 RPC: %', check_row.signature; END IF;
    IF has_function_privilege('anon', function_oid, 'EXECUTE') THEN RAISE EXCEPTION 'anon can execute %', check_row.signature; END IF;
    IF NOT has_function_privilege('authenticated', function_oid, 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lost execution on %', check_row.signature; END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'public._post_expense_locked(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public._post_expense_locked(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Internal _post_expense_locked helper is directly executable by a client/server API role';
  END IF;
END $$;

SELECT 'PASS: Stage 5.2 RPC permission regression assertions' AS result;
