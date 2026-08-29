create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'viewer');
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

drop policy if exists "Profiles are publicly readable" on public.profiles;
drop policy if exists "Profiles are readable by owner or admin" on public.profiles;
create policy "Profiles are readable by owner or admin" on public.profiles
for select
using (auth.uid() = id or public.is_admin());

drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can update safe profile fields" on public.profiles;
create policy "Users can update safe profile fields" on public.profiles
for update
using (auth.uid() = id or public.is_admin())
with check (public.is_admin() or (auth.uid() = id and role = public.current_user_role()));
