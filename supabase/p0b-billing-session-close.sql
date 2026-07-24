-- P0-B Billing MVP: Billing Session close/settle independent of Runtime destroy.
--
-- Invariants:
--   billing start  = gpu_sessions.started_at (set once at RUNTIME_READY_FOR_BILLING)
--   billing end    = close_requested_at (User/Policy Close)
--   settle at Close; Runtime DEAD must not close/settle the Billing Session
--   verified_destroyed_at may lag (destroy after settle)
--
-- Idempotent: safe to re-run after a partial apply.

alter table public.gpu_sessions
  add column if not exists close_requested_at timestamptz;

comment on column public.gpu_sessions.close_requested_at is
  'P0-B: timestamp when User/Policy Close was accepted. Billable end clock. '
  'Settlement may proceed with this set even before verified_destroyed_at.';

comment on column public.gpu_sessions.started_at is
  'SCB billable start. P0-B: set ONCE by RUNTIME_READY_FOR_BILLING only '
  '(health PASS + Workspace/Comfy usable). NULL while pending (not billable).';

-- Drop legacy / partial constraints before backfill + new check.
alter table public.gpu_sessions
  drop constraint if exists gpu_sessions_closed_requires_verified_destroyed_at;

alter table public.gpu_sessions
  drop constraint if exists gpu_sessions_closed_destroy_or_billing_close;

-- Backfill legacy closed rows that have neither destroy verify nor billing close.
-- Prefer ended_at (billable end), then verified_destroyed_at, then created_at.
update public.gpu_sessions
set close_requested_at = coalesce(ended_at, verified_destroyed_at, created_at, now())
where status = 'closed'
  and close_requested_at is null
  and verified_destroyed_at is null;

-- Closed rows that already have destroy verify stay valid without close_requested_at.
-- Optionally stamp close_requested_at from ended_at for analytics (non-blocking).
update public.gpu_sessions
set close_requested_at = coalesce(ended_at, verified_destroyed_at)
where status = 'closed'
  and close_requested_at is null
  and verified_destroyed_at is not null
  and ended_at is not null;

alter table public.gpu_sessions
  add constraint gpu_sessions_closed_destroy_or_billing_close
  check (
    status != 'closed'
    or verified_destroyed_at is not null
    or close_requested_at is not null
  );
