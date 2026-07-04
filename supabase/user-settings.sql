-- GPUVietnam user settings — chạy trên Supabase SQL Editor hoặc: npm run db:user-settings
-- Logic JS (DEFAULT_USER_SETTINGS, getOrCreate...): src/lib/user-settings.js — KHÔNG đặt code JS trong file này.

-- Họ tên hiển thị
alter table public.users
  add column if not exists full_name text;

-- Cột ngưỡng gia hạn tự động (nếu bảng đã tạo trước đó)
alter table public.user_settings
  add column if not exists auto_renew_threshold integer not null default 5
    check (auto_renew_threshold >= 1 and auto_renew_threshold <= 48);

-- Auto top-up (gói Hourly)
alter table public.user_settings
  add column if not exists auto_topup_enabled boolean not null default false,
  add column if not exists auto_topup_threshold integer not null default 50000
    check (auto_topup_threshold in (30000, 50000, 100000)),
  add column if not exists auto_topup_amount integer not null default 200000
    check (auto_topup_amount in (100000, 200000, 500000)),
  add column if not exists auto_topup_warn_enabled boolean not null default true;

-- Cài đặt chung (gia hạn tự động, giao diện)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_renew_enabled boolean not null default false,
  auto_renew_method text not null default 'wallet'
    check (auto_renew_method in ('wallet', 'transfer')),
  theme text not null default 'dark'
    check (theme in ('light', 'dark')),
  auto_renew_threshold integer not null default 5
    check (auto_renew_threshold >= 1 and auto_renew_threshold <= 48),
  auto_topup_enabled boolean not null default false,
  auto_topup_threshold integer not null default 50000
    check (auto_topup_threshold in (30000, 50000, 100000)),
  auto_topup_amount integer not null default 200000
    check (auto_topup_amount in (100000, 200000, 500000)),
  auto_topup_warn_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Cài đặt thông báo
create table if not exists public.user_notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  zalo_enabled boolean not null default true,
  email_enabled boolean not null default true,
  event_low_hours boolean not null default true,
  event_expiring boolean not null default true,
  event_backup_full boolean not null default true,
  event_payment_success boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Lịch sử ví
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('topup', 'payment', 'refund', 'bonus')),
  amount numeric not null default 0,
  bonus_amount numeric not null default 0,
  balance_after numeric,
  description text,
  status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_transactions_user on public.wallet_transactions (user_id);
create index if not exists idx_wallet_transactions_created on public.wallet_transactions (created_at desc);

alter table public.user_settings enable row level security;
alter table public.user_notification_settings enable row level security;
alter table public.wallet_transactions enable row level security;

-- Policies (drop trước để chạy lại an toàn)
drop policy if exists "Users read own settings" on public.user_settings;
drop policy if exists "Users update own settings" on public.user_settings;
drop policy if exists "Users insert own settings" on public.user_settings;
drop policy if exists "Service role manages user settings" on public.user_settings;

drop policy if exists "Users read own notification settings" on public.user_notification_settings;
drop policy if exists "Users update own notification settings" on public.user_notification_settings;
drop policy if exists "Users insert own notification settings" on public.user_notification_settings;
drop policy if exists "Service role manages notification settings" on public.user_notification_settings;

drop policy if exists "Users read own wallet transactions" on public.wallet_transactions;
drop policy if exists "Service role manages wallet transactions" on public.wallet_transactions;

create policy "Users read own settings"
  on public.user_settings for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users update own settings"
  on public.user_settings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users insert own settings"
  on public.user_settings for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users read own notification settings"
  on public.user_notification_settings for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users update own notification settings"
  on public.user_notification_settings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users insert own notification settings"
  on public.user_notification_settings for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users read own wallet transactions"
  on public.wallet_transactions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Service role manages user settings"
  on public.user_settings for all
  to service_role
  using (true) with check (true);

create policy "Service role manages notification settings"
  on public.user_notification_settings for all
  to service_role
  using (true) with check (true);

create policy "Service role manages wallet transactions"
  on public.wallet_transactions for all
  to service_role
  using (true) with check (true);
