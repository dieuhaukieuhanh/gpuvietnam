-- Architecture v2.0 (ADR-005) — Control Plane data model foundation (B1.2)
-- Tables: cp_sessions, projects, jobs, job_attempts, runtime_registry
--
-- Naming:
--   * cp_sessions = Architecture "Session" (user work context). NOT public.gpu_sessions
--     (SCB billing truth for rented GPU hours).
--   * jobs / job_attempts = Architecture Job / Attempt (execution units).
--   * runtime_registry = disposable Runtime metadata (endpoint, provider, machine link).
--
-- IMPORTANT — do NOT recreate public.workflows here.
-- Catalog/marketplace `public.workflows` already exists (supabase/workflows.sql).
-- Architecture Workflow SoT lives in public.cp_workflows (migration 0046).
--
-- Idempotent. Apply via scripts/run-migrations.mjs (manifest id 0043).

-- ---------------------------------------------------------------------------
-- cp_sessions — Control Plane Session (SoT for work context)
-- ---------------------------------------------------------------------------
create table if not exists public.cp_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- Optional link to commercial GPU rental session (SCB); not required for SoT
  gpu_session_id uuid references public.gpu_sessions(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'closed')),
  title text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists cp_sessions_user_id_status_idx
  on public.cp_sessions (user_id, status);

create index if not exists cp_sessions_gpu_session_id_idx
  on public.cp_sessions (gpu_session_id)
  where gpu_session_id is not null;

comment on table public.cp_sessions is
  'Architecture v2.0 Session SoT (user work context). Distinct from gpu_sessions (billing).';

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cp_session_id uuid references public.cp_sessions(id) on delete set null,
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'archived', 'deleted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_status_idx
  on public.projects (user_id, status);

create index if not exists projects_cp_session_id_idx
  on public.projects (cp_session_id)
  where cp_session_id is not null;

comment on table public.projects is
  'Architecture v2.0 Project SoT. Survives Runtime/GPU replacement.';

-- ---------------------------------------------------------------------------
-- runtime_registry — disposable Runtime metadata (not user data SoT)
-- ---------------------------------------------------------------------------
create table if not exists public.runtime_registry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  machine_id uuid references public.machines(id) on delete set null,
  provider text not null default 'vast',
  -- Provider instance id when known
  instance_id text,
  -- Adapter kind; v2.0 starts with comfy
  runtime_kind text not null default 'comfy'
    check (runtime_kind in ('comfy')),
  status text not null default 'pending'
    check (status in (
      'pending',
      'provisioning',
      'starting',
      'ready',
      'busy',
      'unhealthy',
      'stopping',
      'destroyed',
      'error'
    )),
  endpoint_url text,
  -- Reference to Runtime Image Spec id/version (B1.3.5); free-form until Spec table exists
  image_spec_ref text,
  image text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  destroyed_at timestamptz
);

create index if not exists runtime_registry_user_id_status_idx
  on public.runtime_registry (user_id, status);

create index if not exists runtime_registry_machine_id_idx
  on public.runtime_registry (machine_id)
  where machine_id is not null;

create index if not exists runtime_registry_instance_id_idx
  on public.runtime_registry (provider, instance_id)
  where instance_id is not null;

comment on table public.runtime_registry is
  'Architecture v2.0 Runtime Registry: disposable compute endpoint metadata. '
  'Destroying a row/runtime must not delete Project/Workflow/Job history.';

-- ---------------------------------------------------------------------------
-- jobs — unit of work requested by the user / Control Plane
-- ---------------------------------------------------------------------------
-- workflow_id may point at catalog public.workflows (legacy) or stay null;
-- Architecture editor SoT uses jobs.cp_workflow_id (migration 0046).
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  workflow_id uuid references public.workflows(id) on delete set null,
  cp_session_id uuid references public.cp_sessions(id) on delete set null,
  -- Snapshot of workflow document at submit time (immutable for this job)
  workflow_snapshot jsonb,
  status text not null default 'queued'
    check (status in (
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled'
    )),
  -- Policy hint: single | dual_run | etc. (Runtime Policy; default single)
  execution_policy text not null default 'single'
    check (execution_policy in ('single', 'dual_run')),
  priority integer not null default 0,
  error_message text,
  result_manifest jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists jobs_user_id_status_idx
  on public.jobs (user_id, status);

create index if not exists jobs_project_id_idx
  on public.jobs (project_id)
  where project_id is not null;

create index if not exists jobs_workflow_id_idx
  on public.jobs (workflow_id)
  where workflow_id is not null;

create index if not exists jobs_created_at_idx
  on public.jobs (created_at desc);

comment on table public.jobs is
  'Architecture v2.0 Job: unit of work. Survives Runtime failure; new work uses new Attempts.';

-- ---------------------------------------------------------------------------
-- job_attempts — one execution of a Job on a specific Runtime
-- ---------------------------------------------------------------------------
create table if not exists public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  runtime_id uuid references public.runtime_registry(id) on delete set null,
  machine_id uuid references public.machines(id) on delete set null,
  attempt_number integer not null default 1,
  status text not null default 'pending'
    check (status in (
      'pending',
      'provisioning',
      'submitting',
      'running',
      'succeeded',
      'failed',
      'cancelled'
    )),
  -- Provider/Runtime opaque ids (e.g. Comfy prompt_id)
  external_prompt_id text,
  image_spec_ref text,
  error_message text,
  -- Durable output references after fetch (paths/URLs in Control Plane storage)
  result_manifest jsonb,
  progress jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint job_attempts_job_id_attempt_number_key unique (job_id, attempt_number)
);

create index if not exists job_attempts_job_id_status_idx
  on public.job_attempts (job_id, status);

create index if not exists job_attempts_runtime_id_idx
  on public.job_attempts (runtime_id)
  where runtime_id is not null;

create index if not exists job_attempts_user_id_created_at_idx
  on public.job_attempts (user_id, created_at desc);

create index if not exists job_attempts_external_prompt_id_idx
  on public.job_attempts (external_prompt_id)
  where external_prompt_id is not null;

comment on table public.job_attempts is
  'Architecture v2.0 Attempt: one execution of a Job on one Runtime. '
  'GPU death => mark failed and create a new Attempt (no CUDA/queue resume).';

-- ---------------------------------------------------------------------------
-- RLS — service_role manages (same pattern as comfy_access_tokens)
-- ---------------------------------------------------------------------------
alter table public.cp_sessions enable row level security;
alter table public.projects enable row level security;
alter table public.runtime_registry enable row level security;
alter table public.jobs enable row level security;
alter table public.job_attempts enable row level security;

drop policy if exists "Service role manages cp_sessions" on public.cp_sessions;
create policy "Service role manages cp_sessions"
  on public.cp_sessions for all to service_role
  using (true) with check (true);

drop policy if exists "Service role manages projects" on public.projects;
create policy "Service role manages projects"
  on public.projects for all to service_role
  using (true) with check (true);

drop policy if exists "Service role manages runtime_registry" on public.runtime_registry;
create policy "Service role manages runtime_registry"
  on public.runtime_registry for all to service_role
  using (true) with check (true);

drop policy if exists "Service role manages jobs" on public.jobs;
create policy "Service role manages jobs"
  on public.jobs for all to service_role
  using (true) with check (true);

drop policy if exists "Service role manages job_attempts" on public.job_attempts;
create policy "Service role manages job_attempts"
  on public.job_attempts for all to service_role
  using (true) with check (true);
