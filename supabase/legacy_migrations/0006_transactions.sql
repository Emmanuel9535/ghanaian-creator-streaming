-- MoMo Ledger Stage 3: core transaction recording.
-- Financial amounts are integer pesewas. These records are operational inputs only;
-- Stage 4 will calculate settled cash/float movements and commissions.

create sequence if not exists public.momo_transaction_reference_seq;

create or replace function public.generate_momo_transaction_reference()
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  return 'MOMO-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.momo_transaction_reference_seq')::text, 6, '0');
end;
$$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone_normalized text not null check (char_length(phone_normalized) between 8 and 15),
  phone_display text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, phone_normalized)
);
create index if not exists customers_business_phone_idx on public.customers(business_id, phone_normalized);
create index if not exists customers_business_name_idx on public.customers(business_id, full_name);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  internal_reference text not null unique default public.generate_momo_transaction_reference(),
  idempotency_key text not null unique default gen_random_uuid()::text,
  provider_reference text,
  business_id uuid not null references public.businesses(id) on delete restrict,
  booth_id uuid not null references public.booths(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  attendant_id uuid not null references auth.users(id) on delete restrict,
  network text not null check (network in ('MTN','TELECEL','AT')),
  transaction_type text not null check (transaction_type in ('DEPOSIT','WITHDRAWAL','AIRTIME','BILL_PAYMENT')),
  principal_amount_pesewas bigint not null check (principal_amount_pesewas > 0),
  customer_charge_pesewas bigint not null default 0 check (customer_charge_pesewas >= 0),
  agent_commission_pesewas bigint not null default 0 check (agent_commission_pesewas >= 0),
  customer_phone text not null check (char_length(customer_phone) between 7 and 30),
  customer_name_snapshot text,
  bill_category text,
  customer_account_reference text,
  transaction_status text not null default 'PENDING' check (transaction_status in ('PENDING','SUCCESSFUL','FAILED','REVERSED')),
  confirmation_method text check (confirmation_method is null or confirmation_method in ('ATTENDANT_RECORDED','MANUALLY_CONFIRMED')),
  notes text,
  transaction_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (transaction_type <> 'BILL_PAYMENT' or (bill_category is not null and customer_account_reference is not null)),
  check (transaction_type = 'BILL_PAYMENT' or bill_category is null),
  check (transaction_status <> 'SUCCESSFUL' or confirmation_method is not null)
);
create index if not exists transactions_business_created_idx on public.transactions(business_id, created_at desc);
create index if not exists transactions_business_status_idx on public.transactions(business_id, transaction_status, created_at desc);
create index if not exists transactions_business_type_idx on public.transactions(business_id, transaction_type, created_at desc);
create index if not exists transactions_business_network_idx on public.transactions(business_id, network, created_at desc);
create index if not exists transactions_customer_phone_idx on public.transactions(business_id, customer_phone);
create index if not exists transactions_provider_reference_idx on public.transactions(business_id, provider_reference);

create table if not exists public.transaction_status_history (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('PENDING','SUCCESSFUL','FAILED','REVERSED')),
  reason text,
  changed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists transaction_status_history_transaction_idx on public.transaction_status_history(transaction_id, created_at desc);

create or replace function public.touch_customer_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers for each row execute procedure public.touch_customer_updated_at();

create or replace function public.record_transaction_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.transaction_status_history (transaction_id, business_id, from_status, to_status, reason, changed_by)
  values (new.id, new.business_id, case when tg_op = 'UPDATE' then old.transaction_status else null end, new.transaction_status, case when tg_op = 'INSERT' then 'Initial operational record' else 'Status change' end, auth.uid());
  return new;
end;
$$;
drop trigger if exists transactions_status_history on public.transactions;
create trigger transactions_status_history after insert or update of transaction_status on public.transactions for each row execute procedure public.record_transaction_status();

create or replace function public.can_operate_booth(target_business_id uuid, target_booth_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = target_business_id and m.user_id = auth.uid() and m.status = 'active'
      and (m.role = 'OWNER' or (m.role = 'ATTENDANT' and m.booth_id = target_booth_id))
  );
$$;

alter table public.customers enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_status_history enable row level security;

drop policy if exists "Members can read customers" on public.customers;
create policy "Members can read customers" on public.customers for select using (public.is_business_member(business_id));
drop policy if exists "Operators can create customers" on public.customers;
create policy "Operators can create customers" on public.customers for insert with check (public.is_business_member(business_id));
drop policy if exists "Operators can update customers" on public.customers;
create policy "Operators can update customers" on public.customers for update using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

drop policy if exists "Operators can read transactions" on public.transactions;
create policy "Operators can read transactions" on public.transactions for select using (public.can_operate_booth(business_id, booth_id));
drop policy if exists "Operators can create transactions" on public.transactions;
create policy "Operators can create transactions" on public.transactions for insert with check (public.can_operate_booth(business_id, booth_id) and attendant_id = auth.uid());
-- No update/delete policy: operational records are append-only in Stage 3.

drop policy if exists "Operators can read transaction status history" on public.transaction_status_history;
create policy "Operators can read transaction status history" on public.transaction_status_history for select using (public.is_business_member(business_id));
