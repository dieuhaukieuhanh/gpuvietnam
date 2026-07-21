-- Architecture v2.0 B2 — Session continuity foundation
--
-- Catalog `public.workflows` (templates / marketplace) already exists.
-- Control Plane Workflow SoT uses `cp_workflows` to avoid schema collision
-- with foundation 0043's aspirational `workflows` name.
--
-- Also: project_snapshots (B2.2.5), jobs.cp_workflow_id link.
--
-- Idempotent. Manifest id 0046.

-- ---------------------------------------------------------------------------
-- cp_workflows — Control Plane Workflow document SoT (B2.1)
-- ---------------------------------------------------------------------------
create table if not exists public.cp_workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  cp_session_id uuid references public.cp_sessions(id) on delete set null,
  name text not null default 'Untitled',
  -- Comfy-compatible prompt/graph JSON + editor settings
  document jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cp_workflows_user_id_idx
  on public.cp_workflows (user_id);

create index if not exists cp_workflows_project_id_idx
  on public.cp_workflows (project_id)
  where project_id is not null;

create index if not exists cp_workflows_updated_at_idx
  on public.cp_workflows (updated_at desc);

comment on table public.cp_workflows is
  'B2.1 Architecture Workflow SoT (graph document). Distinct from catalog public.workflows.';

alter table public.cp_workflows enable row level security;

drop policy if exists "Service role manages cp_workflows" on public.cp_workflows;
create policy "Service role manages cp_workflows"
  on public.cp_workflows for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- jobs.cp_workflow_id — link Job to CP workflow (catalog workflows.workflow_id stays legacy)
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists cp_workflow_id uuid references public.cp_workflows(id) on delete set null;

create index if not exists jobs_cp_workflow_id_idx
  on public.jobs (cp_workflow_id)
  where cp_workflow_id is not null;

comment on column public.jobs.cp_workflow_id is
  'B2.1 Control Plane workflow document used as editor SoT; workflow_snapshot still frozen at submit.';

-- ---------------------------------------------------------------------------
-- project_snapshots — user Save points (B2.2.5)
-- ---------------------------------------------------------------------------
create table if not exists public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  cp_workflow_id uuid references public.cp_workflows(id) on delete set null,
  label text not null default 'Save',
  -- Frozen copies at save time
  workflow_document jsonb not null default '{}'::jsonb,
  workflow_settings jsonb not null default '{}'::jsonb,
  project_metadata jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_snapshots_project_id_created_at_idx
  on public.project_snapshots (project_id, created_at desc);

create index if not exists project_snapshots_user_id_idx
  on public.project_snapshots (user_id);

comment on table public.project_snapshots is
  'B2.2.5 Project Snapshot — user Save; restore reapplies document to cp_workflows without needing GPU.';

alter table public.project_snapshots enable row level security;

drop policy if exists "Service role manages project_snapshots" on public.project_snapshots;
create policy "Service role manages project_snapshots"
  on public.project_snapshots for all to service_role
  using (true) with check (true);
