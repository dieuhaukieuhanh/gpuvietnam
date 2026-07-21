-- Admin-configurable periodic backup intervals (outputs / workflows) per plan.
-- Null intervals_json → code defaults in backup-auto-policy.js (BACKUP_INTERVALS_BY_PLAN).

alter table public.backup_auto_policy
  add column if not exists intervals_json jsonb;

comment on column public.backup_auto_policy.intervals_json is
  'Admin backup cadence per plan: { starter|pro|studio: { outputsSec, workflowsSec } }. '
  'Null or missing keys fall back to BACKUP_INTERVALS_BY_PLAN defaults. Applied at machine start.';
