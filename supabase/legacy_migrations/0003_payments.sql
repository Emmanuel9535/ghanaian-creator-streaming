create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null unique,
  film_id text,
  amount integer not null check (amount > 0),
  currency text not null default 'GHS' check (currency = 'GHS'),
  status text not null default 'initialized' check (status in ('initialized','pending','success','failed','abandoned','reversed')),
  paystack_transaction_id bigint,
  gateway_response text,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_id_idx on public.payments (user_id);
create index if not exists payments_status_idx on public.payments (status);

alter table public.payments enable row level security;

drop policy if exists "Users can read their own payments" on public.payments;
create policy "Users can read their own payments" on public.payments for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can initialize their own payments" on public.payments;
create policy "Users can initialize their own payments" on public.payments for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own initialized payments" on public.payments;
create policy "Users can update their own initialized payments" on public.payments for update using (auth.uid() = user_id and status in ('initialized','pending')) with check (auth.uid() = user_id);

create or replace function public.touch_payment_updated_at()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments for each row execute procedure public.touch_payment_updated_at();
