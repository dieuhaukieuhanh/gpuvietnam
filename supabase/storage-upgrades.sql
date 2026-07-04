-- GPUVietnam storage upgrades — chạy trên Supabase SQL Editor

-- Cột gói bộ nhớ & ví trên users (nếu chưa có)
alter table public.users
  add column if not exists ssd_plan_gb integer not null default 20,
  add column if not exists backup_plan_gb integer not null default 20,
  add column if not exists wallet_balance numeric not null default 0;

create table if not exists public.storage_upgrades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  current_ssd_gb integer not null,
  current_backup_gb integer not null,
  requested_ssd_gb integer not null,
  requested_backup_gb integer not null,
  price_change_per_month numeric not null default 0,
  total_amount numeric not null default 0,
  payment_method text check (payment_method in ('wallet', 'transfer')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded')),
  transfer_note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_storage_upgrades_user on public.storage_upgrades (user_id);
create index if not exists idx_storage_upgrades_status on public.storage_upgrades (status);

create or replace function public.set_storage_upgrades_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists storage_upgrades_updated_at on public.storage_upgrades;
create trigger storage_upgrades_updated_at
  before update on public.storage_upgrades
  for each row
  execute function public.set_storage_upgrades_updated_at();

alter table public.storage_upgrades enable row level security;

create policy "Users read own storage upgrades"
  on public.storage_upgrades for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Service role manages storage upgrades" on public.storage_upgrades;
create policy "Service role manages storage upgrades"
  on public.storage_upgrades for all
  to service_role
  using (true)
  with check (true);
