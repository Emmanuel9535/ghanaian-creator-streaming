-- Stage 4.1: attendants may only read their assigned booth summary.
create or replace function public.financial_dashboard(target_business_id uuid, target_booth_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
  caller_role text;
  caller_booth uuid;
begin
  select m.role, m.booth_id into caller_role, caller_booth
  from public.business_members m
  where m.business_id = target_business_id and m.user_id = auth.uid() and m.status = 'active'
  order by case when m.role = 'OWNER' then 0 else 1 end
  limit 1;
  if caller_role is null then raise exception using errcode='42501', message='Business access denied'; end if;
  if caller_role <> 'OWNER' then
    if target_booth_id is null or caller_booth is null or target_booth_id <> caller_booth then
      raise exception using errcode='42501', message='Attendants may only view their assigned booth';
    end if;
  end if;
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