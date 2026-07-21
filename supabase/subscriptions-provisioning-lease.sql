-- Provision lease + heartbeat for start-machine claims.
-- Replaces fixed 3-minute stale reclaim with leaseExpiresAt renewed by heartbeats.

alter table public.subscriptions
  add column if not exists provisioning_lease_id text,
  add column if not exists provisioning_lease_expires_at timestamptz,
  add column if not exists provisioning_heartbeat_at timestamptz,
  add column if not exists provisioning_lease_owner text;

comment on column public.subscriptions.provisioning_lease_id is
  'Opaque lease id for the active provisioning owner. Cleared when leaving provisioning.';
comment on column public.subscriptions.provisioning_lease_expires_at is
  'Lease expiry. Extended by heartbeat. Reclaim only when expired (or legacy started_at fallback).';
comment on column public.subscriptions.provisioning_heartbeat_at is
  'Last successful lease heartbeat timestamp.';
comment on column public.subscriptions.provisioning_lease_owner is
  'Worker/process owner id that holds the lease (pid+host+token).';

create index if not exists subscriptions_provisioning_lease_expires_idx
  on public.subscriptions (server_status, provisioning_lease_expires_at)
  where server_status = 'provisioning';
