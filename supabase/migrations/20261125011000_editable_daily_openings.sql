-- Daily openings remain separate from onboarding and reconciliation records, but agents may correct them.
alter table public.daily_openings
  add column if not exists updated_by uuid references auth.users(id) on delete restrict,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.daily_opening_edit_history (
  id uuid primary key default gen_random_uuid(),
  opening_id uuid not null references public.daily_openings(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  previous_booth_id uuid not null references public.booths(id) on delete restrict,
  previous_physical_cash_pesewas bigint not null,
  previous_mtn_float_pesewas bigint not null,
  previous_telecel_float_pesewas bigint not null,
  previous_at_float_pesewas bigint not null,
  previous_notes text,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);
create index if not exists daily_opening_edit_history_opening_idx on public.daily_opening_edit_history(opening_id, changed_at desc);

alter table public.daily_opening_edit_history enable row level security;
drop policy if exists "Members can read daily opening edit history" on public.daily_opening_edit_history;
create policy "Members can read daily opening edit history" on public.daily_opening_edit_history
  for select using (public.is_business_member(business_id));
grant select on public.daily_opening_edit_history to authenticated;

drop policy if exists "Members can update daily openings" on public.daily_openings;
create policy "Members can update daily openings" on public.daily_openings
  for update using (
    public.daily_opening_actor_can_access(business_id, booth_id)
  ) with check (
    public.daily_opening_actor_can_access(business_id, booth_id)
    and updated_by = auth.uid()
  );
grant update on public.daily_openings to authenticated;

create or replace function public.update_daily_opening(
  target_opening_id uuid,
  target_booth_id uuid,
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
  select * into existing from public.daily_openings where id = target_opening_id for update;
  if not found or not public.daily_opening_actor_can_access(existing.business_id, existing.booth_id)
     or not public.daily_opening_actor_can_access(existing.business_id, target_booth_id) then
    raise exception using errcode = '42501', message = 'Daily opening access denied';
  end if;
  if target_physical_cash_pesewas < 0 or target_mtn_float_pesewas < 0
     or target_telecel_float_pesewas < 0 or target_at_float_pesewas < 0 then
    raise exception using errcode = '22023', message = 'Balances cannot be negative';
  end if;

  insert into public.daily_opening_edit_history(
    opening_id, business_id, previous_booth_id, previous_physical_cash_pesewas,
    previous_mtn_float_pesewas, previous_telecel_float_pesewas,
    previous_at_float_pesewas, previous_notes, changed_by
  ) values (
    existing.id, existing.business_id, existing.booth_id,
    existing.physical_cash_pesewas, existing.mtn_float_pesewas,
    existing.telecel_float_pesewas, existing.at_float_pesewas,
    existing.notes, auth.uid()
  );

  update public.daily_openings set
    booth_id = target_booth_id,
    physical_cash_pesewas = target_physical_cash_pesewas,
    mtn_float_pesewas = target_mtn_float_pesewas,
    telecel_float_pesewas = target_telecel_float_pesewas,
    at_float_pesewas = target_at_float_pesewas,
    notes = nullif(trim(target_notes), ''),
    updated_by = auth.uid(),
    updated_at = now()
  where id = existing.id;

  return jsonb_build_object('opening_id', existing.id, 'business_date', existing.business_date, 'updated', true);
end;
$$;

grant execute on function public.update_daily_opening(uuid, uuid, bigint, bigint, bigint, bigint, text) to authenticated;
revoke all on function public.update_daily_opening(uuid, uuid, bigint, bigint, bigint, bigint, text) from anon;
