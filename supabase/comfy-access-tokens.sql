-- ComfyUI reverse-proxy access tokens (Level C).
-- Opaque token issued to the browser; only sha256 hash is stored.
-- Worker resolves token to upstream via origin API (and optional CF KV mirror).

create table if not exists public.comfy_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete cascade,
  token_hash text not null,
  upstream_url text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint comfy_access_tokens_token_hash_key unique (token_hash)
);

create index if not exists comfy_access_tokens_user_id_idx
  on public.comfy_access_tokens (user_id);

create index if not exists comfy_access_tokens_machine_id_idx
  on public.comfy_access_tokens (machine_id);

create index if not exists comfy_access_tokens_active_idx
  on public.comfy_access_tokens (token_hash)
  where revoked_at is null;

comment on table public.comfy_access_tokens is
  'Short-lived tokens mapping browser to ComfyUI upstream for work.* reverse proxy.';

alter table public.comfy_access_tokens enable row level security;

drop policy if exists "Service role manages comfy_access_tokens" on public.comfy_access_tokens;
create policy "Service role manages comfy_access_tokens"
  on public.comfy_access_tokens for all
  to service_role
  using (true)
  with check (true);
