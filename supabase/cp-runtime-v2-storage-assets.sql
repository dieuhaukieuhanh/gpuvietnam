-- Architecture v2.0 (ADR-005) — Control Plane durable asset catalog (B1.3)
-- Table: cp_assets
--
-- Object keys live on R2 under users/{userId}/cp/… (see B1_3_STORAGE_SPEC.md).
-- Destroying machines / runtime_registry must NOT delete these rows.
--
-- Idempotent. Apply via scripts/run-migrations.mjs (manifest id 0044).

create table if not exists public.cp_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  attempt_id uuid references public.job_attempts(id) on delete set null,
  kind text not null
    check (kind in (
      'input',
      'output',
      'project_asset',
      'log',
      'model_ref',
      'sidecar'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'failed', 'deleted')),
  -- Full R2 object key (e.g. users/{userId}/cp/jobs/{jobId}/inputs/a.png)
  object_key text not null,
  filename text not null,
  content_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  checksum_sha256 text,
  storage_backend text not null default 'r2'
    check (storage_backend in ('r2')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists cp_assets_object_key_uidx
  on public.cp_assets (object_key)
  where status <> 'deleted';

create index if not exists cp_assets_user_id_kind_idx
  on public.cp_assets (user_id, kind);

create index if not exists cp_assets_job_id_idx
  on public.cp_assets (job_id)
  where job_id is not null;

create index if not exists cp_assets_attempt_id_idx
  on public.cp_assets (attempt_id)
  where attempt_id is not null;

create index if not exists cp_assets_project_id_idx
  on public.cp_assets (project_id)
  where project_id is not null;

comment on table public.cp_assets is
  'Architecture v2.0 durable asset catalog (Plane B). '
  'R2 keys under users/{userId}/cp/. Independent of GPU disk and runtime_registry.';

alter table public.cp_assets enable row level security;

drop policy if exists "Service role manages cp_assets" on public.cp_assets;
create policy "Service role manages cp_assets"
  on public.cp_assets for all to service_role
  using (true) with check (true);
