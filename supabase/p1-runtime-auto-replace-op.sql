-- P1: Durable runtime_auto_replace on machine_operations queue.
-- Keeps Billing Session OPEN; rents a new GPU and rebinds Workspace.

alter table public.machine_operations drop constraint if exists machine_operations_operation_check;
alter table public.machine_operations add constraint machine_operations_operation_check
  check (operation in (
    'drift_update_subscription',
    'drift_mark_destroyed_local',
    'drift_destroy_user_machine',
    'drift_destroy_and_subscription_offline',
    'projection_verify',
    'user_start_provision',
    'runtime_auto_replace'
  ));

comment on column public.machine_operations.operation is
  'Queue operation type. runtime_auto_replace = P1 replace dead Runtime while Billing Session stays OPEN.';
