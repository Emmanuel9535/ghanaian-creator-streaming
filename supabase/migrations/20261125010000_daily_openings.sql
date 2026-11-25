-- Daily fresh openings: append-only operating-day starting positions.
-- The original onboarding opening rows remain immutable historical setup records.
create table if not exists public.daily_openings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booth_id uuid not null references public.booths(id) on delete restrict,
  business_date date not null,
  physical_cash_pesewas bigint not null check (physical_cash_pesewas >= 0),
  mtn_float_pesewas bigint not null check (mtn_float_pesewas >= 0),
  telecel_float_pesewas bigint not null check (telecel_float_pesewas >= 0),
  at_float_pesewas bigint not null check (at_float_pesewas >= 0),
  notes text,
  prepared_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (booth_id, business_date)
);

create index if not exists daily_openings_business_date_idx
  on public.daily_openings(business_id, business_date desc);
create index if not exists daily_openings_booth_date_idx
  on public.daily_openings(booth_id, business_date desc);

alter table public.daily_openings enable row level security;

drop policy if exists "Members can read daily openings" on public.daily_openings;
create policy "Members can read daily openings" on public.daily_openings
  for select using (
    public.is_business_member(business_id)
    and exists (
      select 1 from public.business_members m
      where m.business_id = daily_openings.business_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and (m.role = 'OWNER' or m.booth_id = daily_openings.booth_id)
    )
  );

drop policy if exists "Members can create daily openings" on public.daily_openings;
create policy "Members can create daily openings" on public.daily_openings
  for insert with check (
    public.is_business_member(business_id)
    and prepared_by = auth.uid()
    and exists (
      select 1 from public.booths b
      where b.id = booth_id and b.business_id = daily_openings.business_id
    )
    and exists (
      select 1 from public.business_members m
      where m.business_id = daily_openings.business_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and (m.role = 'OWNER' or m.booth_id = daily_openings.booth_id)
    )
  );

grant select, insert on public.daily_openings to authenticated;

create or replace function public.daily_opening_actor_can_access(
  target_business_id uuid,
  target_booth_id uuid
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.business_members m
    join public.booths b on b.id = target_booth_id and b.business_id = target_business_id
    where m.business_id = target_business_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (m.role = 'OWNER' or m.booth_id = target_booth_id)
  );
$$;

create or replace function public.record_daily_opening(
  target_business_id uuid,
  target_booth_id uuid,
  target_business_date date,
  target_physical_cash_pesewas bigint,
  target_mtn_float_pesewas bigint,
  target_telecel_float_pesewas bigint,
  target_at_float_pesewas bigint,
  target_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare existing public.daily_openings%rowtype;
begin
  if not public.daily_opening_actor_can_access(target_business_id, target_booth_id) then
    raise exception using errcode = '42501', message = 'Daily opening access denied';
  end if;
  if target_business_date is null then
    raise exception using errcode = '22023', message = 'Business date is required';
  end if;
  if target_physical_cash_pesewas < 0 or target_mtn_float_pesewas < 0
     or target_telecel_float_pesewas < 0 or target_at_float_pesewas < 0 then
    raise exception using errcode = '22023', message = 'Balances cannot be negative';
  end if;

  insert into public.daily_openings(
    business_id, booth_id, business_date, physical_cash_pesewas,
    mtn_float_pesewas, telecel_float_pesewas, at_float_pesewas,
    notes, prepared_by
  ) values (
    target_business_id, target_booth_id, target_business_date,
    target_physical_cash_pesewas, target_mtn_float_pesewas,
    target_telecel_float_pesewas, target_at_float_pesewas,
    nullif(trim(target_notes), ''), auth.uid()
  )
  on conflict (booth_id, business_date) do nothing;

  select * into existing
  from public.daily_openings
  where booth_id = target_booth_id and business_date = target_business_date
  limit 1;

  return jsonb_build_object(
    'opening_id', existing.id,
    'business_id', existing.business_id,
    'booth_id', existing.booth_id,
    'business_date', existing.business_date,
    'created', existing.prepared_by = auth.uid()
      and existing.created_at >= now() - interval '5 seconds'
  );
end;
$$;

grant execute on function public.daily_opening_actor_can_access(uuid, uuid) to authenticated;
grant execute on function public.record_daily_opening(uuid, uuid, date, bigint, bigint, bigint, bigint, text) to authenticated;
revoke all on function public.daily_opening_actor_can_access(uuid, uuid) from anon;
revoke all on function public.record_daily_opening(uuid, uuid, date, bigint, bigint, bigint, bigint, text) from anon;
