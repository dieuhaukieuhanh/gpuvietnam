-- SCB 2.1 Phase 2.5 — Machine Operation Queue production hardening
-- Apply after machine-operations.sql (0030).

alter table public.machine_operations
  add column if not exists next_retry_at timestamptz,
  add column if not exists retry_reason text,
  add column if not exists retry_policy text not null default 'default_drift',
  add column if not exists failure_reason text,
  add column if not exists final_error text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists provider text,
  add column if not exists lease_count integer not null default 0,
  add column if not exists metrics jsonb not null default '{}'::jsonb;

alter table public.machine_operations drop constraint if exists machine_operations_state_check;
alter table public.machine_operations add constraint machine_operations_state_check
  check (state in (
    'pending',
    'leased',
    'running',
    'completed',
    'failed',
    'cancelled',
    'retry_scheduled',
    'dead_letter'
  ));

create index if not exists idx_machine_operations_next_retry
  on public.machine_operations (next_retry_at asc)
  where state = 'retry_scheduled';

create index if not exists idx_machine_operations_dead_letter
  on public.machine_operations (created_at desc)
  where state = 'dead_letter';

create index if not exists idx_machine_operations_machine
  on public.machine_operations (machine_id, state);

comment on column public.machine_operations.next_retry_at is
  'When retry_scheduled row becomes eligible for pending promotion.';
comment on column public.machine_operations.retry_policy is
  'Central retry policy name — worker reads MACHINE_OPERATION_RETRY_POLICIES.';
comment on column public.machine_operations.metrics is
  'Phase 2.5 timing counters: queue_wait_ms, execution_ms, retry_count, lease_count, …';
