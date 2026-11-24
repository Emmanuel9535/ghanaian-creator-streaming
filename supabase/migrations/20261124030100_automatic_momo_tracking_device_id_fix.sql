-- Corrective migration: persist device_id in the ingestion RPC.
-- Required for offline replay idempotency and the unique event constraint.
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
