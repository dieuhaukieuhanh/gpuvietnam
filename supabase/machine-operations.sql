-- SCB 2.1 Phase 2 — Machine Operation Queue
-- Durable repair jobs for read-path drift detect → enqueue → worker execute.
-- Apply after machines + gpu_sessions (0028 infrastructure-reconciliation).

create table if not exists public.machine_operations (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null default gen_random_uuid(),
  operation text not null
    check (operation in (
      'drift_update_subscription',
      'drift_mark_destroyed_local',
      'drift_destroy_user_machine',
      'drift_destroy_and_subscription_offline'
    )),
  state text not null default 'pending'
    check (state in (
      'pending',
      'leased',
      'running',
      'completed',
      'failed',
      'cancelled',
      'retry_scheduled'
    )),
  priority integer not null default 100,
  idempotency_key text not null,
  machine_id uuid references public.machines(id) on delete set null,
  gpu_session_id uuid references public.gpu_sessions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint machine_operations_idempotency_key_unique unique (idempotency_key)
);

create index if not exists idx_machine_operations_queue
  on public.machine_operations (priority asc, created_at asc)
  where state in ('pending', 'retry_scheduled');

create index if not exists idx_machine_operations_leased
  on public.machine_operations (lease_until asc)
  where state = 'leased';

create index if not exists idx_machine_operations_user_state
  on public.machine_operations (user_id, state);

create index if not exists idx_machine_operations_correlation
  on public.machine_operations (correlation_id);

comment on table public.machine_operations is
  'SCB 2.1 durable repair queue. Read path enqueues; worker executes without blocking HTTP.';

comment on column public.machine_operations.correlation_id is
  'End-to-end trace id: detect → queue → worker → pipeline logs.';

comment on column public.machine_operations.idempotency_key is
  'Unique dedupe key — prevents duplicate destroy/repair for same drift.';

alter table public.machine_operations enable row level security;

drop policy if exists "Service role manages machine_operations" on public.machine_operations;
create policy "Service role manages machine_operations"
  on public.machine_operations for all
  using (true)
  with check (true);
