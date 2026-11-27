-- MoMo Ledger: account-level Cashbook balance read model
-- Reconstructs each account independently from its immutable opening balance and ledger deltas.
create or replace function public.cashbook_account_balances(
  target_business_id uuid,
  target_booth_id uuid default null,
  target_account_id uuid default null,
  target_from timestamptz default null,
  target_to timestamptz default null
)
returns table (
  account_id uuid,
  account_code text,
  account_category text,
  network text,
  starting_balance_pesewas bigint,
  opening_balance_pesewas bigint,
  total_money_in_pesewas bigint,
  total_money_out_pesewas bigint,
  closing_balance_pesewas bigint,
  net_movement_pesewas bigint,
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
      raise exception using errcode = '42501', message = 'Owner access required for business-wide account balances';
    end if;
  elsif not public.can_operate_booth(target_business_id, target_booth_id) then
    raise exception using errcode = '42501', message = 'Booth access denied';
  end if;
  if target_from is not null and target_to is not null and target_from >= target_to then
    raise exception using errcode = '22023', message = 'Invalid Cashbook reporting period';
  end if;
  if target_account_id is not null and not exists (
    select 1 from public.financial_accounts a
    where a.id = target_account_id
      and a.business_id = target_business_id
      and (target_booth_id is null or a.booth_id is null or a.booth_id = target_booth_id)
  ) then
    raise exception using errcode = '42501', message = 'Financial account access denied';
  end if;

  return query
  with account_scope as (
    select a.id, a.account_code, a.account_category, a.network,
      a.opening_balance_pesewas::bigint as starting_balance_pesewas
    from public.financial_accounts a
    where a.business_id = target_business_id
      and (target_account_id is null or a.id = target_account_id)
      and (target_booth_id is null or a.booth_id is null or a.booth_id = target_booth_id)
  ), ledger_scope as (
    select le.account_id, le.balance_delta_pesewas, le.created_at
    from public.ledger_entries le
    join account_scope a on a.id = le.account_id
    where le.business_id = target_business_id
      and (target_booth_id is null or le.booth_id is null or le.booth_id = target_booth_id)
  ), account_totals as (
    select a.id as account_id,
      a.starting_balance_pesewas,
      a.starting_balance_pesewas + coalesce(sum(ls.balance_delta_pesewas) filter (where target_from is not null and ls.created_at < target_from), 0)::bigint as opening_balance_pesewas,
      coalesce(sum(greatest(ls.balance_delta_pesewas, 0)) filter (where (target_from is null or ls.created_at >= target_from) and (target_to is null or ls.created_at < target_to)), 0)::bigint as total_money_in_pesewas,
      coalesce(sum(greatest(-ls.balance_delta_pesewas, 0)) filter (where (target_from is null or ls.created_at >= target_from) and (target_to is null or ls.created_at < target_to)), 0)::bigint as total_money_out_pesewas,
      count(ls.*) filter (where (target_from is null or ls.created_at >= target_from) and (target_to is null or ls.created_at < target_to))::bigint as movement_count
    from account_scope a
    left join ledger_scope ls on ls.account_id = a.id
    group by a.id, a.starting_balance_pesewas
  )
  select a.account_id, s.account_code, s.account_category, s.network,
    a.starting_balance_pesewas,
    a.opening_balance_pesewas,
    a.total_money_in_pesewas,
    a.total_money_out_pesewas,
    (a.opening_balance_pesewas + a.total_money_in_pesewas - a.total_money_out_pesewas)::bigint as closing_balance_pesewas,
    (a.total_money_in_pesewas - a.total_money_out_pesewas)::bigint as net_movement_pesewas,
    a.movement_count
  from account_totals a
  join account_scope s on s.id = a.account_id
  order by case when s.account_category = 'PHYSICAL_CASH' then 0 else 1 end, s.network nulls first, s.account_code;
end;
$$;

revoke all on function public.cashbook_account_balances(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.cashbook_account_balances(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
