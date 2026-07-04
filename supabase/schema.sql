-- GPUVietnam auth schema (run in Supabase SQL Editor)

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  phone text unique,
  phone_verified boolean not null default false,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  otp text not null,
  user_id uuid references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_otp_verifications_phone on public.otp_verifications(phone);
create index if not exists idx_otp_verifications_expires on public.otp_verifications(expires_at);

-- Profile sync: do /api/register upsert public.users (không dùng trigger auth.users)

alter table public.users enable row level security;
alter table public.otp_verifications enable row level security;

create policy "Users can read own profile"
  on public.users for select
  using (auth.uid() = id);

drop policy if exists "Service role manages users" on public.users;
create policy "Service role manages users"
  on public.users for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages otp" on public.otp_verifications;
create policy "Service role manages otp"
  on public.otp_verifications for all
  to service_role
  using (true)
  with check (true);
