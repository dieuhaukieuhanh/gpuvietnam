-- GPUVietnam models (Checkpoint & LoRA) — chạy trên Supabase SQL Editor

create table if not exists public.models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('checkpoint', 'lora')),
  category text not null check (category in ('system', 'user')),
  user_id uuid references auth.users(id) on delete cascade,
  file_url text,
  thumbnail_url text,
  size_mb numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint models_user_category_check check (
    (category = 'system' and user_id is null)
    or (category = 'user' and user_id is not null)
  )
);

create index if not exists idx_models_category on public.models (category);
create index if not exists idx_models_user on public.models (user_id);
create index if not exists idx_models_type on public.models (type);

alter table public.models enable row level security;

create policy "Anyone authenticated reads system and own models"
  on public.models for select
  to authenticated
  using (category = 'system' or user_id = auth.uid());

create policy "Users insert own models"
  on public.models for insert
  to authenticated
  with check (category = 'user' and user_id = auth.uid());

create policy "Users update own models"
  on public.models for update
  to authenticated
  using (category = 'user' and user_id = auth.uid())
  with check (category = 'user' and user_id = auth.uid());

create policy "Users delete own models"
  on public.models for delete
  to authenticated
  using (category = 'user' and user_id = auth.uid());

drop policy if exists "Service role manages models" on public.models;
create policy "Service role manages models"
  on public.models for all
  to service_role
  using (true)
  with check (true);
