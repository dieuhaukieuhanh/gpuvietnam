-- Architecture Freeze v3.2 - legacy machines.port data migration
-- Apply after machines-endpoint-v32.sql (0033).
--
-- Step A: creating/starting rows used internal 8080 placeholder -> explicit Pending.
-- Step B: running rows with port=8080 -> enqueue projection_verify (idempotent).

update public.machines
set
  port = null,
  updated_at = now()
where status in ('creating', 'starting')
  and port = 8080;

insert into public.machine_operations (
  operation,
  user_id,
  idempotency_key,
  correlation_id,
  priority,
  machine_id,
  gpu_session_id,
  provider,
  payload,
  retry_policy,
  state
)
select
  'projection_verify',
  m.user_id,
  'projection_verify:' || m.user_id::text || ':' || m.id::text,
  gen_random_uuid(),
  60,
  m.id,
  m.gpu_session_id,
  coalesce(nullif(trim(m.provider), ''), 'vast'),
  jsonb_build_object(
    'source', 'endpoint_v32_legacy_port_8080',
    'migration', 'machines-endpoint-v32-data'
  ),
  'default_drift',
  'pending'
from public.machines m
where m.status = 'running'
  and m.port = 8080
  and m.instance_id is not null
on conflict (idempotency_key) do nothing;