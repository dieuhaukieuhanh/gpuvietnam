-- GPUVietnam storage pricing — chạy trên Supabase SQL Editor

create table if not exists public.storage_pricing (
  id uuid primary key default gen_random_uuid(),
  storage_type text not null check (storage_type in ('ssd', 'backup')),
  size_gb integer not null check (size_gb in (10, 20, 50, 100)),
  price_monthly numeric not null check (price_monthly >= 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (storage_type, size_gb)
);

create index if not exists idx_storage_pricing_type on public.storage_pricing (storage_type);
create index if not exists idx_storage_pricing_active on public.storage_pricing (is_active);

create or replace function public.set_storage_pricing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists storage_pricing_updated_at on public.storage_pricing;
create trigger storage_pricing_updated_at
  before update on public.storage_pricing
  for each row
  execute function public.set_storage_pricing_updated_at();

alter table public.storage_pricing enable row level security;

-- Authenticated users có thể xem bảng giá
create policy "Authenticated read storage pricing"
  on public.storage_pricing for select
  to authenticated
  using (true);

-- Admin có thể sửa
create policy "Admin update storage pricing"
  on public.storage_pricing for update
  to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  );

-- Service role full access (API routes — bypass RLS qua supabaseAdmin)
drop policy if exists "Service role manages storage pricing" on public.storage_pricing;
create policy "Service role manages storage pricing"
  on public.storage_pricing for all
  to service_role
  using (true)
  with check (true);

-- Seed giá mặc định (idempotent)
insert into public.storage_pricing (storage_type, size_gb, price_monthly, is_active)
values
  ('ssd', 10, 29000, true),
  ('ssd', 20, 49000, true),
  ('ssd', 50, 99000, true),
  ('ssd', 100, 179000, true),
  ('backup', 10, 19000, true),
  ('backup', 20, 29000, true),
  ('backup', 50, 69000, true),
  ('backup', 100, 129000, true)
on conflict (storage_type, size_gb) do nothing;
