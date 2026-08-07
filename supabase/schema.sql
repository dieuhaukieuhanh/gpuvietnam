-- GPUVietnam auth schema (run in Supabase SQL Editor)

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  phone text unique,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration: thêm cột email_verified nếu chưa có (cho DB cũ)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'users' and table_schema = 'public' and column_name = 'email_verified'
  ) then
    alter table public.users add column email_verified boolean not null default false;
  end if;
end $$;

-- Migration: thêm cột full_name nếu chưa có
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'users' and table_schema = 'public' and column_name = 'full_name'
  ) then
    alter table public.users add column full_name text;
  end if;
end $$;

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

-- Trigger: auto tạo public.users khi auth.users có user mới (Google OAuth, v.v.)
create or replace function public.handle_new_auth_user()
returns trigger as $$
begin
  insert into public.users (id, email, email_verified, phone_verified)
  values (
    new.id,
    new.email,
    case when new.email_confirmed_at is not null then true else false end,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- Trigger: đồng bộ email_verified từ auth.users.email_confirmed_at
create or replace function public.sync_email_verified()
returns trigger as $$
begin
  if new.email_confirmed_at is not null and
     (old is null or old.email_confirmed_at is null or new.email_confirmed_at <> old.email_confirmed_at) then
    update public.users
      set email_verified = true, updated_at = now()
      where id = new.id and email_verified = false;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tr_sync_email_verified on auth.users;
create trigger tr_sync_email_verified
  after update on auth.users
  for each row
  execute function public.sync_email_verified();
