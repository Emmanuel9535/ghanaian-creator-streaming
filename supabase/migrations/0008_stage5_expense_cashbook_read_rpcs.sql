-- Stage 5 read models. All financial amounts remain integer pesewas in PostgreSQL.
-- The cashbook reads posted movements from the ledger and exposes opening balances
-- from the ledger's existing financial-account opening balance records.

create or replace function public.expense_dashboard_summary(
  target_business_id uuid,
  target_booth_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text;
  local_now timestamp;
  today_start timestamptz;
  week_start timestamptz;
  month_start timestamptz;
  result jsonb;
begin
  if not public.is_business_member(target_business_id) then
    raise exception using errcode = '42501', message = 'Business access denied';
  end if;
  if target_booth_id is null then
    if not public.is_business_owner(target_business_id) then
      raise exception using errcode = '42501', message = 'Owner access required for business-wide expense totals';
    end if;
  elsif not public.can_operate_booth(target_business_id, target_booth_id) then
    raise exception using errcode = '42501', message = 'Booth access denied';
  end if;

  select coalesce(s.timezone, 'Africa/Accra') into tz
  from public.business_settings s where s.business_id = target_business_id;
  tz := coalesce(tz, 'Africa/Accra');
  local_now := now() at time zone tz;
  today_start := date_trunc('day', local_now) at time zone tz;
  week_start := date_trunc('week', local_now) at time zone tz;
  month_start := date_trunc('month', local_now) at time zone tz;

  select jsonb_build_object(
    'today_pesewas', coalesce(sum(e.amount_pesewas) filter (where e.status = 'POSTED' and e.expense_at >= today_start), 0),
    'week_pesewas', coalesce(sum(e.amount_pesewas) filter (where e.status = 'POSTED' and e.expense_at >= week_start), 0),
    'month_pesewas', coalesce(sum(e.amount_pesewas) filter (where e.status = 'POSTED' and e.expense_at >= month_start), 0),
    'pending_count', count(*) filter (where e.status = 'PENDING_APPROVAL'),
    'category_totals', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', x.category_id, 'category', x.category, 'amount_pesewas', x.amount_pesewas, 'expense_count', x.expense_count) order by x.amount_pesewas desc)
      from (
        select e2.category_id, c.name as category, sum(e2.amount_pesewas) as amount_pesewas, count(*) as expense_count
        from public.expenses e2 join public.expense_categories c on c.id = e2.category_id
        where e2.business_id = target_business_id and e2.status = 'POSTED'
          and e2.expense_at >= month_start
          and (target_booth_id is null or e2.booth_id = target_booth_id)
        group by e2.category_id, c.name order by sum(e2.amount_pesewas) desc limit 8
      ) x
    ), '[]'::jsonb),
    'payment_source_totals', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', x.account_id, 'account_code', x.account_code, 'account_category', x.account_category, 'network', x.network, 'amount_pesewas', x.amount_pesewas) order by x.amount_pesewas desc)
      from (
        select a.id as account_id, a.account_code, a.account_category, a.network, sum(e2.amount_pesewas) as amount_pesewas
        from public.expenses e2 join public.financial_accounts a on a.id = e2.payment_source_account_id
        where e2.business_id = target_business_id and e2.status = 'POSTED'
          and e2.expense_at >= month_start
          and (target_booth_id is null or e2.booth_id = target_booth_id)
        group by a.id, a.account_code, a.account_category, a.network
      ) x
    ), '[]'::jsonb)
  ) into result
  from public.expenses e
  where e.business_id = target_business_id
    and (target_booth_id is null or e.booth_id = target_booth_id);

  return result;
end;
$$;

create or replace function public.cashbook_page(
  target_business_id uuid,
  target_booth_id uuid default null,
  target_account_id uuid default null,
  target_entry_type text default null,
  target_from timestamptz default null,
  target_to timestamptz default null,
  page_size integer default 25,
  page_offset integer default 0
)
returns table (
  entry_id text,
  occurred_at timestamptz,
  internal_reference text,
  description text,
  entry_type text,
  account_id uuid,
  account_code text,
  account_category text,
  network text,
  money_in_pesewas bigint,
  money_out_pesewas bigint,
  running_balance_pesewas bigint,
  recorded_by_name text,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_business_member(target_business_id) then
    raise exception using errcode = '42501', message = 'Business access denied';
  end if;
  if target_booth_id is null then
    if not public.is_business_owner(target_business_id) then
      raise exception using errcode = '42501', message = 'Owner access required for business-wide cashbook';
    end if;
  elsif not public.can_operate_booth(target_business_id, target_booth_id) then
    raise exception using errcode = '42501', message = 'Booth access denied';
  end if;
  if page_size < 1 or page_size > 100 or page_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid cashbook page';
  end if;
  if target_account_id is not null and not exists (
    select 1 from public.financial_accounts a
    where a.id = target_account_id and a.business_id = target_business_id
      and (target_booth_id is null or a.booth_id is null or a.booth_id = target_booth_id)
  ) then
    raise exception using errcode = '42501', message = 'Financial account access denied';
  end if;

  return query
  with opening_rows as (
    select ('opening:' || a.id::text) as entry_id, a.created_at as occurred_at,
      ('OPEN-' || a.account_code) as internal_reference,
      'Opening balance · ' || replace(a.account_code, '_', ' ') as description,
      'OPENING_BALANCE'::text as entry_type, a.id as account_id, a.account_code,
      a.account_category, a.network,
      greatest(a.opening_balance_pesewas, 0)::bigint as money_in_pesewas,
      0::bigint as money_out_pesewas, a.opening_balance_pesewas as running_balance_pesewas,
      coalesce(p.display_name, 'Business setup') as recorded_by_name,
      'OPENING_BALANCE'::text as status,
      a.booth_id, null::uuid as direct_actor
    from public.financial_accounts a
    left join public.business_opening_balances bo on bo.business_id = a.business_id and a.account_category = 'PHYSICAL_CASH'
    left join public.booth_opening_balances bto on bto.business_id = a.business_id and bto.booth_id = a.booth_id and bto.network = a.network and a.account_category = 'ELECTRONIC_FLOAT'
    left join public.profiles p on p.id = coalesce(bo.created_by, bto.created_by)
    where a.business_id = target_business_id and a.opening_balance_pesewas > 0
      and (target_account_id is null or a.id = target_account_id)
      and (target_booth_id is null or a.booth_id is null or a.booth_id = target_booth_id)
      and (target_from is null or a.created_at >= target_from)
      and (target_to is null or a.created_at < target_to)
      and (target_entry_type is null or target_entry_type = 'OPENING_BALANCE')
  ), ledger_rows as (
    select le.id::text as entry_id, le.created_at as occurred_at,
      coalesce(tp.posting_reference, 'LED-' || left(le.id::text, 8)) as internal_reference,
      le.description, le.entry_type, a.id as account_id, a.account_code,
      a.account_category, a.network,
      greatest(le.balance_delta_pesewas, 0)::bigint as money_in_pesewas,
      greatest(-le.balance_delta_pesewas, 0)::bigint as money_out_pesewas,
      le.resulting_balance_pesewas as running_balance_pesewas,
      coalesce(p.display_name, 'Business member') as recorded_by_name,
      coalesce(e.status, t.transaction_status, case when tp.posting_kind in ('REVERSAL','EXPENSE_REVERSAL') then 'REVERSED' else 'POSTED' end) as status,
      le.booth_id, tp.posted_by as direct_actor
    from public.ledger_entries le
    join public.financial_accounts a on a.id = le.account_id
    left join public.transaction_postings tp on tp.id = le.posting_id
    left join public.expenses e on e.id = le.expense_id
    left join public.transactions t on t.id = le.transaction_id
    left join public.profiles p on p.id = coalesce(e.recorded_by, t.attendant_id, tp.posted_by)
    where le.business_id = target_business_id
      and (target_account_id is null or a.id = target_account_id)
      and (target_booth_id is null or le.booth_id = target_booth_id)
      and (target_from is null or le.created_at >= target_from)
      and (target_to is null or le.created_at < target_to)
      and (target_entry_type is null or le.entry_type = target_entry_type
           or (target_entry_type = 'REVERSAL' and tp.posting_kind in ('REVERSAL','EXPENSE_REVERSAL')))
  ), combined as (
    select * from opening_rows
    union all
    select * from ledger_rows
  )
  select c.entry_id, c.occurred_at, c.internal_reference, c.description, c.entry_type,
    c.account_id, c.account_code, c.account_category, c.network, c.money_in_pesewas,
    c.money_out_pesewas, c.running_balance_pesewas, c.recorded_by_name, c.status
  from combined c
  order by c.occurred_at desc, c.entry_id desc
  limit page_size offset page_offset;
end;
$$;

revoke all on function public.expense_dashboard_summary(uuid, uuid) from public;
revoke all on function public.expense_dashboard_summary(uuid, uuid) from anon;
revoke all on function public.cashbook_page(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, integer) from public;
revoke all on function public.cashbook_page(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, integer) from anon;
grant execute on function public.expense_dashboard_summary(uuid, uuid) to authenticated;
grant execute on function public.cashbook_page(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, integer) to authenticated;
