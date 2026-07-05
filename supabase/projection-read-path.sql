-- SCB 2.1 Architecture Freeze v2 — Projection-first read path
-- Apply after machine-operations-hardening.sql (0031).

-- Projection fields for read APIs (machines/status, dashboard) without Provider I/O.
alter table public.machines
  add column if not exists projection_verified_at timestamptz,
  add column if not exists projection_message text;

comment on column public.machines.projection_verified_at is
  'Last time Verification Pipeline confirmed provider state and updated this projection row.';
comment on column public.machines.projection_message is
  'User-facing status message from last verification (read path uses without Provider call).';

-- Allow projection_verify operation in durable queue.
alter table public.machine_operations drop constraint if exists machine_operations_operation_check;
alter table public.machine_operations add constraint machine_operations_operation_check
  check (operation in (
    'drift_update_subscription',
    'drift_mark_destroyed_local',
    'drift_destroy_user_machine',
    'drift_destroy_and_subscription_offline',
    'projection_verify'
  ));

comment on column public.machine_operations.operation is
  'Queue operation type. projection_verify = AF v2 async provider verification (off HTTP read path).';
