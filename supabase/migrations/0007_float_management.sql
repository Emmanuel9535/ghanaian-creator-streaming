-- MoMo Ledger Stage 4: float management.
-- Extends the existing financial_accounts / transaction_postings / ledger_entries model.
-- No historical rows are updated or deleted.

create table if not exists public.float_thresholds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booth_id uuid not null references public.booths(id) on delete cascade,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  threshold_pesewas bigint not null check (threshold_pesewas >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booth_id, account_id)
);

create index if not exists float_thresholds_business_booth_idx
  on public.float_thresholds(business_id, booth_id);

create table if not exists public.float_threshold_history (
  id uuid primary key default gen_random_uuid(),
  threshold_id uuid not null references public.float_thresholds(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  booth_id uuid not null references public.booths(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  previous_threshold_pesewas bigint,
  new_threshold_pesewas bigint not null check (new_threshold_pesewas >= 0),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create index if not exists float_threshold_history_lookup_idx
  on public.float_threshold_history(business_id, booth_id, changed_at desc);

alter table public.float_thresholds enable row level security;
alter table public.float_threshold_history enable row level security;

drop policy if exists "Members can read float thresholds" on public.float_thresholds;
create policy "Members can read float thresholds" on public.float_thresholds
  for select using (public.is_business_member(business_id));

drop policy if exists "Owners can manage float thresholds" on public.float_thresholds;
create policy "Owners can manage float thresholds" on public.float_thresholds
  for all using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id) and updated_by = auth.uid());

drop policy if exists "Owners can read float threshold history" on public.float_threshold_history;
create policy "Owners can read float threshold history" on public.float_threshold_history
  for select using (public.is_business_owner(business_id));

create or replace function public.set_float_threshold(
  target_business_id uuid,
  target_booth_id uuid,
  target_account_id uuid,
  target_threshold_pesewas bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.financial_accounts%rowtype;
  threshold_row public.float_thresholds%rowtype;
  previous_value bigint;
begin
  if auth.uid() is null or not public.is_business_owner(target_business_id) then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;
  if target_threshold_pesewas is null or target_threshold_pesewas < 0 then
    raise exception using errcode = '22023', message = 'Threshold cannot be negative';
  end if;
  if not exists (select 1 from public.booths b where b.id = target_booth_id and b.business_id = target_business_id) then
    raise exception using errcode = '42501', message = 'Booth access denied';
  end if;
  select * into account_row
  from public.financial_accounts
  where id = target_account_id
    and business_id = target_business_id
    and (account_category = 'ELECTRONIC_FLOAT' and booth_id = target_booth_id)
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Only a booth network float account can have a threshold';
  end if;

  select * into threshold_row from public.float_thresholds
  where booth_id = target_booth_id and account_id = target_account_id for update;
  previous_value := threshold_row.threshold_pesewas;
  if threshold_row.id is null then
    insert into public.float_thresholds (business_id, booth_id, account_id, threshold_pesewas, created_by, updated_by)
    values (target_business_id, target_booth_id, target_account_id, target_threshold_pesewas, auth.uid(), auth.uid())
    returning * into threshold_row;
  else
    update public.float_thresholds
       set threshold_pesewas = target_threshold_pesewas, updated_by = auth.uid(), updated_at = now()
     where id = threshold_row.id
    returning * into threshold_row;
  end if;
  insert into public.float_threshold_history
    (threshold_id, business_id, booth_id, account_id, previous_threshold_pesewas, new_threshold_pesewas, changed_by)
  values
    (threshold_row.id, target_business_id, target_booth_id, target_account_id, previous_value, target_threshold_pesewas, auth.uid());
  return jsonb_build_object('threshold_id', threshold_row.id, 'threshold_pesewas', threshold_row.threshold_pesewas);
end;
$$;

create or replace function public.record_float_movement(
  target_business_id uuid,
  target_booth_id uuid,
  target_account_id uuid,
  target_movement_type text,
  target_amount_pesewas bigint,
  target_description text,
  request_id text,
  target_destination_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_account public.financial_accounts%rowtype;
  destination_account public.financial_accounts%rowtype;
  existing_posting public.transaction_postings%rowtype;
  posting public.transaction_postings%rowtype;
  source_delta bigint;
  destination_delta bigint;
  source_balance bigint;
  destination_balance bigint;
  label text;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if request_id is null or char_length(trim(request_id)) < 8 then raise exception using errcode = '22023', message = 'A stable movement request id is required'; end if;
  if target_amount_pesewas is null or target_amount_pesewas <= 0 then raise exception using errcode = '22023', message = 'Amount must be greater than zero'; end if;
  if target_movement_type not in ('DEPOSIT','WITHDRAWAL','ADJUSTMENT','TRANSFER') then raise exception using errcode = '22023', message = 'Invalid float movement type'; end if;
  if not public.can_operate_booth(target_business_id, target_booth_id) then raise exception using errcode = '42501', message = 'You cannot operate this booth'; end if;

  select * into existing_posting from public.transaction_postings where idempotency_key = request_id limit 1;
  if found then
    if existing_posting.business_id = target_business_id and existing_posting.booth_id = target_booth_id then
      return jsonb_build_object('status','already_recorded','posting_id',existing_posting.id);
    end if;
    raise exception using errcode = '23505', message = 'Idempotency key conflict';
  end if;

  select * into source_account from public.financial_accounts
  where id = target_account_id and business_id = target_business_id
    and (account_category = 'PHYSICAL_CASH' or (account_category = 'ELECTRONIC_FLOAT' and booth_id = target_booth_id))
  for update;
  if not found then raise exception using errcode = '42501', message = 'Source account access denied'; end if;

  if target_movement_type = 'TRANSFER' then
    if target_destination_account_id is null or target_destination_account_id = target_account_id then
      raise exception using errcode = '22023', message = 'A different destination account is required';
    end if;
    select * into destination_account from public.financial_accounts
    where id = target_destination_account_id and business_id = target_business_id
      and (account_category = 'PHYSICAL_CASH' or (account_category = 'ELECTRONIC_FLOAT' and booth_id = target_booth_id))
    for update;
    if not found then raise exception using errcode = '42501', message = 'Destination account access denied'; end if;
    source_delta := -target_amount_pesewas;
    destination_delta := target_amount_pesewas;
  elsif target_movement_type = 'DEPOSIT' then
    source_delta := target_amount_pesewas;
  elsif target_movement_type = 'WITHDRAWAL' then
    source_delta := -target_amount_pesewas;
  else
    source_delta := target_amount_pesewas;
  end if;

  source_balance := source_account.current_balance_pesewas + source_delta;
  if source_balance < 0 and not source_account.allow_overdraft then raise exception using errcode = '23514', message = 'Insufficient source account balance'; end if;
  if target_movement_type = 'TRANSFER' then
    destination_balance := destination_account.current_balance_pesewas + destination_delta;
    if destination_balance < 0 and not destination_account.allow_overdraft then raise exception using errcode = '23514', message = 'Insufficient destination account balance'; end if;
  end if;

  label := case when target_movement_type = 'TRANSFER' then 'Float transfer' else 'Float ' || lower(target_movement_type) end;
  insert into public.transaction_postings
    (business_id, booth_id, posting_reference, idempotency_key, posting_kind, posted_by)
  values
    (target_business_id, target_booth_id, 'FLT-' || upper(target_movement_type) || '-' || left(md5(request_id), 16), request_id, 'ORIGINAL', auth.uid())
  returning * into posting;

  update public.financial_accounts set current_balance_pesewas = source_balance where id = source_account.id;
  insert into public.ledger_entries
    (posting_id, business_id, booth_id, account_id, entry_type, debit_pesewas, credit_pesewas, balance_delta_pesewas, resulting_balance_pesewas, description)
  values
    (posting.id, target_business_id, target_booth_id, source_account.id, 'ADJUSTMENT',
     case when source_delta < 0 then -source_delta else 0 end,
     case when source_delta > 0 then source_delta else 0 end,
     source_delta, source_balance, coalesce(nullif(trim(target_description), ''), label));

  if target_movement_type = 'TRANSFER' then
    update public.financial_accounts set current_balance_pesewas = destination_balance where id = destination_account.id;
    insert into public.ledger_entries
      (posting_id, business_id, booth_id, account_id, entry_type, debit_pesewas, credit_pesewas, balance_delta_pesewas, resulting_balance_pesewas, description)
    values
      (posting.id, target_business_id, target_booth_id, destination_account.id, 'ADJUSTMENT',
       case when destination_delta < 0 then -destination_delta else 0 end,
       case when destination_delta > 0 then destination_delta else 0 end,
       destination_delta, destination_balance, coalesce(nullif(trim(target_description), ''), label));
  end if;

  return jsonb_build_object('status','recorded','posting_id',posting.id,'source_balance_pesewas',source_balance,
    'destination_balance_pesewas',case when target_movement_type = 'TRANSFER' then destination_balance else null end);
exception when unique_violation then
  select * into existing_posting from public.transaction_postings where idempotency_key = request_id limit 1;
  if existing_posting.id is not null then return jsonb_build_object('status','already_recorded','posting_id',existing_posting.id); end if;
  raise;
end;
$$;

revoke all on function public.set_float_threshold(uuid,uuid,uuid,bigint) from public, anon;
grant execute on function public.set_float_threshold(uuid,uuid,uuid,bigint) to authenticated;
revoke all on function public.record_float_movement(uuid,uuid,uuid,text,bigint,text,text,uuid) from public, anon;
grant execute on function public.record_float_movement(uuid,uuid,uuid,text,bigint,text,text,uuid) to authenticated;
