-- MoMo Ledger: transaction experience refinement
create table if not exists public.transaction_daily_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  business_date date not null,
  next_number bigint not null default 1 check (next_number > 0),
  primary key (business_id, business_date)
);

alter table public.transactions add column if not exists transaction_number bigint;
alter table public.transactions add column if not exists business_date date;

alter table public.transactions drop constraint if exists transactions_transaction_type_check;
alter table public.transactions add constraint transactions_transaction_type_check check (transaction_type in ('DEPOSIT','WITHDRAWAL','AIRTIME','BILL_PAYMENT','DATA_BUNDLE'));
alter table public.transactions drop constraint if exists transactions_transaction_status_check;
alter table public.transactions add constraint transactions_transaction_status_check check (transaction_status in ('DRAFT','PENDING','AWAITING_PROCESSING','PROCESSING','SUCCESSFUL','FAILED','REVERSED','CANCELLED'));
alter table public.transaction_status_history drop constraint if exists transaction_status_history_to_status_check;
alter table public.transaction_status_history add constraint transaction_status_history_to_status_check check (to_status in ('DRAFT','PENDING','AWAITING_PROCESSING','PROCESSING','SUCCESSFUL','FAILED','REVERSED','CANCELLED'));

with numbered as (
  select id, row_number() over (partition by business_id, (transaction_at at time zone 'Africa/Accra')::date order by created_at, id) as n, (transaction_at at time zone 'Africa/Accra')::date as d
  from public.transactions where transaction_number is null
)
update public.transactions t set transaction_number=n.n, business_date=n.d from numbered n where t.id=n.id;
update public.transactions set business_date=(transaction_at at time zone 'Africa/Accra')::date where business_date is null;
insert into public.transaction_daily_counters(business_id,business_date,next_number)
select business_id,business_date,coalesce(max(transaction_number),0)+1 from public.transactions group by business_id,business_date
on conflict (business_id,business_date) do update set next_number=greatest(transaction_daily_counters.next_number,excluded.next_number);
alter table public.transactions alter column transaction_number set not null;
alter table public.transactions alter column business_date set not null;
create unique index if not exists transactions_business_day_number_idx on public.transactions(business_id,business_date,transaction_number);
create index if not exists transactions_business_day_idx on public.transactions(business_id,business_date,transaction_number);

create or replace function public.assign_transaction_number() returns trigger language plpgsql security definer set search_path=public as $$
declare assigned bigint; local_date date;
begin
  local_date := coalesce(new.business_date,(new.transaction_at at time zone 'Africa/Accra')::date);
  if new.transaction_number is null then
    insert into public.transaction_daily_counters(business_id,business_date,next_number) values(new.business_id,local_date,2)
    on conflict (business_id,business_date) do update set next_number=public.transaction_daily_counters.next_number+1
    returning next_number-1 into assigned;
    new.transaction_number := assigned;
  end if;
  new.business_date := local_date;
  return new;
end; $$;
drop trigger if exists transactions_assign_number on public.transactions;
create trigger transactions_assign_number before insert on public.transactions for each row execute function public.assign_transaction_number();

-- Operational records may be corrected before successful posting, but posted financial records remain append-only.
drop policy if exists "Operators can update transaction drafts" on public.transactions;
create policy "Operators can update transaction drafts" on public.transactions for update using (
  public.can_operate_booth(business_id,booth_id) and transaction_status in ('DRAFT','PENDING','AWAITING_PROCESSING','PROCESSING','FAILED','CANCELLED')
) with check (
  public.can_operate_booth(business_id,booth_id) and transaction_status in ('DRAFT','PENDING','AWAITING_PROCESSING','PROCESSING','FAILED','CANCELLED','SUCCESSFUL')
);

grant select,update on public.transactions to authenticated;

create table if not exists public.sales_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booth_id uuid not null references public.booths(id) on delete restrict,
  receipt_number text not null unique,
  item_description text not null check (char_length(trim(item_description)) between 2 and 240),
  quantity bigint not null check (quantity > 0),
  unit_price_pesewas bigint not null check (unit_price_pesewas >= 0),
  total_pesewas bigint not null check (total_pesewas >= 0),
  payment_method text not null check (payment_method in ('CASH','MTN','TELECEL','AT','OTHER')),
  customer_phone text,
  customer_name text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists sales_receipts_business_date_idx on public.sales_receipts(business_id,created_at desc);
alter table public.sales_receipts enable row level security;
create policy "Operators can read sales receipts" on public.sales_receipts for select using (public.can_operate_booth(business_id,booth_id));
create policy "Operators can create sales receipts" on public.sales_receipts for insert with check (public.can_operate_booth(business_id,booth_id) and recorded_by=auth.uid());
grant select,insert on public.sales_receipts to authenticated;
