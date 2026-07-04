-- GPUVietnam workflows — chạy trên Supabase SQL Editor

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  description text,
  thumbnail_url text,
  file_url text,
  running_time_minutes numeric not null default 0,
  recommended_gpu text,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflows_public_user_check check (
    (is_public = true and user_id is null)
    or (is_public = false and user_id is not null)
  )
);

create index if not exists idx_workflows_user on public.workflows (user_id);
create index if not exists idx_workflows_public on public.workflows (is_public);

create or replace function public.set_workflows_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workflows_updated_at on public.workflows;
create trigger workflows_updated_at
  before update on public.workflows
  for each row
  execute function public.set_workflows_updated_at();

alter table public.workflows enable row level security;

create policy "Authenticated reads public and own workflows"
  on public.workflows for select
  to authenticated
  using (is_public = true or user_id = auth.uid());

create policy "Users insert own workflows"
  on public.workflows for insert
  to authenticated
  with check (is_public = false and user_id = auth.uid());

create policy "Users update own workflows"
  on public.workflows for update
  to authenticated
  using (is_public = false and user_id = auth.uid())
  with check (is_public = false and user_id = auth.uid());

create policy "Users delete own workflows"
  on public.workflows for delete
  to authenticated
  using (is_public = false and user_id = auth.uid());

drop policy if exists "Service role manages workflows" on public.workflows;
create policy "Service role manages workflows"
  on public.workflows for all
  to service_role
  using (true)
  with check (true);
