-- MoMo Ledger: professional cashbook read APIs
-- Presentation changes must continue to read posted ledger movements only.
create or replace function public.cashbook_page_v2(
  target_business_id uuid,
  target_booth_id uuid default null,
  target_account_id uuid default null,
  target_entry_type text default null,
  target_status text default null,
  target_search text default null,
  target_from timestamptz default null,
  target_to timestamptz default null,
  target_sort text default 'newest',
  page_size integer default 20,
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
language plpgsql stable security definer set search_path = public
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
  if target_sort not in ('newest', 'oldest', 'amount_desc', 'amount_asc') then
    raise exception using errcode = '22023', message = 'Invalid cashbook sort';
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
      a.booth_id
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
      le.booth_id
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
  ), filtered as (
    select c.* from (select * from opening_rows union all select * from ledger_rows) c
    where (target_status is null or c.status = target_status)
      and (nullif(trim(target_search), '') is null
        or c.internal_reference ilike '%' || trim(target_search) || '%'
        or c.description ilike '%' || trim(target_search) || '%'
        or c.account_code ilike '%' || trim(target_search) || '%'
        or c.recorded_by_name ilike '%' || trim(target_search) || '%')
  )
  select f.entry_id, f.occurred_at, f.internal_reference, f.description, f.entry_type,
    f.account_id, f.account_code, f.account_category, f.network, f.money_in_pesewas,
    f.money_out_pesewas, f.running_balance_pesewas, f.recorded_by_name, f.status
  from filtered f
  order by
    case when target_sort = 'oldest' then f.occurred_at end asc,
    case when target_sort <> 'oldest' then f.occurred_at end desc,
    case when target_sort = 'amount_desc' then (f.money_in_pesewas + f.money_out_pesewas) end desc,
    case when target_sort = 'amount_asc' then (f.money_in_pesewas + f.money_out_pesewas) end asc,
    f.entry_id desc
  limit page_size offset page_offset;
end;
$$;

create or replace function public.cashbook_summary(
  target_business_id uuid,
  target_booth_id uuid default null,
  target_account_id uuid default null,
  target_entry_type text default null,
  target_status text default null,
  target_search text default null,
  target_from timestamptz default null,
  target_to timestamptz default null
)
returns table (
  opening_balance_pesewas bigint,
  closing_balance_pesewas bigint,
  total_money_in_pesewas bigint,
  total_money_out_pesewas bigint,
  movement_count bigint
)
language plpgsql stable security definer set search_path = public
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
  if target_account_id is not null and not exists (
    select 1 from public.financial_accounts a
    where a.id = target_account_id and a.business_id = target_business_id
      and (target_booth_id is null or a.booth_id is null or a.booth_id = target_booth_id)
  ) then
    raise exception using errcode = '42501', message = 'Financial account access denied';
  end if;

  return query
  with account_scope as (
    select a.id, a.opening_balance_pesewas, a.current_balance_pesewas
    from public.financial_accounts a
    where a.business_id = target_business_id
      and (target_account_id is null or a.id = target_account_id)
      and (target_booth_id is null or a.booth_id is null or a.booth_id = target_booth_id)
  ), opening_rows as (
    select ('opening:' || a.id::text) as entry_id, a.created_at as occurred_at,
      ('OPEN-' || a.account_code) as internal_reference,
      'Opening balance · ' || replace(a.account_code, '_', ' ') as description,
      'OPENING_BALANCE'::text as entry_type, a.id as account_id, a.account_code,
      greatest(a.opening_balance_pesewas, 0)::bigint as money_in_pesewas,
      0::bigint as money_out_pesewas, a.opening_balance_pesewas as running_balance_pesewas,
      coalesce(p.display_name, 'Business setup') as recorded_by_name,
      'OPENING_BALANCE'::text as status
    from public.financial_accounts a
    left join public.business_opening_balances bo on bo.business_id = a.business_id and a.account_category = 'PHYSICAL_CASH'
    left join public.booth_opening_balances bto on bto.business_id = a.business_id and bto.booth_id = a.booth_id and bto.network = a.network and a.account_category = 'ELECTRONIC_FLOAT'
    left join public.profiles p on p.id = coalesce(bo.created_by, bto.created_by)
    where a.id in (select id from account_scope) and a.opening_balance_pesewas > 0
      and (target_from is null or a.created_at >= target_from)
      and (target_to is null or a.created_at < target_to)
      and (target_entry_type is null or target_entry_type = 'OPENING_BALANCE')
  ), ledger_rows as (
    select le.id::text as entry_id, le.created_at as occurred_at,
      coalesce(tp.posting_reference, 'LED-' || left(le.id::text, 8)) as internal_reference,
      le.description, le.entry_type, a.id as account_id, a.account_code,
      greatest(le.balance_delta_pesewas, 0)::bigint as money_in_pesewas,
      greatest(-le.balance_delta_pesewas, 0)::bigint as money_out_pesewas,
      le.resulting_balance_pesewas as running_balance_pesewas,
      coalesce(p.display_name, 'Business member') as recorded_by_name,
      coalesce(e.status, t.transaction_status, case when tp.posting_kind in ('REVERSAL','EXPENSE_REVERSAL') then 'REVERSED' else 'POSTED' end) as status
    from public.ledger_entries le
    join public.financial_accounts a on a.id = le.account_id
    left join public.transaction_postings tp on tp.id = le.posting_id
    left join public.expenses e on e.id = le.expense_id
    left join public.transactions t on t.id = le.transaction_id
    left join public.profiles p on p.id = coalesce(e.recorded_by, t.attendant_id, tp.posted_by)
    where le.business_id = target_business_id and a.id in (select id from account_scope)
      and (target_booth_id is null or le.booth_id = target_booth_id)
      and (target_from is null or le.created_at >= target_from)
      and (target_to is null or le.created_at < target_to)
      and (target_entry_type is null or le.entry_type = target_entry_type
           or (target_entry_type = 'REVERSAL' and tp.posting_kind in ('REVERSAL','EXPENSE_REVERSAL')))
  ), filtered as (
    select c.* from (select * from opening_rows union all select * from ledger_rows) c
    where (target_status is null or c.status = target_status)
      and (nullif(trim(target_search), '') is null
        or c.internal_reference ilike '%' || trim(target_search) || '%'
        or c.description ilike '%' || trim(target_search) || '%'
        or c.account_code ilike '%' || trim(target_search) || '%'
        or c.recorded_by_name ilike '%' || trim(target_search) || '%')
  ), first_rows as (
    select distinct on (account_id) account_id,
      running_balance_pesewas - money_in_pesewas + money_out_pesewas as opening_balance_pesewas
    from filtered order by account_id, occurred_at asc, entry_id asc
  ), last_rows as (
    select distinct on (account_id) account_id, running_balance_pesewas
    from filtered order by account_id, occurred_at desc, entry_id desc
  )
  select coalesce((select sum(f.opening_balance_pesewas) from first_rows f), (select sum(a.opening_balance_pesewas) from account_scope a), 0)::bigint,
    coalesce((select sum(l.running_balance_pesewas) from last_rows l), (select sum(a.current_balance_pesewas) from account_scope a), 0)::bigint,
    coalesce((select sum(f.money_in_pesewas) from filtered f), 0)::bigint,
    coalesce((select sum(f.money_out_pesewas) from filtered f), 0)::bigint,
    (select count(*) from filtered)::bigint;
end;
$$;

revoke all on function public.cashbook_page_v2(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, integer, integer) from public, anon;
revoke all on function public.cashbook_summary(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.cashbook_page_v2(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, integer, integer) to authenticated;
grant execute on function public.cashbook_summary(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz) to authenticated;
