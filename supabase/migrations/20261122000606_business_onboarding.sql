-- MoMo Ledger Stage 2: business onboarding and access foundation.
-- Non-destructive: adds new tables and policies without changing legacy profiles/payments data.

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 2 and 120),
  business_type text not null check (business_type in ('mobile_money_agent','mobile_money_vendor','mobile_money_booth','other')),
  owner_name text not null check (char_length(trim(owner_name)) between 2 and 120),
  contact_phone text not null check (char_length(trim(contact_phone)) between 7 and 30),
  contact_email text not null,
  region text not null check (char_length(trim(region)) between 2 and 80),
  town_city text not null check (char_length(trim(town_city)) between 2 and 100),
  address text not null check (char_length(trim(address)) between 2 and 240),
  digital_address text,
  logo_url text,
  setup_status text not null default 'business' check (setup_status in ('business','booth','balances','complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists businesses_owner_id_idx on public.businesses(owner_id);

create table if not exists public.booths (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  location text not null check (char_length(trim(location)) between 2 and 180),
  description text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists booths_business_id_idx on public.booths(business_id);

create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  booth_id uuid references public.booths(id) on delete set null,
  role text not null check (role in ('OWNER','ATTENDANT')),
  status text not null default 'active' check (status in ('active','suspended','pending')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index if not exists business_members_user_id_idx on public.business_members(user_id);
create index if not exists business_members_business_id_idx on public.business_members(business_id);

create table if not exists public.business_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  currency text not null default 'GHS' check (currency = 'GHS'),
  timezone text not null default 'Africa/Accra',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_opening_balances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  physical_cash_pesewas bigint not null check (physical_cash_pesewas >= 0),
  record_type text not null default 'opening_balance' check (record_type = 'opening_balance'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.booth_opening_balances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booth_id uuid not null references public.booths(id) on delete cascade,
  network text not null check (network in ('MTN','TELECEL','AT')),
  amount_pesewas bigint not null check (amount_pesewas >= 0),
  record_type text not null default 'opening_balance' check (record_type = 'opening_balance'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (booth_id, network)
);
create index if not exists booth_opening_balances_business_id_idx on public.booth_opening_balances(business_id);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booth_id uuid references public.booths(id) on delete set null,
  email text not null,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  phone text not null check (char_length(trim(phone)) between 7 and 30),
  role text not null default 'ATTENDANT' check (role = 'ATTENDANT'),
  status text not null default 'pending' check (status in ('pending','accepted','expired','cancelled')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);
create index if not exists invitations_business_id_idx on public.invitations(business_id);
create unique index if not exists invitations_pending_email_idx on public.invitations(business_id, lower(email)) where status = 'pending';

create or replace function public.touch_business_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at before update on public.businesses for each row execute procedure public.touch_business_updated_at();
drop trigger if exists booths_set_updated_at on public.booths;
create trigger booths_set_updated_at before update on public.booths for each row execute procedure public.touch_business_updated_at();
drop trigger if exists business_settings_set_updated_at on public.business_settings;
create trigger business_settings_set_updated_at before update on public.business_settings for each row execute procedure public.touch_business_updated_at();

create or replace function public.is_business_member(target_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.business_members m where m.business_id = target_business_id and m.user_id = auth.uid() and m.status = 'active');
$$;
create or replace function public.is_business_owner(target_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.business_members m where m.business_id = target_business_id and m.user_id = auth.uid() and m.role = 'OWNER' and m.status = 'active');
$$;

alter table public.businesses enable row level security;
alter table public.booths enable row level security;
alter table public.business_members enable row level security;
alter table public.business_settings enable row level security;
alter table public.business_opening_balances enable row level security;
alter table public.booth_opening_balances enable row level security;
alter table public.invitations enable row level security;

drop policy if exists "Owners can create businesses" on public.businesses;
create policy "Owners can create businesses" on public.businesses for insert with check (owner_id = auth.uid());
drop policy if exists "Members can read businesses" on public.businesses;
create policy "Members can read businesses" on public.businesses for select using (public.is_business_member(id) or owner_id = auth.uid());
drop policy if exists "Owners can update businesses" on public.businesses;
create policy "Owners can update businesses" on public.businesses for update using (public.is_business_owner(id)) with check (public.is_business_owner(id) and owner_id = auth.uid());

drop policy if exists "Members can read memberships" on public.business_members;
create policy "Members can read memberships" on public.business_members for select using (user_id = auth.uid() or public.is_business_member(business_id));
drop policy if exists "Owners can manage memberships" on public.business_members;
create policy "Owners can manage memberships" on public.business_members for insert with check ((role = 'OWNER' and user_id = auth.uid() and exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())) or (role = 'ATTENDANT' and public.is_business_owner(business_id)));
drop policy if exists "Owners can update memberships" on public.business_members;
create policy "Owners can update memberships" on public.business_members for update using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id) and role in ('OWNER','ATTENDANT'));

drop policy if exists "Members can read booths" on public.booths;
create policy "Members can read booths" on public.booths for select using (public.is_business_member(business_id) or exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));
drop policy if exists "Owners can manage booths" on public.booths;
create policy "Owners can manage booths" on public.booths for all using (public.is_business_owner(business_id) or exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())) with check (public.is_business_owner(business_id) or exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

drop policy if exists "Members can read settings" on public.business_settings;
create policy "Members can read settings" on public.business_settings for select using (public.is_business_member(business_id));
drop policy if exists "Owners can manage settings" on public.business_settings;
create policy "Owners can manage settings" on public.business_settings for all using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));

drop policy if exists "Members can read business opening balance" on public.business_opening_balances;
create policy "Members can read business opening balance" on public.business_opening_balances for select using (public.is_business_member(business_id));
drop policy if exists "Owners can create business opening balance" on public.business_opening_balances;
create policy "Owners can create business opening balance" on public.business_opening_balances for insert with check (public.is_business_owner(business_id) and created_by = auth.uid());

drop policy if exists "Members can read booth opening balances" on public.booth_opening_balances;
create policy "Members can read booth opening balances" on public.booth_opening_balances for select using (public.is_business_member(business_id));
drop policy if exists "Owners can create booth opening balances" on public.booth_opening_balances;
create policy "Owners can create booth opening balances" on public.booth_opening_balances for insert with check (public.is_business_owner(business_id) and created_by = auth.uid() and exists (select 1 from public.booths b where b.id = booth_id and b.business_id = business_id));

drop policy if exists "Owners can read invitations" on public.invitations;
create policy "Owners can read invitations" on public.invitations for select using (public.is_business_owner(business_id));
drop policy if exists "Owners can create invitations" on public.invitations;
create policy "Owners can create invitations" on public.invitations for insert with check (public.is_business_owner(business_id) and invited_by = auth.uid());
drop policy if exists "Owners can update invitations" on public.invitations;
create policy "Owners can update invitations" on public.invitations for update using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));