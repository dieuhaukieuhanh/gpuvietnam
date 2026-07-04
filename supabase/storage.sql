-- GPUVietnam storage_files (SSD & Backup) — chạy trên Supabase SQL Editor

create table if not exists public.storage_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size_bytes bigint not null default 0,
  storage_type text not null check (storage_type in ('ssd', 'backup')),
  category text not null check (category in ('model', 'output', 'workflow', 'custom_node')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_storage_files_user on public.storage_files (user_id);
create index if not exists idx_storage_files_type on public.storage_files (storage_type);
create index if not exists idx_storage_files_category on public.storage_files (category);

create or replace function public.set_storage_files_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists storage_files_updated_at on public.storage_files;
create trigger storage_files_updated_at
  before update on public.storage_files
  for each row
  execute function public.set_storage_files_updated_at();

alter table public.storage_files enable row level security;

create policy "Users read own storage files"
  on public.storage_files for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users insert own storage files"
  on public.storage_files for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users update own storage files"
  on public.storage_files for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete own storage files"
  on public.storage_files for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Service role manages storage files" on public.storage_files;
create policy "Service role manages storage files"
  on public.storage_files for all
  to service_role
  using (true)
  with check (true);
