-- Claim lock for start-machine: track when provisioning began so stale
-- boots (no machine row) can be reclaimed without double-renting in-flight work.

alter table public.subscriptions
  add column if not exists provisioning_started_at timestamptz;

comment on column public.subscriptions.provisioning_started_at is
  'Set when server_status transitions offline→provisioning (CAS claim). Cleared when leaving provisioning. Used to reclaim stuck boots without machine rows.';
