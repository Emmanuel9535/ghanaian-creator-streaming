-- Automatic MoMo tracking: evidence intake only.
-- This migration deliberately does not create or mark successful transactions.

create table if not exists public.momo_alert_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booth_id uuid not null references public.booths(id) on delete restrict,
  captured_by uuid not null references auth.users(id) on delete restrict,
  device_id text not null check (char_length(trim(device_id)) between 8 and 120),
  source_kind text not null check (source_kind in ('NOTIFICATION','SMS','PROVIDER_API','MANUAL_REVIEW')),
  provider text not null check (provider in ('MTN','TELECEL','AT','UNKNOWN')),
  source_package text,
  device_event_id text not null check (char_length(trim(device_event_id)) between 8 and 240),
  event_key text not null check (char_length(trim(event_key)) between 8 and 240),
  event_at timestamptz,
  transaction_type text check (transaction_type is null or transaction_type in ('DEPOSIT','WITHDRAWAL','AIRTIME','DATA_BUNDLE','BILL_PAYMENT')),
  amount_pesewas bigint check (amount_pesewas is null or amount_pesewas > 0),
  fee_pesewas bigint check (fee_pesewas is null or fee_pesewas >= 0),
  commission_pesewas bigint check (commission_pesewas is null or commission_pesewas >= 0),
  customer_phone text,
  provider_reference text,
  status text not null default 'REVIEW_REQUIRED' check (status in ('REVIEW_REQUIRED','MATCHED','CONFIRMED','REJECTED','DUPLICATE')),
  confidence text not null default 'LOW' check (confidence in ('LOW','MEDIUM','HIGH')),
  matched_transaction_id uuid references public.transactions(id) on delete set null,
  review_reason text not null,
  parser_version text not null default 'android-notification-v1',
  raw_payload_retained boolean not null default false,
  captured_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  unique (business_id, device_id, event_key)
);

create index if not exists momo_alert_events_review_idx on public.momo_alert_events (business_id, status, captured_at desc);
create index if not exists momo_alert_events_provider_reference_idx on public.momo_alert_events (business_id, provider_reference);
create index if not exists momo_alert_events_matched_transaction_idx on public.momo_alert_events (matched_transaction_id);

alter table public.momo_alert_events enable row level security;
drop policy if exists "Members can read MoMo alert events" on public.momo_alert_events;
create policy "Members can read MoMo alert events" on public.momo_alert_events
  for select using (public.is_business_member(business_id));
drop policy if exists "Operators can create MoMo alert events" on public.momo_alert_events;
create policy "Operators can create MoMo alert events" on public.momo_alert_events
  for insert with check (public.can_operate_booth(business_id, booth_id) and captured_by = auth.uid());
drop policy if exists "Operators can review MoMo alert events" on public.momo_alert_events;
create policy "Operators can review MoMo alert events" on public.momo_alert_events
  for update using (public.can_operate_booth(business_id, booth_id))
  with check (public.can_operate_booth(business_id, booth_id) and reviewed_by = auth.uid());

grant select, insert, update on public.momo_alert_events to authenticated;

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
    amount_pesewas, fee_pesewas, commission_pesewas, customer_phone,
    provider_reference, status, confidence, review_reason, parser_version,
    raw_payload_retained
  ) values (
    (alert->>'business_id')::uuid,
    (alert->>'booth_id')::uuid,
    auth.uid(),
    alert->>'device_id',
    coalesce(alert->>'source_kind','NOTIFICATION'),
    coalesce(alert->>'provider','UNKNOWN'),
    nullif(alert->>'source_package',''),
    alert->>'device_event_id',
    alert->>'event_key',
    nullif(alert->>'event_at','')::timestamptz,
    nullif(alert->>'transaction_type',''),
    nullif(alert->>'amount_pesewas','')::bigint,
    nullif(alert->>'fee_pesewas','')::bigint,
    nullif(alert->>'commission_pesewas','')::bigint,
    nullif(alert->>'customer_phone',''),
    nullif(alert->>'provider_reference',''),
    'REVIEW_REQUIRED',
    coalesce(alert->>'confidence','LOW'),
    coalesce(nullif(alert->>'review_reason',''),'Automatic recognition requires human confirmation'),
    coalesce(alert->>'parser_version','android-notification-v1'),
    false
  )
  on conflict (business_id, device_id, event_key) do nothing
  returning * into result;
  if not found then
    select * into result from public.momo_alert_events
    where business_id = (alert->>'business_id')::uuid
      and device_id = alert->>'device_id'
      and event_key = alert->>'event_key'
    limit 1;
  end if;
  return result;
end;
$$;

grant execute on function public.ingest_momo_alert(jsonb) to authenticated;
