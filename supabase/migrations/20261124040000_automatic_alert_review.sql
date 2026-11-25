-- Authenticated review workflow for automatic MoMo evidence.
alter table public.momo_alert_events
  add column if not exists observed_status text not null default 'UNKNOWN'
    check (observed_status in ('SUCCESSFUL','PENDING','FAILED','REVERSED','UNKNOWN'));

create or replace function public.ingest_momo_alert(alert jsonb)
returns public.momo_alert_events
language plpgsql
security invoker
set search_path = public
as $$
declare result public.momo_alert_events;
begin
  insert into public.momo_alert_events (
    business_id, booth_id, captured_by, device_id, source_kind, provider,
    source_package, device_event_id, event_key, event_at, transaction_type,
    observed_status, amount_pesewas, fee_pesewas, commission_pesewas, customer_phone,
    provider_reference, status, confidence, review_reason, parser_version, raw_payload_retained
  ) values (
    (alert->>'business_id')::uuid, (alert->>'booth_id')::uuid, auth.uid(), alert->>'device_id',
    coalesce(alert->>'source_kind','NOTIFICATION'), coalesce(alert->>'provider','UNKNOWN'),
    nullif(alert->>'source_package',''), alert->>'device_event_id', alert->>'event_key',
    nullif(alert->>'event_at','')::timestamptz, nullif(alert->>'transaction_type',''),
    coalesce(alert->>'observed_status','UNKNOWN'), nullif(alert->>'amount_pesewas','')::bigint,
    nullif(alert->>'fee_pesewas','')::bigint, nullif(alert->>'commission_pesewas','')::bigint,
    nullif(alert->>'customer_phone',''), nullif(alert->>'provider_reference',''),
    'REVIEW_REQUIRED', coalesce(alert->>'confidence','LOW'),
    coalesce(nullif(alert->>'review_reason',''),'Automatic recognition requires human confirmation'),
    coalesce(alert->>'parser_version','android-notification-v1'), false
  ) on conflict (business_id, device_id, event_key) do nothing returning * into result;
  if not found then
    select * into result from public.momo_alert_events where business_id=(alert->>'business_id')::uuid and device_id=alert->>'device_id' and event_key=alert->>'event_key' limit 1;
  end if;
  return result;
end;
$$;
grant execute on function public.ingest_momo_alert(jsonb) to authenticated;

create table if not exists public.momo_alert_review_history (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.momo_alert_events(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  action text not null check (action in ('MATCHED','CONFIRMED','REJECTED','UNMATCHED')),
  from_status text,
  to_status text not null,
  transaction_id uuid references public.transactions(id) on delete set null,
  reason text,
  changed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists momo_alert_review_history_alert_idx on public.momo_alert_review_history(alert_id, created_at desc);
create index if not exists momo_alert_review_history_business_idx on public.momo_alert_review_history(business_id, created_at desc);

alter table public.momo_alert_review_history enable row level security;
drop policy if exists "Members can read MoMo alert review history" on public.momo_alert_review_history;
create policy "Members can read MoMo alert review history" on public.momo_alert_review_history
  for select using (public.is_business_member(business_id));
grant select on public.momo_alert_review_history to authenticated;

create or replace function public.confirm_momo_alert(target_alert_id uuid, target_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  alert_row public.momo_alert_events%rowtype;
  tx_row public.transactions%rowtype;
  posting jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Authentication required'; end if;
  select * into alert_row from public.momo_alert_events where id = target_alert_id for update;
  if not found then raise exception using errcode='P0002', message='Alert not found'; end if;
  if not public.can_operate_booth(alert_row.business_id, alert_row.booth_id) then raise exception using errcode='42501', message='You cannot review this booth'; end if;
  if alert_row.status not in ('REVIEW_REQUIRED','MATCHED') then raise exception using errcode='22023', message='Alert is no longer reviewable'; end if;
  if alert_row.observed_status <> 'SUCCESSFUL' then raise exception using errcode='22023', message='Only successful provider evidence can confirm a transaction'; end if;

  select * into tx_row from public.transactions where id = target_transaction_id for update;
  if not found then raise exception using errcode='P0002', message='Transaction not found'; end if;
  if tx_row.business_id <> alert_row.business_id or tx_row.booth_id <> alert_row.booth_id then raise exception using errcode='22023', message='Business or booth mismatch'; end if;
  if tx_row.network <> alert_row.provider then raise exception using errcode='22023', message='Network mismatch'; end if;
  if alert_row.transaction_type is not null and tx_row.transaction_type <> alert_row.transaction_type then raise exception using errcode='22023', message='Transaction type mismatch'; end if;
  if alert_row.amount_pesewas is not null and tx_row.principal_amount_pesewas <> alert_row.amount_pesewas then raise exception using errcode='22023', message='Amount mismatch'; end if;
  if alert_row.provider_reference is not null and tx_row.provider_reference is not null and tx_row.provider_reference <> alert_row.provider_reference then raise exception using errcode='22023', message='Provider reference mismatch'; end if;
  if tx_row.transaction_status in ('SUCCESSFUL','REVERSED','CANCELLED') then raise exception using errcode='22023', message='Transaction is not confirmable in its current status'; end if;

  update public.transactions
  set transaction_status = 'SUCCESSFUL',
      confirmation_method = 'MANUALLY_CONFIRMED',
      provider_reference = coalesce(provider_reference, alert_row.provider_reference),
      updated_at = now()
  where id = tx_row.id;

  update public.momo_alert_events
  set status = 'CONFIRMED', matched_transaction_id = tx_row.id, reviewed_by = auth.uid(), reviewed_at = now()
  where id = alert_row.id;

  insert into public.momo_alert_review_history(alert_id,business_id,action,from_status,to_status,transaction_id,reason,changed_by)
  values(alert_row.id,alert_row.business_id,'CONFIRMED',alert_row.status,'CONFIRMED',tx_row.id,'Operator confirmed provider evidence against ledger transaction',auth.uid());

  posting := public.post_momo_transaction(tx_row.id, 'ALERT-' || replace(target_alert_id::text,'-',''));
  return jsonb_build_object('status','CONFIRMED','alert_id',alert_row.id,'transaction_id',tx_row.id,'posting',posting);
end;
$$;
grant execute on function public.confirm_momo_alert(uuid,uuid) to authenticated;

create or replace function public.reject_momo_alert(target_alert_id uuid, rejection_reason text)
returns public.momo_alert_events language plpgsql security definer set search_path = public as $$
declare alert_row public.momo_alert_events%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Authentication required'; end if;
  select * into alert_row from public.momo_alert_events where id = target_alert_id for update;
  if not found then raise exception using errcode='P0002', message='Alert not found'; end if;
  if not public.can_operate_booth(alert_row.business_id, alert_row.booth_id) then raise exception using errcode='42501', message='You cannot review this booth'; end if;
  if alert_row.status not in ('REVIEW_REQUIRED','MATCHED') then raise exception using errcode='22023', message='Alert is no longer reviewable'; end if;
  if char_length(trim(coalesce(rejection_reason,''))) < 5 then raise exception using errcode='22023', message='A rejection reason is required'; end if;
  update public.momo_alert_events set status='REJECTED', reviewed_by=auth.uid(), reviewed_at=now(), review_reason=rejection_reason where id=alert_row.id returning * into alert_row;
  insert into public.momo_alert_review_history(alert_id,business_id,action,from_status,to_status,reason,changed_by)
  values(alert_row.id,alert_row.business_id,'REJECTED','REVIEW_REQUIRED','REJECTED',rejection_reason,auth.uid());
  return alert_row;
end;
$$;
grant execute on function public.reject_momo_alert(uuid,text) to authenticated;
