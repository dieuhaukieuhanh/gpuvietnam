-- Provision progress snapshot for dashboard resume (canonical stages JSON).
alter table public.subscriptions
  add column if not exists provisioning_progress jsonb;

comment on column public.subscriptions.provisioning_progress is
  'Latest provision progress engine snapshot (stage, startedAt, provider, hostId, …). Cleared when leaving provisioning.';