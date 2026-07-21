-- GPUVietnam subscriptions (chạy trên Supabase SQL Editor)

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null,
  billing text not null default 'combo1',
  env_name text not null,
  env_icon text default '👤',
  env_desc text,
  gpu_label text,
  hours_total numeric not null default 0,
  hours_used numeric not null default 0,
  status text not null default 'pending',
  server_status text not null default 'offline',
  provisioning_started_at timestamptz,
  is_trial boolean not null default false,
  transfer_note text,
  expires_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on public.subscriptions(user_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

alter table public.subscriptions enable row level security;

create policy "Users read own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "Service role manages subscriptions" on public.subscriptions;
create policy "Service role manages subscriptions"
  on public.subscriptions for all
  to service_role
  using (true)
  with check (true);
