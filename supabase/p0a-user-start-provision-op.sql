-- P0-A: Durable user_start_provision on machine_operations queue.
-- Apply after projection-read-path.sql (0032) / a1 editor tokens (0048).

alter table public.machine_operations drop constraint if exists machine_operations_operation_check;
alter table public.machine_operations add constraint machine_operations_operation_check
  check (operation in (
    'drift_update_subscription',
    'drift_mark_destroyed_local',
    'drift_destroy_user_machine',
    'drift_destroy_and_subscription_offline',
    'projection_verify',
    'user_start_provision'
  ));

comment on column public.machine_operations.operation is
  'Queue operation type. user_start_provision = durable start-machine provision (P0-A Lifecycle Worker).';
