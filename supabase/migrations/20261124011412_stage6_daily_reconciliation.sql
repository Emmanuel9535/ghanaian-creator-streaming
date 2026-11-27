-- Stage 6: Daily reconciliation and end-of-day closing MVP
create table if not exists public.reconciliation_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booth_id uuid not null references public.booths(id) on delete restrict,
  business_date date not null,
  cutoff_at timestamptz not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  prepared_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_comment text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, booth_id, business_date)
);

create table if not exists public.reconciliation_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.reconciliation_sessions(id) on delete cascade,
  line_code text not null check (line_code in ('PHYSICAL_CASH','MTN_FLOAT','TELECEL_FLOAT','AT_FLOAT')),
  expected_pesewas bigint not null check (expected_pesewas >= 0),
  actual_pesewas bigint check (actual_pesewas is null or actual_pesewas >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, line_code)
);

create table if not exists public.reconciliation_status_history (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.reconciliation_sessions(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  comment text,
  changed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists reconciliation_sessions_business_date_idx on public.reconciliation_sessions(business_id, business_date desc);
create index if not exists reconciliation_sessions_status_idx on public.reconciliation_sessions(business_id, status, business_date desc);
create index if not exists reconciliation_lines_session_idx on public.reconciliation_lines(session_id, line_code);
create index if not exists reconciliation_history_session_idx on public.reconciliation_status_history(session_id, created_at desc);

alter table public.reconciliation_sessions enable row level security;
alter table public.reconciliation_lines enable row level security;
alter table public.reconciliation_status_history enable row level security;

drop policy if exists "Members can read reconciliation sessions" on public.reconciliation_sessions;
create policy "Members can read reconciliation sessions" on public.reconciliation_sessions for select using (
  public.is_business_member(business_id)
  and exists (select 1 from public.booths b where b.id = reconciliation_sessions.booth_id and b.business_id = reconciliation_sessions.business_id)
  and exists (select 1 from public.business_members m where m.business_id = reconciliation_sessions.business_id and m.user_id = auth.uid() and m.status = 'active' and (m.role = 'OWNER' or m.booth_id = reconciliation_sessions.booth_id))
);
drop policy if exists "Members can read reconciliation lines" on public.reconciliation_lines;
create policy "Members can read reconciliation lines" on public.reconciliation_lines for select using (
  exists (select 1 from public.reconciliation_sessions s where s.id = reconciliation_lines.session_id and public.is_business_member(s.business_id) and exists (select 1 from public.business_members m where m.business_id=s.business_id and m.user_id=auth.uid() and m.status='active' and (m.role='OWNER' or m.booth_id=s.booth_id)))
);
drop policy if exists "Members can read reconciliation history" on public.reconciliation_status_history;
create policy "Members can read reconciliation history" on public.reconciliation_status_history for select using (
  public.is_business_member(business_id) and exists (select 1 from public.reconciliation_sessions s where s.id=reconciliation_status_history.session_id and exists (select 1 from public.business_members m where m.business_id=s.business_id and m.user_id=auth.uid() and m.status='active' and (m.role='OWNER' or m.booth_id=s.booth_id)))
);
grant select on public.reconciliation_sessions, public.reconciliation_lines, public.reconciliation_status_history to authenticated;

create or replace function public.reconciliation_actor_can_access(target_business_id uuid, target_booth_id uuid, owner_only boolean default false)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.business_members m
    join public.booths b on b.id = target_booth_id and b.business_id = target_business_id
    where m.business_id=target_business_id and m.user_id=auth.uid() and m.status='active'
      and ((owner_only and m.role='OWNER') or (not owner_only and (m.role='OWNER' or m.booth_id=target_booth_id)))
  );
$$;

create or replace function public.reconciliation_expected_lines(target_business_id uuid, target_booth_id uuid, target_cutoff timestamptz)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'PHYSICAL_CASH', greatest(0, coalesce((select a.opening_balance_pesewas from public.financial_accounts a where a.business_id=target_business_id and a.account_code='CASH_ON_HAND' and a.booth_id is null limit 1),0) + coalesce((select sum(e.balance_delta_pesewas) from public.ledger_entries e join public.financial_accounts a on a.id=e.account_id where e.business_id=target_business_id and e.account_id=a.id and a.account_code='CASH_ON_HAND' and e.created_at <= target_cutoff),0) + coalesce((select sum(fa.amount_pesewas) from public.financial_adjustments fa join public.financial_accounts a on a.id=fa.account_id where fa.business_id=target_business_id and fa.booth_id is null and fa.status='POSTED' and fa.created_at <= target_cutoff and not exists (select 1 from public.ledger_entries le where le.business_id=fa.business_id and le.account_id=fa.account_id and le.created_at=fa.created_at and le.entry_type='ADJUSTMENT')),0)),
    'MTN_FLOAT', greatest(0, coalesce((select a.opening_balance_pesewas from public.financial_accounts a where a.business_id=target_business_id and a.booth_id=target_booth_id and a.account_code='MTN_FLOAT' limit 1),0) + coalesce((select sum(e.balance_delta_pesewas) from public.ledger_entries e join public.financial_accounts a on a.id=e.account_id where e.business_id=target_business_id and e.booth_id=target_booth_id and a.id=e.account_id and a.network='MTN' and e.created_at <= target_cutoff),0)),
    'TELECEL_FLOAT', greatest(0, coalesce((select a.opening_balance_pesewas from public.financial_accounts a where a.business_id=target_business_id and a.booth_id=target_booth_id and a.account_code='TELECEL_FLOAT' limit 1),0) + coalesce((select sum(e.balance_delta_pesewas) from public.ledger_entries e join public.financial_accounts a on a.id=e.account_id where e.business_id=target_business_id and e.booth_id=target_booth_id and a.id=e.account_id and a.network='TELECEL' and e.created_at <= target_cutoff),0)),
    'AT_FLOAT', greatest(0, coalesce((select a.opening_balance_pesewas from public.financial_accounts a where a.business_id=target_business_id and a.booth_id=target_booth_id and a.account_code='AT_FLOAT' limit 1),0) + coalesce((select sum(e.balance_delta_pesewas) from public.ledger_entries e join public.financial_accounts a on a.id=e.account_id where e.business_id=target_business_id and e.booth_id=target_booth_id and a.id=e.account_id and a.network='AT' and e.created_at <= target_cutoff),0))
  );
$$;

create or replace function public.start_reconciliation(target_business_id uuid, target_booth_id uuid, target_business_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare existing public.reconciliation_sessions%rowtype; new_id uuid; cutoff timestamptz; tz text; expected jsonb; code text;
begin
  if not public.reconciliation_actor_can_access(target_business_id,target_booth_id,false) then raise exception using errcode='42501', message='Reconciliation access denied'; end if;
  select timezone into tz from public.business_settings where business_id=target_business_id;
  tz := coalesce(tz,'Africa/Accra');
  cutoff := ((target_business_date + 1)::text || ' 00:00:00')::timestamp at time zone tz;
  select * into existing from public.reconciliation_sessions where business_id=target_business_id and booth_id=target_booth_id and business_date=target_business_date for update;
  if found then return jsonb_build_object('session_id',existing.id,'status',existing.status,'cutoff_at',existing.cutoff_at); end if;
  expected := public.reconciliation_expected_lines(target_business_id,target_booth_id,cutoff);
  insert into public.reconciliation_sessions(business_id,booth_id,business_date,cutoff_at,prepared_by) values (target_business_id,target_booth_id,target_business_date,cutoff,auth.uid()) returning id into new_id;
  foreach code in array array['PHYSICAL_CASH','MTN_FLOAT','TELECEL_FLOAT','AT_FLOAT'] loop
    insert into public.reconciliation_lines(session_id,line_code,expected_pesewas) values (new_id,code,(expected->>code)::bigint);
  end loop;
  insert into public.reconciliation_status_history(session_id,business_id,to_status,changed_by) values (new_id,target_business_id,'DRAFT',auth.uid());
  return jsonb_build_object('session_id',new_id,'status','DRAFT','cutoff_at',cutoff);
end; $$;

create or replace function public.save_reconciliation_draft(target_session_id uuid, physical_cash_pesewas bigint, mtn_float_pesewas bigint, telecel_float_pesewas bigint, at_float_pesewas bigint, target_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.reconciliation_sessions%rowtype; vals bigint[] := array[physical_cash_pesewas,mtn_float_pesewas,telecel_float_pesewas,at_float_pesewas]; codes text[] := array['PHYSICAL_CASH','MTN_FLOAT','TELECEL_FLOAT','AT_FLOAT']; i integer;
begin
  select * into s from public.reconciliation_sessions where id=target_session_id for update;
  if not found or not public.reconciliation_actor_can_access(s.business_id,s.booth_id,false) then raise exception using errcode='42501',message='Reconciliation access denied'; end if;
  if s.status='APPROVED' or s.status='SUBMITTED' then raise exception using errcode='42501',message='This reconciliation is locked'; end if;
  for i in 1..4 loop if vals[i] is not null and vals[i] < 0 then raise exception using errcode='22023',message='Balances cannot be negative'; end if; update public.reconciliation_lines set actual_pesewas=vals[i],updated_at=now() where session_id=s.id and line_code=codes[i]; end loop;
  if s.status='REJECTED' then update public.reconciliation_sessions set status='DRAFT',review_comment=null,reviewed_by=null,reviewed_at=null,notes=target_notes,updated_at=now() where id=s.id; insert into public.reconciliation_status_history(session_id,business_id,from_status,to_status,comment,changed_by) values(s.id,s.business_id,'REJECTED','DRAFT','Correction started',auth.uid()); else update public.reconciliation_sessions set notes=target_notes,updated_at=now() where id=s.id; end if;
  return jsonb_build_object('session_id',s.id,'status','DRAFT');
end; $$;

create or replace function public.submit_reconciliation(target_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.reconciliation_sessions%rowtype;
begin
  select * into s from public.reconciliation_sessions where id=target_session_id for update;
  if not found or not public.reconciliation_actor_can_access(s.business_id,s.booth_id,false) then raise exception using errcode='42501',message='Reconciliation access denied'; end if;
  if s.status not in ('DRAFT','REJECTED') then raise exception using errcode='22023',message='Only a draft can be submitted'; end if;
  if exists(select 1 from public.reconciliation_lines where session_id=s.id and actual_pesewas is null) then raise exception using errcode='22023',message='Count every balance before submitting'; end if;
  update public.reconciliation_sessions set status='SUBMITTED',submitted_at=now(),updated_at=now() where id=s.id;
  insert into public.reconciliation_status_history(session_id,business_id,from_status,to_status,changed_by) values(s.id,s.business_id,s.status,'SUBMITTED',auth.uid());
  return jsonb_build_object('session_id',s.id,'status','SUBMITTED');
end; $$;

create or replace function public.review_reconciliation(target_session_id uuid, decision text, target_comment text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.reconciliation_sessions%rowtype; next_status text;
begin
  select * into s from public.reconciliation_sessions where id=target_session_id for update;
  if not found or not public.reconciliation_actor_can_access(s.business_id,s.booth_id,true) then raise exception using errcode='42501',message='Owner authorisation required'; end if;
  if s.status <> 'SUBMITTED' then raise exception using errcode='22023',message='Only submitted reconciliations can be reviewed'; end if;
  if decision not in ('APPROVE','REJECT') then raise exception using errcode='22023',message='Invalid review decision'; end if;
  next_status := case when decision='APPROVE' then 'APPROVED' else 'REJECTED' end;
  update public.reconciliation_sessions set status=next_status,reviewed_by=auth.uid(),reviewed_at=now(),review_comment=target_comment,updated_at=now() where id=s.id;
  insert into public.reconciliation_status_history(session_id,business_id,from_status,to_status,comment,changed_by) values(s.id,s.business_id,'SUBMITTED',next_status,target_comment,auth.uid());
  return jsonb_build_object('session_id',s.id,'status',next_status);
end; $$;

grant execute on function public.reconciliation_actor_can_access(uuid,uuid,boolean) to authenticated;
grant execute on function public.reconciliation_expected_lines(uuid,uuid,timestamptz) to authenticated;
grant execute on function public.start_reconciliation(uuid,uuid,date) to authenticated;
grant execute on function public.save_reconciliation_draft(uuid,bigint,bigint,bigint,bigint,text) to authenticated;
grant execute on function public.submit_reconciliation(uuid) to authenticated;
grant execute on function public.review_reconciliation(uuid,text,text) to authenticated;
revoke all on function public.reconciliation_actor_can_access(uuid,uuid,boolean) from anon;
revoke all on function public.reconciliation_expected_lines(uuid,uuid,timestamptz) from anon;
revoke all on function public.start_reconciliation(uuid,uuid,date) from anon;
revoke all on function public.save_reconciliation_draft(uuid,bigint,bigint,bigint,bigint,text) from anon;
revoke all on function public.submit_reconciliation(uuid) from anon;
revoke all on function public.review_reconciliation(uuid,text,text) from anon;
