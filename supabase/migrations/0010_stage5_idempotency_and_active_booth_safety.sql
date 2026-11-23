-- Stage 5.1 safety: make first-business creation atomic/idempotent and prevent
-- expense create/post operations against inactive booths. No financial rows are changed.

create table if not exists public.business_setup_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (char_length(trim(request_id)) >= 8),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.business_setup_requests enable row level security;
revoke all on table public.business_setup_requests from public, anon, authenticated, service_role;

create or replace function public.create_business_setup(
  request_id text,
  business_name text,
  business_type text,
  owner_name text,
  contact_phone text,
  contact_email text,
  region text,
  town_city text,
  address text,
  digital_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  request_payload jsonb;
  existing public.business_setup_requests%rowtype;
  created_business_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if $1 is null or char_length(trim($1)) < 8 then
    raise exception using errcode = '22023', message = 'A stable setup request id is required';
  end if;
  request_payload := jsonb_build_object(
    'name', trim(coalesce(business_name, '')),
    'business_type', trim(coalesce(business_type, '')),
    'owner_name', trim(coalesce(owner_name, '')),
    'contact_phone', trim(coalesce(contact_phone, '')),
    'contact_email', lower(trim(coalesce(contact_email, ''))),
    'region', trim(coalesce(region, '')),
    'town_city', trim(coalesce(town_city, '')),
    'address', trim(coalesce(address, '')),
    'digital_address', nullif(trim(coalesce(digital_address, '')), '')
  );

  select * into existing
  from public.business_setup_requests r
  where r.user_id = caller_id and r.request_id = trim($1);
  if found then
    if existing.payload is distinct from request_payload then
      raise exception using errcode = '23505', message = 'Setup idempotency key conflict';
    end if;
    return jsonb_build_object('status', 'already_created', 'business_id', existing.business_id);
  end if;

  insert into public.businesses (
    owner_id, name, business_type, owner_name, contact_phone, contact_email,
    region, town_city, address, digital_address
  ) values (
    caller_id,
    request_payload->>'name',
    request_payload->>'business_type',
    request_payload->>'owner_name',
    request_payload->>'contact_phone',
    request_payload->>'contact_email',
    request_payload->>'region',
    request_payload->>'town_city',
    request_payload->>'address',
    request_payload->>'digital_address'
  ) returning id into created_business_id;

  insert into public.business_members (business_id, user_id, role, status)
  values (created_business_id, caller_id, 'OWNER', 'active');
  insert into public.business_settings (business_id) values (created_business_id);
  insert into public.business_setup_requests (user_id, request_id, business_id, payload)
  values (caller_id, trim($1), created_business_id, request_payload);

  return jsonb_build_object('status', 'created', 'business_id', created_business_id);
exception when unique_violation then
  -- The entire attempted create is rolled back before resolving a concurrent retry.
  select * into existing
  from public.business_setup_requests r
  where r.user_id = caller_id and r.request_id = trim($1);
  if found then
    if existing.payload is distinct from request_payload then
      raise exception using errcode = '23505', message = 'Setup idempotency key conflict';
    end if;
    return jsonb_build_object('status', 'already_created', 'business_id', existing.business_id);
  end if;
  raise;
end;
$$;
revoke all on function public.create_business_setup(text, text, text, text, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.create_business_setup(text, text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.can_write_active_booth(target_business_id uuid, target_booth_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.booths b
    where b.id = target_booth_id and b.business_id = target_business_id and b.status = 'active'
  ) and public.can_operate_booth(target_business_id, target_booth_id);
$$;
revoke all on function public.can_write_active_booth(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public._post_expense_locked(target_expense_id uuid, actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expense_row public.expenses%rowtype;
  account_row public.financial_accounts%rowtype;
  original public.transaction_postings%rowtype;
  posting public.transaction_postings%rowtype;
  new_balance bigint;
begin
  select * into expense_row from public.expenses where id = target_expense_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Expense not found'; end if;
  if expense_row.status = 'POSTED' then
    select * into original from public.transaction_postings where expense_id = target_expense_id and posting_kind = 'EXPENSE' limit 1;
    return jsonb_build_object('status', 'already_posted', 'expense_id', target_expense_id, 'posting_id', original.id);
  end if;
  if expense_row.status <> 'APPROVED' then raise exception using errcode = '22023', message = 'Only approved expenses can be posted'; end if;
  if not public.can_write_active_booth(expense_row.business_id, expense_row.booth_id) then
    raise exception using errcode = '42501', message = 'You cannot post an expense for an inactive or unauthorized booth';
  end if;
  select * into account_row from public.financial_accounts where id = expense_row.payment_source_account_id and business_id = expense_row.business_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payment source account not found'; end if;
  if account_row.account_category not in ('PHYSICAL_CASH', 'ELECTRONIC_FLOAT') then raise exception using errcode = '22023', message = 'This account cannot pay an expense'; end if;
  if account_row.account_category = 'ELECTRONIC_FLOAT' and account_row.booth_id is distinct from expense_row.booth_id then
    raise exception using errcode = '42501', message = 'Expense payment source must belong to the selected booth';
  end if;
  new_balance := account_row.current_balance_pesewas - expense_row.amount_pesewas;
  if new_balance < 0 and not account_row.allow_overdraft then raise exception using errcode = '23514', message = 'Insufficient balance for this expense'; end if;
  insert into public.transaction_postings(business_id, booth_id, transaction_id, expense_id, posting_reference, idempotency_key, posting_kind, posted_by)
  values (expense_row.business_id, expense_row.booth_id, null, expense_row.id, 'EXP-' || expense_row.internal_reference, expense_row.idempotency_key, 'EXPENSE', actor_id)
  returning * into posting;
  update public.financial_accounts set current_balance_pesewas = new_balance where id = account_row.id;
  insert into public.ledger_entries(posting_id, business_id, booth_id, transaction_id, expense_id, account_id, entry_type, debit_pesewas, credit_pesewas, balance_delta_pesewas, resulting_balance_pesewas, description)
  values (posting.id, expense_row.business_id, expense_row.booth_id, null, expense_row.id, account_row.id, 'EXPENSE', expense_row.amount_pesewas, 0, -expense_row.amount_pesewas, new_balance, 'Expense: ' || expense_row.description);
  update public.expenses set status = 'POSTED', posted_by = actor_id, posted_at = now(), updated_at = now() where id = expense_row.id;
  insert into public.expense_status_history(expense_id, business_id, from_status, to_status, reason, changed_by)
  values (expense_row.id, expense_row.business_id, 'APPROVED', 'POSTED', 'Atomic ledger posting completed', actor_id);
  return jsonb_build_object('status', 'posted', 'expense_id', expense_row.id, 'posting_id', posting.id, 'balance_pesewas', new_balance);
exception when unique_violation then
  select * into original from public.transaction_postings where expense_id = target_expense_id and posting_kind = 'EXPENSE' limit 1;
  if original.id is not null then return jsonb_build_object('status', 'already_posted', 'expense_id', target_expense_id, 'posting_id', original.id); end if;
  raise;
end;
$$;
revoke all on function public._post_expense_locked(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public._post_expense_locked(uuid, uuid) to postgres;

create or replace function public.record_expense(
  target_business_id uuid,
  target_booth_id uuid,
  target_category_id uuid,
  expense_description text,
  amount_pesewas bigint,
  expense_at_value timestamp with time zone,
  payment_source_account_id uuid,
  payee_value text,
  notes_value text,
  request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_owner boolean;
  expense_row public.expenses%rowtype;
  initial_status text;
  category_business uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if request_id is null or char_length(trim(request_id)) < 8 then raise exception using errcode = '22023', message = 'A stable expense request id is required'; end if;
  -- Resolve a committed retry before checking mutable booth/category state. This
  -- lets the same authorized caller learn the committed outcome after a timeout.
  select * into expense_row from public.expenses where idempotency_key = trim(request_id) limit 1;
  if found then
    if expense_row.business_id is distinct from target_business_id
      or expense_row.booth_id is distinct from target_booth_id
      or expense_row.recorded_by is distinct from auth.uid()
      or expense_row.category_id is distinct from target_category_id
      or expense_row.description is distinct from trim(expense_description)
      or expense_row.amount_pesewas is distinct from amount_pesewas
      or expense_row.payment_source_account_id is distinct from payment_source_account_id
      or expense_row.payee is distinct from nullif(trim(payee_value), '')
      or expense_row.notes is distinct from nullif(trim(notes_value), '')
      or (expense_at_value is not null and expense_row.expense_at is distinct from expense_at_value)
      or not public.can_operate_booth(expense_row.business_id, expense_row.booth_id) then
      raise exception using errcode = '23505', message = 'Idempotency key conflict';
    end if;
    if expense_row.status = 'POSTED' then return jsonb_build_object('status', 'already_posted', 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference); end if;
    if expense_row.status = 'PENDING_APPROVAL' then return jsonb_build_object('status', 'pending_approval', 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference); end if;
    if expense_row.status = 'REVERSED' then return jsonb_build_object('status', 'already_reversed', 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference); end if;
    return jsonb_build_object('status', lower(expense_row.status), 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference);
  end if;
  if not public.can_write_active_booth(target_business_id, target_booth_id) then
    raise exception using errcode = '42501', message = 'You cannot record an expense for an inactive or unauthorized booth';
  end if;
  select business_id into category_business from public.expense_categories where id = target_category_id and is_active;
  if category_business is distinct from target_business_id then raise exception using errcode = '22023', message = 'Expense category is invalid for this business'; end if;
  caller_owner := public.is_business_owner(target_business_id);
  if caller_owner then initial_status := 'APPROVED'; else initial_status := 'PENDING_APPROVAL'; end if;
  insert into public.expenses(idempotency_key, business_id, booth_id, category_id, description, amount_pesewas, expense_at, payment_source_account_id, payee, notes, status, requires_approval, recorded_by, submitted_at)
  values (trim(request_id), target_business_id, target_booth_id, target_category_id, trim(expense_description), amount_pesewas, coalesce(expense_at_value, now()), payment_source_account_id, nullif(trim(payee_value), ''), nullif(trim(notes_value), ''), initial_status, not caller_owner, auth.uid(), now())
  returning * into expense_row;
  insert into public.expense_status_history(expense_id, business_id, from_status, to_status, reason, changed_by)
  values (expense_row.id, target_business_id, null, initial_status, case when caller_owner then 'Owner-recorded expense' else 'Submitted for owner approval' end, auth.uid());
  if caller_owner then return public._post_expense_locked(expense_row.id, auth.uid()); end if;
  return jsonb_build_object('status', 'pending_approval', 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference);
exception when unique_violation then
  select * into expense_row from public.expenses where idempotency_key = trim(request_id) limit 1;
  if expense_row.id is not null then
    if expense_row.business_id is distinct from target_business_id
      or expense_row.booth_id is distinct from target_booth_id
      or expense_row.recorded_by is distinct from auth.uid()
      or expense_row.category_id is distinct from target_category_id
      or expense_row.description is distinct from trim(expense_description)
      or expense_row.amount_pesewas is distinct from amount_pesewas
      or expense_row.payment_source_account_id is distinct from payment_source_account_id
      or expense_row.payee is distinct from nullif(trim(payee_value), '')
      or expense_row.notes is distinct from nullif(trim(notes_value), '')
      or (expense_at_value is not null and expense_row.expense_at is distinct from expense_at_value) then
      raise exception using errcode = '23505', message = 'Idempotency key conflict';
    end if;
    if expense_row.status = 'POSTED' then return jsonb_build_object('status', 'already_posted', 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference); end if;
    if expense_row.status = 'PENDING_APPROVAL' then return jsonb_build_object('status', 'pending_approval', 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference); end if;
    if expense_row.status = 'REVERSED' then return jsonb_build_object('status', 'already_reversed', 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference); end if;
    return jsonb_build_object('status', lower(expense_row.status), 'expense_id', expense_row.id, 'internal_reference', expense_row.internal_reference);
  end if;
  raise;
end;
$$;
revoke all on function public.record_expense(uuid, uuid, uuid, text, bigint, timestamptz, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.record_expense(uuid, uuid, uuid, text, bigint, timestamptz, uuid, text, text, text) to authenticated;
