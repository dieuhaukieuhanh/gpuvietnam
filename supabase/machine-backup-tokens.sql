-- Machine-scoped backup tokens for R2 presigned uploads (A1–A2).
-- Opaque token is shown once to the container; only sha256 hash is stored.

create table if not exists public.machine_backup_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  machine_id uuid references public.machines(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint machine_backup_tokens_token_hash_key unique (token_hash)
);

create index if not exists machine_backup_tokens_user_id_idx
  on public.machine_backup_tokens (user_id);

create index if not exists machine_backup_tokens_machine_id_idx
  on public.machine_backup_tokens (machine_id)
  where machine_id is not null;

create index if not exists machine_backup_tokens_active_idx
  on public.machine_backup_tokens (token_hash)
  where revoked_at is null;

comment on table public.machine_backup_tokens is
  'Scoped credentials for container → R2 presign API. Not a full user session JWT.';

alter table public.machine_backup_tokens enable row level security;

drop policy if exists "Service role manages machine_backup_tokens" on public.machine_backup_tokens;
create policy "Service role manages machine_backup_tokens"
  on public.machine_backup_tokens for all
  to service_role
  using (true)
  with check (true);