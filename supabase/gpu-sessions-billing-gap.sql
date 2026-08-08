-- Auto-replace billing gaps: seconds between old GPU death and new Comfy ready.
-- Settlement billable = (ended_at − started_at) − billing_gap_seconds.
-- started_at stays immutable (SCB); live burn uses machines.billing_started_at.

ALTER TABLE public.gpu_sessions
  ADD COLUMN IF NOT EXISTS billing_gap_seconds integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.gpu_sessions.billing_gap_seconds IS
  'Accumulated non-billable seconds during runtime auto-replace gaps '
  '(old GPU dead → new GPU Comfy ready). Subtracted at settlement.';
