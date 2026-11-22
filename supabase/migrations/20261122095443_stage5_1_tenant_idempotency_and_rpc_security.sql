-- Stage 5.1 security hardening. Historical SQL in earlier files is ledger-recovered
-- byte-for-byte; changes below are deliberately isolated from those sources.
-- Idempotency collisions never disclose posting/expense identifiers across targets.

-- Retain safe profile editing but prevent users from changing their own role.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'viewer');
$$;
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('administrator', 'super_admin');
$$;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists "Users can update safe profile fields" on public.profiles;
create policy "Users can update safe profile fields" on public.profiles
for update to authenticated
using (auth.uid() = id or public.is_admin())
with check (public.is_admin() or (auth.uid() = id and role = public.current_user_role()));

create or replace function public.can_operate_booth(target_business_id uuid, target_booth_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.booths b
    join public.business_members m on m.business_id = b.business_id
    where b.id = target_booth_id and b.business_id = target_business_id
      and m.user_id = auth.uid() and m.status = 'active'
      and (m.role = 'OWNER' or (m.role = 'ATTENDANT' and m.booth_id = target_booth_id))
  );
$$;

create or replace function public.post_momo_transaction(target_transaction_id uuid, request_id text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tx public.transactions%rowtype; existing public.transaction_postings%rowtype; treatment public.transaction_accounting_treatments%rowtype; cash_account public.financial_accounts%rowtype; float_account public.financial_accounts%rowtype; posting public.transaction_postings%rowtype; delta_cash bigint := 0; delta_float bigint := 0; delta_charge bigint := 0; commission_status text := 'NOT_APPLICABLE'; new_cash_balance bigint; new_float_balance bigint;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if request_id is null or char_length(trim(request_id)) < 8 then raise exception using errcode='22023',message='A stable posting request id is required'; end if;
  select * into tx from public.transactions where id=target_transaction_id for update; if not found then raise exception using errcode='P0002',message='Transaction not found'; end if;
  if not public.can_operate_booth(tx.business_id,tx.booth_id) then raise exception using errcode='42501',message='You cannot operate this booth'; end if;
  if exists (select 1 from public.transaction_postings p where p.transaction_id=tx.id and p.posting_kind='ORIGINAL') then select * into existing from public.transaction_postings p where p.transaction_id=tx.id and p.posting_kind='ORIGINAL' limit 1; return jsonb_build_object('status','already_posted','posting_id',existing.id,'transaction_id',tx.id); end if;
  select * into existing from public.transaction_postings p where p.idempotency_key=request_id limit 1;
  if found then
    if existing.transaction_id=tx.id and existing.business_id=tx.business_id and existing.booth_id=tx.booth_id and existing.posting_kind='ORIGINAL' then
      return jsonb_build_object('status','already_posted','posting_id',existing.id,'transaction_id',tx.id);
    end if;
    raise exception using errcode='23505',message='Idempotency key conflict';
  end if;
  if tx.transaction_status <> 'SUCCESSFUL' then raise exception using errcode='22023',message='Only successful transactions can be posted'; end if;
  if tx.confirmation_method is null then raise exception using errcode='22023',message='A confirmation method is required'; end if;
  select * into cash_account from public.financial_accounts where business_id=tx.business_id and account_code='CASH_ON_HAND' for update; if not found then raise exception using errcode='P0002',message='Opening physical cash account is missing'; end if;
  select * into float_account from public.financial_accounts where business_id=tx.business_id and booth_id=tx.booth_id and network=tx.network and account_category='ELECTRONIC_FLOAT' for update; if not found then raise exception using errcode='P0002',message='Opening network float account is missing'; end if;
  if tx.transaction_type in ('AIRTIME','BILL_PAYMENT') then select * into treatment from public.transaction_accounting_treatments where business_id=tx.business_id and transaction_type=tx.transaction_type and network=tx.network limit 1; if not found or not treatment.float_settlement_enabled then raise exception using errcode='22023',message='Accounting treatment is not configured; transaction requires financial review'; end if; else select * into treatment from public.transaction_accounting_treatments where business_id=tx.business_id and transaction_type=tx.transaction_type and network=tx.network limit 1; end if;
  if tx.transaction_type='DEPOSIT' then delta_cash:=tx.principal_amount_pesewas; delta_float:=-tx.principal_amount_pesewas; elsif tx.transaction_type='WITHDRAWAL' then delta_cash:=-tx.principal_amount_pesewas; delta_float:=tx.principal_amount_pesewas; else delta_float:=-tx.principal_amount_pesewas; end if;
  if found and treatment.cash_charge_mode in ('CASH_IN','DEDUCT_FROM_PAYOUT') then delta_charge:=tx.customer_charge_pesewas; end if;
  new_cash_balance:=cash_account.current_balance_pesewas+delta_cash; new_float_balance:=float_account.current_balance_pesewas+delta_float;
  if new_cash_balance < 0 and not cash_account.allow_overdraft then raise exception using errcode='23514',message='Insufficient physical cash for this posting'; end if;
  if new_float_balance < 0 and not float_account.allow_overdraft then raise exception using errcode='23514',message='Insufficient network float for this posting'; end if;
  insert into public.transaction_postings (business_id,booth_id,transaction_id,posting_reference,idempotency_key,posted_by) values (tx.business_id,tx.booth_id,tx.id,'POST-'||tx.internal_reference,request_id,auth.uid()) returning * into posting;
  update public.financial_accounts set current_balance_pesewas=new_cash_balance where id=cash_account.id;
  insert into public.ledger_entries (posting_id,business_id,booth_id,transaction_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description) values (posting.id,tx.business_id,tx.booth_id,tx.id,cash_account.id,'TRANSACTION_PRINCIPAL',case when delta_cash<0 then -delta_cash else 0 end,case when delta_cash>0 then delta_cash else 0 end,delta_cash,new_cash_balance,'Physical cash movement for '||tx.transaction_type);
  if delta_charge>0 then new_cash_balance:=new_cash_balance+delta_charge; update public.financial_accounts set current_balance_pesewas=new_cash_balance where id=cash_account.id; insert into public.ledger_entries (posting_id,business_id,booth_id,transaction_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description) values (posting.id,tx.business_id,tx.booth_id,tx.id,cash_account.id,'CUSTOMER_CHARGE',0,delta_charge,delta_charge,new_cash_balance,'Separately collected customer charge'); end if;
  update public.financial_accounts set current_balance_pesewas=new_float_balance where id=float_account.id;
  insert into public.ledger_entries (posting_id,business_id,booth_id,transaction_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description) values (posting.id,tx.business_id,tx.booth_id,tx.id,float_account.id,'TRANSACTION_PRINCIPAL',case when delta_float<0 then -delta_float else 0 end,case when delta_float>0 then delta_float else 0 end,delta_float,new_float_balance,'Electronic float movement for '||tx.transaction_type);
  if tx.agent_commission_pesewas>0 then if found and treatment.commission_received_by_default then commission_status:='RECEIVED'; else commission_status:='EARNED'; end if; insert into public.commission_records (business_id,booth_id,transaction_id,amount_pesewas,status,received_by,received_at) values (tx.business_id,tx.booth_id,tx.id,tx.agent_commission_pesewas,commission_status,case when commission_status='RECEIVED' then auth.uid() end,case when commission_status='RECEIVED' then now() end); end if;
  return jsonb_build_object('status','posted','posting_id',posting.id,'cash_balance_pesewas',new_cash_balance,'float_balance_pesewas',new_float_balance,'commission_status',commission_status);
exception when unique_violation then
  select * into existing from public.transaction_postings p where p.transaction_id=target_transaction_id and p.business_id=tx.business_id and p.booth_id=tx.booth_id and p.posting_kind='ORIGINAL' limit 1;
  if existing.id is not null then return jsonb_build_object('status','already_posted','posting_id',existing.id,'transaction_id',target_transaction_id); end if;
  raise exception using errcode='23505',message='Idempotency key conflict';
end; $$;

create or replace function public.reverse_momo_transaction(target_transaction_id uuid, reversal_reason text, request_id text) returns jsonb language plpgsql security definer set search_path=public as $$
declare tx public.transactions%rowtype; original public.transaction_postings%rowtype; existing public.transaction_postings%rowtype; e record; account_row public.financial_accounts%rowtype; posting public.transaction_postings%rowtype; new_balance bigint;
begin
  if auth.uid() is null or not public.is_business_owner((select business_id from public.transactions where id=target_transaction_id)) then raise exception using errcode='42501',message='Owner authorisation required'; end if;
  if request_id is null or char_length(trim(request_id))<8 then raise exception using errcode='22023',message='A stable reversal request id is required'; end if;
  if char_length(trim(coalesce(reversal_reason,'')))<5 then raise exception using errcode='22023',message='A reversal reason is required'; end if;
  select * into tx from public.transactions where id=target_transaction_id for update; if not found then raise exception using errcode='P0002',message='Transaction not found'; end if;
  select * into original from public.transaction_postings where transaction_id=tx.id and posting_kind='ORIGINAL' limit 1; if not found then raise exception using errcode='22023',message='Transaction has not been posted'; end if;
  if exists (select 1 from public.transaction_postings where transaction_id=tx.id and posting_kind='REVERSAL') then select * into existing from public.transaction_postings where transaction_id=tx.id and posting_kind='REVERSAL' limit 1; return jsonb_build_object('status','already_reversed','posting_id',existing.id); end if;
  select * into existing from public.transaction_postings where idempotency_key=request_id limit 1;
  if found then
    if existing.transaction_id=tx.id and existing.business_id=tx.business_id and existing.booth_id=tx.booth_id and existing.posting_kind='REVERSAL' and existing.original_posting_id=original.id then
      return jsonb_build_object('status','already_reversed','posting_id',existing.id,'transaction_id',tx.id);
    end if;
    raise exception using errcode='23505',message='Idempotency key conflict';
  end if;
  insert into public.transaction_postings (business_id,booth_id,transaction_id,posting_reference,idempotency_key,posting_kind,original_posting_id,posted_by) values (tx.business_id,tx.booth_id,tx.id,'REV-'||tx.internal_reference,request_id,'REVERSAL',original.id,auth.uid()) returning * into posting;
  for e in select * from public.ledger_entries where posting_id=original.id order by created_at loop
    select * into account_row from public.financial_accounts where id=e.account_id for update; new_balance:=account_row.current_balance_pesewas-e.balance_delta_pesewas;
    if new_balance<0 and not account_row.allow_overdraft then raise exception using errcode='23514',message='Reversal would create a negative balance; owner adjustment or review is required'; end if;
    update public.financial_accounts set current_balance_pesewas=new_balance where id=account_row.id;
    insert into public.ledger_entries (posting_id,business_id,booth_id,transaction_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description) values (posting.id,tx.business_id,tx.booth_id,tx.id,e.account_id,'REVERSAL',case when -e.balance_delta_pesewas<0 then e.balance_delta_pesewas else 0 end,case when -e.balance_delta_pesewas>0 then -e.balance_delta_pesewas else 0 end,-e.balance_delta_pesewas,new_balance,'Reversal: '||reversal_reason);
  end loop;
  update public.transactions set transaction_status='REVERSED',updated_at=now() where id=tx.id;
  update public.commission_records set status='NOT_APPLICABLE',notes=coalesce(notes||' ','')||'Reversed: '||reversal_reason where transaction_id=tx.id;
  return jsonb_build_object('status','reversed','posting_id',posting.id,'transaction_id',tx.id);
exception when unique_violation then
  select * into existing from public.transaction_postings where idempotency_key=request_id limit 1;
  if found and existing.transaction_id=tx.id and existing.business_id=tx.business_id and existing.booth_id=tx.booth_id and existing.posting_kind='REVERSAL' and existing.original_posting_id=original.id then
    return jsonb_build_object('status','already_reversed','posting_id',existing.id,'transaction_id',tx.id);
  end if;
  raise exception using errcode='23505',message='Idempotency key conflict';
end; $$;

create or replace function public.record_expense(target_business_id uuid,target_booth_id uuid,target_category_id uuid,expense_description text,amount_pesewas bigint,expense_at_value timestamptz,payment_source_account_id uuid,payee_value text,notes_value text,request_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_owner boolean; expense_row public.expenses%rowtype; initial_status text; category_business uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if request_id is null or char_length(trim(request_id))<8 then raise exception using errcode='22023',message='A stable expense request id is required'; end if;
  if not exists (select 1 from public.booths b where b.id=target_booth_id and b.business_id=target_business_id) then raise exception using errcode='42501',message='Booth access denied'; end if;
  if not public.can_operate_booth(target_business_id,target_booth_id) then raise exception using errcode='42501',message='You cannot operate this booth'; end if;
  select business_id into category_business from public.expense_categories where id=target_category_id and is_active;
  if category_business is distinct from target_business_id then raise exception using errcode='22023',message='Expense category is invalid for this business'; end if;
  caller_owner:=public.is_business_owner(target_business_id);
  if caller_owner then initial_status:='APPROVED'; else initial_status:='PENDING_APPROVAL'; end if;
  insert into public.expenses(idempotency_key,business_id,booth_id,category_id,description,amount_pesewas,expense_at,payment_source_account_id,payee,notes,status,requires_approval,recorded_by,submitted_at)
  values(request_id,target_business_id,target_booth_id,target_category_id,trim(expense_description),amount_pesewas,coalesce(expense_at_value,now()),payment_source_account_id,nullif(trim(payee_value),''),nullif(trim(notes_value),''),initial_status,not caller_owner,auth.uid(),now()) returning * into expense_row;
  insert into public.expense_status_history(expense_id,business_id,from_status,to_status,reason,changed_by) values(expense_row.id,target_business_id,null,initial_status,case when caller_owner then 'Owner-recorded expense' else 'Submitted for owner approval' end,auth.uid());
  if caller_owner then return public._post_expense_locked(expense_row.id,auth.uid()); end if;
  return jsonb_build_object('status','pending_approval','expense_id',expense_row.id,'internal_reference',expense_row.internal_reference);
exception when unique_violation then
  select * into expense_row from public.expenses where idempotency_key=request_id limit 1;
  if expense_row.id is not null then
    if expense_row.business_id is distinct from target_business_id
      or expense_row.booth_id is distinct from target_booth_id
      or expense_row.recorded_by is distinct from auth.uid()
      or expense_row.category_id is distinct from target_category_id
      or expense_row.description is distinct from trim(expense_description)
      or expense_row.amount_pesewas is distinct from amount_pesewas
      or expense_row.payment_source_account_id is distinct from payment_source_account_id
      or expense_row.payee is distinct from nullif(trim(payee_value),'')
      or expense_row.notes is distinct from nullif(trim(notes_value),'')
      or (expense_at_value is not null and expense_row.expense_at is distinct from expense_at_value) then
      raise exception using errcode='23505',message='Idempotency key conflict';
    end if;
    if expense_row.status='POSTED' then return jsonb_build_object('status','already_posted','expense_id',expense_row.id,'internal_reference',expense_row.internal_reference); end if;
    return jsonb_build_object('status','pending_approval','expense_id',expense_row.id,'internal_reference',expense_row.internal_reference);
  end if;
  raise;
end;
$$;

create or replace function public.reverse_expense(target_expense_id uuid,reversal_reason text,request_id text) returns jsonb language plpgsql security definer set search_path=public as $$
declare expense_row public.expenses%rowtype; original public.transaction_postings%rowtype; existing public.transaction_postings%rowtype; account_row public.financial_accounts%rowtype; posting public.transaction_postings%rowtype; entry_row record; new_balance bigint;
begin
  if char_length(trim(coalesce(reversal_reason,'')))<5 then raise exception using errcode='22023',message='A reversal reason is required'; end if;
  if request_id is null or char_length(trim(request_id))<8 then raise exception using errcode='22023',message='A stable reversal request id is required'; end if;
  select * into expense_row from public.expenses where id=target_expense_id for update;
  if not found then raise exception using errcode='P0002',message='Expense not found'; end if;
  if not public.is_business_owner(expense_row.business_id) then raise exception using errcode='42501',message='Owner authorization required'; end if;
  if expense_row.status='REVERSED' then select * into existing from public.transaction_postings where expense_id=target_expense_id and posting_kind='EXPENSE_REVERSAL' limit 1; return jsonb_build_object('status','already_reversed','expense_id',expense_row.id,'posting_id',existing.id); end if;
  if expense_row.status<>'POSTED' then raise exception using errcode='22023',message='Only posted expenses can be reversed'; end if;
  select * into original from public.transaction_postings where expense_id=target_expense_id and posting_kind='EXPENSE' limit 1;
  if not found then raise exception using errcode='22023',message='Expense posting not found'; end if;
  select * into existing from public.transaction_postings where idempotency_key=request_id limit 1;
  if found then
    if existing.expense_id=expense_row.id and existing.business_id=expense_row.business_id and existing.booth_id=expense_row.booth_id and existing.posting_kind='EXPENSE_REVERSAL' and existing.original_posting_id=original.id then
      return jsonb_build_object('status','already_reversed','expense_id',expense_row.id,'posting_id',existing.id);
    end if;
    raise exception using errcode='23505',message='Idempotency key conflict';
  end if;
  insert into public.transaction_postings(business_id,booth_id,transaction_id,expense_id,posting_reference,idempotency_key,posting_kind,original_posting_id,posted_by) values(expense_row.business_id,expense_row.booth_id,null,expense_row.id,'REV-'||expense_row.internal_reference,request_id,'EXPENSE_REVERSAL',original.id,auth.uid()) returning * into posting;
  for entry_row in select * from public.ledger_entries where posting_id=original.id order by created_at loop
    select * into account_row from public.financial_accounts where id=entry_row.account_id for update;
    new_balance:=account_row.current_balance_pesewas-entry_row.balance_delta_pesewas;
    if new_balance<0 and not account_row.allow_overdraft then raise exception using errcode='23514',message='Reversal would create a negative balance'; end if;
    update public.financial_accounts set current_balance_pesewas=new_balance where id=account_row.id;
    insert into public.ledger_entries(posting_id,business_id,booth_id,transaction_id,expense_id,account_id,entry_type,debit_pesewas,credit_pesewas,balance_delta_pesewas,resulting_balance_pesewas,description) values(posting.id,expense_row.business_id,expense_row.booth_id,null,expense_row.id,entry_row.account_id,'REVERSAL',case when -entry_row.balance_delta_pesewas<0 then entry_row.balance_delta_pesewas else 0 end,case when -entry_row.balance_delta_pesewas>0 then -entry_row.balance_delta_pesewas else 0 end,-entry_row.balance_delta_pesewas,new_balance,'Expense reversal: '||trim(reversal_reason));
  end loop;
  update public.expenses set status='REVERSED',reversed_by=auth.uid(),reversed_at=now(),updated_at=now() where id=expense_row.id;
  insert into public.expense_status_history(expense_id,business_id,from_status,to_status,reason,changed_by) values(expense_row.id,expense_row.business_id,'POSTED','REVERSED',trim(reversal_reason),auth.uid());
  return jsonb_build_object('status','reversed','expense_id',expense_row.id,'posting_id',posting.id);
exception when unique_violation then
  select * into existing from public.transaction_postings where idempotency_key=request_id limit 1;
  if found and existing.expense_id=expense_row.id and existing.business_id=expense_row.business_id and existing.booth_id=expense_row.booth_id and existing.posting_kind='EXPENSE_REVERSAL' and existing.original_posting_id=original.id then
    return jsonb_build_object('status','already_reversed','expense_id',expense_row.id,'posting_id',existing.id);
  end if;
  raise exception using errcode='23505',message='Idempotency key conflict';
end;
$$;

-- Tenant helper and transaction-reference generator retain authenticated/server use.
revoke all on function public.can_operate_booth(uuid, uuid) from public, anon;
grant execute on function public.can_operate_booth(uuid, uuid) to authenticated, service_role;
revoke all on function public.generate_momo_transaction_reference() from public, anon;
grant execute on function public.generate_momo_transaction_reference() to authenticated, service_role;

-- Stage 4 financial RPCs keep authenticated and service-role access; anonymous and
-- PUBLIC execution is removed. Their business/owner/assigned-booth checks remain.
revoke all on function public.financial_dashboard(uuid, uuid) from public, anon;
revoke all on function public.post_momo_transaction(uuid, text) from public, anon;
revoke all on function public.reverse_momo_transaction(uuid, text, text) from public, anon;
grant execute on function public.financial_dashboard(uuid, uuid) to authenticated, service_role;
grant execute on function public.post_momo_transaction(uuid, text) to authenticated, service_role;
grant execute on function public.reverse_momo_transaction(uuid, text, text) to authenticated, service_role;

-- No client caller uses this unguarded helper; retain trusted server execution.
revoke all on function public.financial_account_id(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.financial_account_id(uuid, uuid, text) to service_role;
