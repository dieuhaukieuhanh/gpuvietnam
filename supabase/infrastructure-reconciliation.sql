-- M13 — Infrastructure Reconciliation audit tables (read-only scan logs)
-- Apply after core SCB schema (supabase/scb-schema.sql)

create table if not exists public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  repair boolean not null default false,
  drift_count integer not null default 0,
  repaired_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  already_consistent_count integer not null default 0,
  module_version text,
  metadata jsonb
);

create table if not exists public.drift_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.reconciliation_runs(id) on delete cascade,
  drift_type text not null,
  entity_type text not null,
  entity_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  machine_id uuid references public.machines(id) on delete set null,
  instance_id text,
  status text not null default 'open'
    check (status in ('open', 'repaired', 'skipped', 'failed', 'already_consistent')),
  message text,
  details jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_drift_items_run on public.drift_items(run_id);
create index if not exists idx_drift_items_status on public.drift_items(status);
create index if not exists idx_drift_items_type on public.drift_items(drift_type);

comment on table public.reconciliation_runs is
  'Infrastructure reconciliation scan runs (SCB §8) — separate from session settlement audit.';
comment on table public.drift_items is
  'Provider/DB drift items detected by reconciliation; repair outcomes logged per item.';

alter table public.reconciliation_runs enable row level security;
alter table public.drift_items enable row level security;

drop policy if exists "Service role manages reconciliation runs" on public.reconciliation_runs;
create policy "Service role manages reconciliation runs"
  on public.reconciliation_runs for all
  using (true)
  with check (true);

drop policy if exists "Service role manages drift items" on public.drift_items;
create policy "Service role manages drift items"
  on public.drift_items for all
  using (true)
  with check (true);
