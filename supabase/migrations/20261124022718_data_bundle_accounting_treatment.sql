-- Data bundle transactions reuse the business/network's existing Airtime accounting treatment.
-- Successful posting still requires float settlement to be explicitly enabled for that treatment.
create or replace function public.post_momo_transaction(
  target_transaction_id uuid,
  request_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.transactions%rowtype;
  existing public.transaction_postings%rowtype;
  treatment public.transaction_accounting_treatments%rowtype;
  cash_account public.financial_accounts%rowtype;
  float_account public.financial_accounts%rowtype;
  posting public.transaction_postings%rowtype;
  treatment_type text;
  delta_cash bigint := 0;
  delta_float bigint := 0;
  delta_charge bigint := 0;
  commission_status text := 'NOT_APPLICABLE';
  new_cash_balance bigint;
  new_float_balance bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if request_id is null or char_length(trim(request_id)) < 8 then
    raise exception using errcode = '22023', message = 'A stable posting request id is required';
  end if;

  select * into tx from public.transactions where id = target_transaction_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Transaction not found';
  end if;
  if not public.can_operate_booth(tx.business_id, tx.booth_id) then
    raise exception using errcode = '42501', message = 'You cannot operate this booth';
  end if;

  if exists (
    select 1 from public.transaction_postings p
    where p.transaction_id = tx.id and p.posting_kind = 'ORIGINAL'
  ) then
    select * into existing from public.transaction_postings p
    where p.transaction_id = tx.id and p.posting_kind = 'ORIGINAL' limit 1;
    return jsonb_build_object('status', 'already_posted', 'posting_id', existing.id, 'transaction_id', tx.id);
  end if;

  select * into existing from public.transaction_postings p where p.idempotency_key = request_id limit 1;
  if found then
    if existing.transaction_id = tx.id and existing.business_id = tx.business_id
      and existing.booth_id = tx.booth_id and existing.posting_kind = 'ORIGINAL' then
      return jsonb_build_object('status', 'already_posted', 'posting_id', existing.id, 'transaction_id', tx.id);
    end if;
    raise exception using errcode = '23505', message = 'Idempotency key conflict';
  end if;

  if tx.transaction_status <> 'SUCCESSFUL' then
    raise exception using errcode = '22023', message = 'Only successful transactions can be posted';
  end if;
  if tx.confirmation_method is null then
    raise exception using errcode = '22023', message = 'A confirmation method is required';
  end if;

  select * into cash_account from public.financial_accounts
  where business_id = tx.business_id and account_code = 'CASH_ON_HAND' for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Opening physical cash account is missing';
  end if;
  select * into float_account from public.financial_accounts
  where business_id = tx.business_id and booth_id = tx.booth_id and network = tx.network
    and account_category = 'ELECTRONIC_FLOAT' for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Opening network float account is missing';
  end if;

  treatment_type := case when tx.transaction_type = 'DATA_BUNDLE' then 'AIRTIME' else tx.transaction_type end;
  if tx.transaction_type in ('AIRTIME', 'BILL_PAYMENT', 'DATA_BUNDLE') then
    select * into treatment from public.transaction_accounting_treatments
    where business_id = tx.business_id and transaction_type = treatment_type and network = tx.network limit 1;
    if not found or not treatment.float_settlement_enabled then
      raise exception using errcode = '22023', message = 'Accounting treatment is not configured; transaction requires financial review';
    end if;
  else
    select * into treatment from public.transaction_accounting_treatments
    where business_id = tx.business_id and transaction_type = treatment_type and network = tx.network limit 1;
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
  if found and treatment.cash_charge_mode in ('CASH_IN', 'DEDUCT_FROM_PAYOUT') then
    delta_charge := tx.customer_charge_pesewas;
  end if;

  new_cash_balance := cash_account.current_balance_pesewas + delta_cash;
  new_float_balance := float_account.current_balance_pesewas + delta_float;
  if new_cash_balance < 0 and not cash_account.allow_overdraft then
    raise exception using errcode = '23514', message = 'Insufficient physical cash for this posting';
  end if;
  if new_float_balance < 0 and not float_account.allow_overdraft then
    raise exception using errcode = '23514', message = 'Insufficient network float for this posting';
  end if;

  insert into public.transaction_postings
    (business_id, booth_id, transaction_id, posting_reference, idempotency_key, posted_by)
  values (tx.business_id, tx.booth_id, tx.id, 'POST-' || tx.internal_reference, request_id, auth.uid())
  returning * into posting;
  update public.financial_accounts set current_balance_pesewas = new_cash_balance where id = cash_account.id;
  insert into public.ledger_entries
    (posting_id, business_id, booth_id, transaction_id, account_id, entry_type, debit_pesewas, credit_pesewas, balance_delta_pesewas, resulting_balance_pesewas, description)
  values (posting.id, tx.business_id, tx.booth_id, tx.id, cash_account.id, 'TRANSACTION_PRINCIPAL',
    case when delta_cash < 0 then -delta_cash else 0 end,
    case when delta_cash > 0 then delta_cash else 0 end,
    delta_cash, new_cash_balance, 'Physical cash movement for ' || tx.transaction_type);

  if delta_charge > 0 then
    new_cash_balance := new_cash_balance + delta_charge;
    update public.financial_accounts set current_balance_pesewas = new_cash_balance where id = cash_account.id;
    insert into public.ledger_entries
      (posting_id, business_id, booth_id, transaction_id, account_id, entry_type, debit_pesewas, credit_pesewas, balance_delta_pesewas, resulting_balance_pesewas, description)
    values (posting.id, tx.business_id, tx.booth_id, tx.id, cash_account.id, 'CUSTOMER_CHARGE',
      0, delta_charge, delta_charge, new_cash_balance, 'Separately collected customer charge');
  end if;

  update public.financial_accounts set current_balance_pesewas = new_float_balance where id = float_account.id;
  insert into public.ledger_entries
    (posting_id, business_id, booth_id, transaction_id, account_id, entry_type, debit_pesewas, credit_pesewas, balance_delta_pesewas, resulting_balance_pesewas, description)
  values (posting.id, tx.business_id, tx.booth_id, tx.id, float_account.id, 'TRANSACTION_PRINCIPAL',
    case when delta_float < 0 then -delta_float else 0 end,
    case when delta_float > 0 then delta_float else 0 end,
    delta_float, new_float_balance, 'Electronic float movement for ' || tx.transaction_type);

  if tx.agent_commission_pesewas > 0 then
    if found and treatment.commission_received_by_default then
      commission_status := 'RECEIVED';
    else
      commission_status := 'EARNED';
    end if;
    insert into public.commission_records
      (business_id, booth_id, transaction_id, amount_pesewas, status, received_by, received_at)
    values (tx.business_id, tx.booth_id, tx.id, tx.agent_commission_pesewas, commission_status,
      case when commission_status = 'RECEIVED' then auth.uid() end,
      case when commission_status = 'RECEIVED' then now() end);
  end if;

  return jsonb_build_object('status', 'posted', 'posting_id', posting.id,
    'cash_balance_pesewas', new_cash_balance, 'float_balance_pesewas', new_float_balance,
    'commission_status', commission_status);
exception when unique_violation then
  select * into existing from public.transaction_postings p
  where p.transaction_id = target_transaction_id and p.business_id = tx.business_id
    and p.booth_id = tx.booth_id and p.posting_kind = 'ORIGINAL' limit 1;
  if existing.id is not null then
    return jsonb_build_object('status', 'already_posted', 'posting_id', existing.id,
      'transaction_id', target_transaction_id);
  end if;
  raise exception using errcode = '23505', message = 'Idempotency key conflict';
end;
$$;
