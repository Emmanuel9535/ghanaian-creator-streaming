create or replace function public.approve_expense(target_expense_id uuid,approval_note text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare expense_row public.expenses%rowtype; posted jsonb;
begin
  select * into expense_row from public.expenses where id=target_expense_id for update;
  if not found then raise exception using errcode='P0002',message='Expense not found'; end if;
  if not public.is_business_owner(expense_row.business_id) then raise exception using errcode='42501',message='Owner approval required'; end if;
  if expense_row.status<>'PENDING_APPROVAL' then
    if expense_row.status='POSTED' then return jsonb_build_object('status','already_posted','expense_id',expense_row.id); end if;
    raise exception using errcode='22023',message='Only pending expenses can be approved';
  end if;
  update public.expenses set status='APPROVED',approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=target_expense_id;
  insert into public.expense_status_history(expense_id,business_id,from_status,to_status,reason,changed_by) values(expense_row.id,expense_row.business_id,'PENDING_APPROVAL','APPROVED',nullif(trim(approval_note),''),auth.uid());
  posted:=public._post_expense_locked(target_expense_id,auth.uid());
  return posted;
end;
$$;
grant execute on function public.approve_expense(uuid,text) to authenticated;

create or replace function public.reject_expense(target_expense_id uuid,rejection_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare expense_row public.expenses%rowtype;
begin
  if char_length(trim(coalesce(rejection_reason,'')))<5 then raise exception using errcode='22023',message='A rejection reason is required'; end if;
  select * into expense_row from public.expenses where id=target_expense_id for update;
  if not found then raise exception using errcode='P0002',message='Expense not found'; end if;
  if not public.is_business_owner(expense_row.business_id) then raise exception using errcode='42501',message='Owner approval required'; end if;
  if expense_row.status<>'PENDING_APPROVAL' then raise exception using errcode='22023',message='Only pending expenses can be rejected'; end if;
  update public.expenses set status='REJECTED',rejected_by=auth.uid(),rejected_at=now(),notes=concat_ws(E'\n',notes,rejection_reason),updated_at=now() where id=target_expense_id;
  insert into public.expense_status_history(expense_id,business_id,from_status,to_status,reason,changed_by) values(expense_row.id,expense_row.business_id,'PENDING_APPROVAL','REJECTED',trim(rejection_reason),auth.uid());
  return jsonb_build_object('status','rejected','expense_id',expense_row.id);
end;
$$;
grant execute on function public.reject_expense(uuid,text) to authenticated;

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
  if exists(select 1 from public.transaction_postings where idempotency_key=request_id) then select * into existing from public.transaction_postings where idempotency_key=request_id limit 1; return jsonb_build_object('status','already_reversed','expense_id',expense_row.id,'posting_id',existing.id); end if;
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
end;
$$;
grant execute on function public.reverse_expense(uuid,text,text) to authenticated;