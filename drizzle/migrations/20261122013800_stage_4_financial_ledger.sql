-- Stage 4: Financial calculation engine and ledger posting
-- Builds on business_opening_balances, booth_opening_balances, transactions,
-- transaction_status_history, business_members and existing RLS helpers.

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booth_id uuid references public.booths(id) on delete cascade,
  account_code text not null,
  account_category text not null check (account_category in ('PHYSICAL_CASH','ELECTRONIC_FLOAT','COMMISSION','EXPENSE','ADJUSTMENT')),
  network text check (network is null or network in ('MTN','TELECEL','AT')),
  opening_balance_pesewas bigint not null default 0 check (opening_balance_pesewas >= 0),
  current_balance_pesewas bigint not null default 0,
  allow_overdraft boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_accounts_scope_check check (
    (account_category = 'PHYSICAL_CASH' and booth_id is null and network is null)
    or (account_category = 'ELECTRONIC_FLOAT' and booth_id is not null and network is not null)
    or (account_category in ('COMMISSION','EXPENSE','ADJUSTMENT'))
  ),
  unique (business_id, booth_id, account_code)
);

create index if not exists financial_accounts_business_idx on public.financial_accounts (business_id, account_category, network);
create index if not exists financial_accounts_booth_idx on public.financial_accounts (booth_id, account_category, network);

create table if not exists public.transaction_accounting_treatments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('DEPOSIT','WITHDRAWAL','AIRTIME','BILL_PAYMENT')),
  network text not null check (network in ('MTN','TELECEL','AT')),
  cash_charge_mode text not null default 'NONE' check (cash_charge_mode in ('NONE','CASH_IN','DEDUCT_FROM_PAYOUT')),
  float_settlement_enabled boolean not null default false,
  commission_received_by_default boolean not null default false,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, transaction_type, network)
);

create table if not exists public.transaction_postings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  booth_id uuid not null references public.booths(id) on delete restrict,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  posting_reference text not null unique,
  idempotency_key text not null unique,
  posting_kind text not null default 'ORIGINAL' check (posting_kind in ('ORIGINAL','REVERSAL')),
  original_posting_id uuid references public.transaction_postings(id) on delete restrict,
  posted_by uuid not null references auth.users(id) on delete restrict,
  posted_at timestamptz not null default now(),
  unique (transaction_id, posting_kind)
);

create index if not exists transaction_postings_business_idx on public.transaction_postings (business_id, posted_at desc);
create index if not exists transaction_postings_transaction_idx on public.transaction_postings (transaction_id);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  posting_id uuid not null references public.transaction_postings(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  booth_id uuid references public.booths(id) on delete restrict,
  transaction_id uuid references public.transactions(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  entry_type text not null check (entry_type in ('OPENING_BALANCE','TRANSACTION_PRINCIPAL','CUSTOMER_CHARGE','COMMISSION','ADJUSTMENT','REVERSAL')),
  debit_pesewas bigint not null default 0 check (debit_pesewas >= 0),
  credit_pesewas bigint not null default 0 check (credit_pesewas >= 0),
  balance_delta_pesewas bigint not null,
  resulting_balance_pesewas bigint not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint ledger_entry_one_direction check (not (debit_pesewas > 0 and credit_pesewas > 0))
);

create index if not exists ledger_entries_business_time_idx on public.ledger_entries (business_id, created_at desc);
create index if not exists ledger_entries_account_time_idx on public.ledger_entries (account_id, created_at desc);
create index if not exists ledger_entries_transaction_idx on public.ledger_entries (transaction_id);

create table if not exists public.commission_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  booth_id uuid not null references public.booths(id) on delete restrict,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  amount_pesewas bigint not null check (amount_pesewas >= 0),
  status text not null default 'EARNED' check (status in ('EARNED','RECEIVED','OUTSTANDING','NOT_APPLICABLE')),
  earned_at timestamptz not null default now(),
  received_at timestamptz,
  received_by uuid references auth.users(id) on delete restrict,
  notes text,
  unique (transaction_id)
);

create table if not exists public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  booth_id uuid references public.booths(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  amount_pesewas bigint not null check (amount_pesewas <> 0),
  reason text not null check (char_length(trim(reason)) >= 5),
  status text not null default 'POSTED' check (status in ('PENDING','POSTED','VOIDED')),
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

-- Make ledger source tables append-only to clients. RPCs below are the write path.
alter table public.financial_accounts enable row level security;
alter table public.transaction_accounting_treatments enable row level security;
alter table public.transaction_postings enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.commission_records enable row level security;
alter table public.financial_adjustments enable row level security;

create policy "Members can read financial accounts" on public.financial_accounts for select using (is_business_member(business_id));
create policy "Owners can manage accounting treatments" on public.transaction_accounting_treatments for all using (is_business_owner(business_id)) with check (is_business_owner(business_id) and created_by = auth.uid());
create policy "Members can read transaction postings" on public.transaction_postings for select using (is_business_member(business_id));
create policy "Members can read ledger entries" on public.ledger_entries for select using (is_business_member(business_id));
create policy "Members can read commission records" on public.commission_records for select using (is_business_member(business_id));
create policy "Owners can manage financial adjustments" on public.financial_adjustments for all using (is_business_owner(business_id)) with check (is_business_owner(business_id) and created_by = auth.uid());

grant select on public.financial_accounts, public.transaction_postings, public.ledger_entries, public.commission_records, public.transaction_accounting_treatments, public.financial_adjustments to authenticated;
grant insert, update on public.transaction_accounting_treatments, public.financial_adjustments to authenticated;

-- Seed the controlled account set from the actual Stage 2 opening balances.
insert into public.financial_accounts (business_id, booth_id, account_code, account_category, network, opening_balance_pesewas, current_balance_pesewas)
select b.id, null, 'CASH_ON_HAND', 'PHYSICAL_CASH', null, coalesce(ob.physical_cash_pesewas, 0), coalesce(ob.physical_cash_pesewas, 0)
from public.businesses b left join public.business_opening_balances ob on ob.business_id = b.id
on conflict (business_id, booth_id, account_code) do nothing;

insert into public.financial_accounts (business_id, booth_id, account_code, account_category, network, opening_balance_pesewas, current_balance_pesewas)
select ob.business_id, ob.booth_id, ob.network || '_FLOAT', 'ELECTRONIC_FLOAT', ob.network,
       ob.amount_pesewas, ob.amount_pesewas
from public.booth_opening_balances ob
on conflict (business_id, booth_id, account_code) do nothing;

create or replace function public.sync_opening_balance_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'business_opening_balances' then
    insert into public.financial_accounts (business_id, booth_id, account_code, account_category, network, opening_balance_pesewas, current_balance_pesewas)
    values (new.business_id, null, 'CASH_ON_HAND', 'PHYSICAL_CASH', null, new.physical_cash_pesewas, new.physical_cash_pesewas)
    on conflict (business_id, booth_id, account_code) do nothing;
  else
    insert into public.financial_accounts (business_id, booth_id, account_code, account_category, network, opening_balance_pesewas, current_balance_pesewas)
    values (new.business_id, new.booth_id, new.network || '_FLOAT', 'ELECTRONIC_FLOAT', new.network, new.amount_pesewas, new.amount_pesewas)
    on conflict (business_id, booth_id, account_code) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_business_opening_balance_account on public.business_opening_balances;
create trigger sync_business_opening_balance_account after insert on public.business_opening_balances for each row execute function public.sync_opening_balance_account();
drop trigger if exists sync_booth_opening_balance_account on public.booth_opening_balances;
create trigger sync_booth_opening_balance_account after insert on public.booth_opening_balances for each row execute function public.sync_opening_balance_account();

create or replace function public.refresh_financial_accounts_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists financial_accounts_updated_at on public.financial_accounts;
create trigger financial_accounts_updated_at before update on public.financial_accounts for each row execute function public.refresh_financial_accounts_updated_at();

create or replace function public.financial_account_id(target_business_id uuid, target_booth_id uuid, target_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.financial_accounts
  where business_id = target_business_id and booth_id is not distinct from target_booth_id and account_code = target_code
  limit 1;
$$;

create or replace function public.post_momo_transaction(target_transaction_id uuid, request_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tx public.transactions%rowtype;
  existing public.transaction_postings%rowtype;
  treatment public.transaction_accounting_treatments%rowtype;
  cash_account public.financial_accounts%rowtype;
  float_account public.financial_accounts%rowtype;
  posting public.transaction_postings%rowtype;
  delta_cash bigint := 0;
  delta_float bigint := 0;
  delta_charge bigint := 0;
  commission_status text := 'NOT_APPLICABLE';
  new_cash_balance bigint;
  new_float_balance bigint;
  entry_id uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if request_id is null or char_length(trim(request_id)) < 8 then raise exception using errcode = '22023', message = 'A stable posting request id is required'; end if;
  select * into tx from public.transactions where id = target_transaction_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Transaction not found'; end if;
  if not public.can_operate_booth(tx.business_id, tx.booth_id) then raise exception using errcode = '42501', message = 'You cannot operate this booth'; end if;
  if exists (select 1 from public.transaction_postings p where p.transaction_id = tx.id and p.posting_kind = 'ORIGINAL') then
    select * into existing from public.transaction_postings p where p.transaction_id = tx.id and p.posting_kind = 'ORIGINAL' limit 1;
    return jsonb_build_object('status','already_posted','posting_id',existing.id,'transaction_id',tx.id);
  end if;
  if exists (select 1 from public.transaction_postings p where p.idempotency_key = request_id) then
    select * into existing from public.transaction_postings p where p.idempotency_key = request_id limit 1;
    return jsonb_build_object('status','already_posted','posting_id',existing.id,'transaction_id',existing.transaction_id);
  end if;
  if tx.transaction_status <> 'SUCCESSFUL' then raise exception using errcode = '22023', message = 'Only successful transactions can be posted'; end if;
  if tx.confirmation_method is null then raise exception using errcode = '22023', message = 'A confirmation method is required'; end if;

  select * into cash_account from public.financial_accounts where business_id = tx.business_id and account_code = 'CASH_ON_HAND' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Opening physical cash account is missing'; end if;
  select * into float_account from public.financial_accounts where business_id = tx.business_id and booth_id = tx.booth_id and network = tx.network and account_category = 'ELECTRONIC_FLOAT' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Opening network float account is missing'; end if;

  if tx.transaction_type in ('AIRTIME','BILL_PAYMENT') then
    select * into treatment from public.transaction_accounting_treatments
    where business_id = tx.business_id and transaction_type = tx.transaction_type and network = tx.network limit 1;
    if not found or not treatment.float_settlement_enabled then
      raise exception using errcode = '22023', message = 'Accounting treatment is not configured; transaction requires financial review';
    end if;
  else
    select * into treatment from public.transaction_accounting_treatments
    where business_id = tx.business_id and transaction_type = tx.transaction_type and network = tx.network limit 1;
  end if;

  if tx.transaction_type = 'DEPOSIT' then
    delta_cash := tx.principal_amount_pesewas;
    delta_float := -tx.principal_amount_pesewas;
  elsif tx.transaction_type = 'WITHDRAWAL' then
    delta_cash := -tx.principal_amount_pesewas;
    delta_float := tx.principal_amount_pesewas;
  else
    delta_float := -tx.principal_amount_pesewas;
  end if;

  if found and treatment.cash_charge_mode in ('CASH_IN','DEDUCT_FROM_PAYOUT') then delta_charge := tx.customer_charge_pesewas;
  end if;
  new_cash_balance := cash_account.current_balance_pesewas + delta_cash;
  new_float_balance := float_account.current_balance_pesewas + delta_float;
  if (new_cash_balance < 0 and not cash_account.allow_overdraft) then raise exception using errcode = '23514', message = 'Insufficient physical cash for this posting'; end if;
  if (new_float_balance < 0 and not float_account.allow_overdraft) then raise exception using errcode = '23514', message = 'Insufficient network float for this posting'; end if;

  insert into public.transaction_postings (business_id, booth_id, transaction_id, posting_reference, idempotency_key, posted_by)
  values (tx.business_id, tx.booth_id, tx.id, 'POST-' || tx.internal_reference, request_id, auth.uid()) returning * into posting;

  update public.financial_accounts set current_balance_pesewas = new_cash_balance where id = cash_account.id;
  insert into public.ledger_entries (posting_id,business_id,booth_id,transaction_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description)
  values (posting.id,tx.business_id,tx.booth_id,tx.id,cash_account.id,'TRANSACTION_PRINCIPAL',case when delta_cash < 0 then -delta_cash else 0 end,case when delta_cash > 0 then delta_cash else 0 end,delta_cash,new_cash_balance,'Physical cash movement for ' || tx.transaction_type);

  if delta_charge > 0 then
    new_cash_balance := new_cash_balance + delta_charge;
    update public.financial_accounts set current_balance_pesewas = new_cash_balance where id = cash_account.id;
    insert into public.ledger_entries (posting_id,business_id,booth_id,transaction_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description)
    values (posting.id,tx.business_id,tx.booth_id,tx.id,cash_account.id,'CUSTOMER_CHARGE',0,delta_charge,delta_charge,new_cash_balance,'Separately collected customer charge');
  end if;

  update public.financial_accounts set current_balance_pesewas = new_float_balance where id = float_account.id;
  insert into public.ledger_entries (posting_id,business_id,booth_id,transaction_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description)
  values (posting.id,tx.business_id,tx.booth_id,tx.id,float_account.id,'TRANSACTION_PRINCIPAL',case when delta_float < 0 then -delta_float else 0 end,case when delta_float > 0 then delta_float else 0 end,delta_float,new_float_balance,'Electronic float movement for ' || tx.transaction_type);

  if tx.agent_commission_pesewas > 0 then
    if found and treatment.commission_received_by_default then commission_status := 'RECEIVED'; else commission_status := 'EARNED'; end if;
    insert into public.commission_records (business_id,booth_id,transaction_id,amount_pesewas,status,received_by,received_at)
    values (tx.business_id,tx.booth_id,tx.id,tx.agent_commission_pesewas,commission_status,case when commission_status='RECEIVED' then auth.uid() end,case when commission_status='RECEIVED' then now() end);
  end if;
  return jsonb_build_object('status','posted','posting_id',posting.id,'cash_balance_pesewas',new_cash_balance,'float_balance_pesewas',new_float_balance,'commission_status',commission_status);
exception when unique_violation then
  select * into existing from public.transaction_postings p where p.transaction_id = target_transaction_id and p.posting_kind = 'ORIGINAL' limit 1;
  if existing.id is not null then return jsonb_build_object('status','already_posted','posting_id',existing.id,'transaction_id',target_transaction_id); end if;
  raise;
end;
$$;

create or replace function public.reverse_momo_transaction(target_transaction_id uuid, reversal_reason text, request_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tx public.transactions%rowtype;
  original public.transaction_postings%rowtype;
  existing public.transaction_postings%rowtype;
  e record;
  account_row public.financial_accounts%rowtype;
  posting public.transaction_postings%rowtype;
  new_balance bigint;
begin
  if auth.uid() is null or not public.is_business_owner((select business_id from public.transactions where id=target_transaction_id)) then raise exception using errcode='42501', message='Owner authorisation required'; end if;
  if char_length(trim(coalesce(reversal_reason,''))) < 5 then raise exception using errcode='22023', message='A reversal reason is required'; end if;
  select * into tx from public.transactions where id=target_transaction_id for update;
  if not found then raise exception using errcode='P0002', message='Transaction not found'; end if;
  select * into original from public.transaction_postings where transaction_id=tx.id and posting_kind='ORIGINAL' limit 1;
  if not found then raise exception using errcode='22023', message='Transaction has not been posted'; end if;
  if exists (select 1 from public.transaction_postings where transaction_id=tx.id and posting_kind='REVERSAL') then
    select * into existing from public.transaction_postings where transaction_id=tx.id and posting_kind='REVERSAL' limit 1;
    return jsonb_build_object('status','already_reversed','posting_id',existing.id);
  end if;
  if exists (select 1 from public.transaction_postings where idempotency_key=request_id) then
    select * into existing from public.transaction_postings where idempotency_key=request_id limit 1;
    return jsonb_build_object('status','already_reversed','posting_id',existing.id);
  end if;
  insert into public.transaction_postings (business_id,booth_id,transaction_id,posting_reference,idempotency_key,posting_kind,original_posting_id,posted_by)
  values (tx.business_id,tx.booth_id,tx.id,'REV-'||tx.internal_reference,request_id,'REVERSAL',original.id,auth.uid()) returning * into posting;
  for e in select * from public.ledger_entries where posting_id=original.id order by created_at loop
    select * into account_row from public.financial_accounts where id=e.account_id for update;
    new_balance := account_row.current_balance_pesewas - e.balance_delta_pesewas;
    if new_balance < 0 and not account_row.allow_overdraft then raise exception using errcode='23514', message='Reversal would create a negative balance; owner adjustment or review is required'; end if;
    update public.financial_accounts set current_balance_pesewas=new_balance where id=account_row.id;
    insert into public.ledger_entries (posting_id,business_id,booth_id,transaction_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description)
    values (posting.id,tx.business_id,tx.booth_id,tx.id,e.account_id,'REVERSAL',case when -e.balance_delta_pesewas < 0 then e.balance_delta_pesewas else 0 end,case when -e.balance_delta_pesewas > 0 then -e.balance_delta_pesewas else 0 end,-e.balance_delta_pesewas,new_balance,'Reversal: '||reversal_reason);
  end loop;
  update public.transactions set transaction_status='REVERSED', updated_at=now() where id=tx.id;
  update public.commission_records set status='NOT_APPLICABLE', notes=coalesce(notes||' ','')||'Reversed: '||reversal_reason where transaction_id=tx.id;
  return jsonb_build_object('status','reversed','posting_id',posting.id,'transaction_id',tx.id);
end;
$$;

create or replace function public.financial_dashboard(target_business_id uuid, target_booth_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_business_member(target_business_id) then raise exception using errcode='42501', message='Business access denied'; end if;
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'code',a.account_code,'category',a.account_category,'network',a.network,'booth_id',a.booth_id,'balance_pesewas',a.current_balance_pesewas) order by a.account_category,a.network) from public.financial_accounts a where a.business_id=target_business_id and (target_booth_id is null or a.booth_id=target_booth_id or a.booth_id is null)), '[]'::jsonb),
    'activity', jsonb_build_object(
      'successful_deposit_volume_pesewas', coalesce((select sum(t.principal_amount_pesewas) from public.transactions t where t.business_id=target_business_id and t.transaction_status='SUCCESSFUL' and t.transaction_type='DEPOSIT' and (target_booth_id is null or t.booth_id=target_booth_id)),0),
      'successful_withdrawal_volume_pesewas', coalesce((select sum(t.principal_amount_pesewas) from public.transactions t where t.business_id=target_business_id and t.transaction_status='SUCCESSFUL' and t.transaction_type='WITHDRAWAL' and (target_booth_id is null or t.booth_id=target_booth_id)),0),
      'airtime_volume_pesewas', coalesce((select sum(t.principal_amount_pesewas) from public.transactions t where t.business_id=target_business_id and t.transaction_status='SUCCESSFUL' and t.transaction_type='AIRTIME' and (target_booth_id is null or t.booth_id=target_booth_id)),0),
      'bill_payment_volume_pesewas', coalesce((select sum(t.principal_amount_pesewas) from public.transactions t where t.business_id=target_business_id and t.transaction_status='SUCCESSFUL' and t.transaction_type='BILL_PAYMENT' and (target_booth_id is null or t.booth_id=target_booth_id)),0),
      'commission_earned_pesewas', coalesce((select sum(c.amount_pesewas) from public.commission_records c where c.business_id=target_business_id and c.status in ('EARNED','RECEIVED') and (target_booth_id is null or c.booth_id=target_booth_id)),0),
      'commission_received_pesewas', coalesce((select sum(c.amount_pesewas) from public.commission_records c where c.business_id=target_business_id and c.status='RECEIVED' and (target_booth_id is null or c.booth_id=target_booth_id)),0),
      'pending_transactions', (select count(*) from public.transactions t where t.business_id=target_business_id and t.transaction_status='PENDING' and (target_booth_id is null or t.booth_id=target_booth_id)),
      'requires_review', (select count(*) from public.transactions t where t.business_id=target_business_id and t.transaction_status='SUCCESSFUL' and t.transaction_type in ('AIRTIME','BILL_PAYMENT') and not exists (select 1 from public.transaction_accounting_treatments at where at.business_id=t.business_id and at.transaction_type=t.transaction_type and at.network=t.network and at.float_settlement_enabled) and (target_booth_id is null or t.booth_id=target_booth_id))
    )
  ) into result;
  return result;
end;
$$;

grant execute on function public.post_momo_transaction(uuid,text) to authenticated;
grant execute on function public.reverse_momo_transaction(uuid,text,text) to authenticated;
grant execute on function public.financial_dashboard(uuid,uuid) to authenticated;
