-- Idle auto-stop tracking for running GPU machines
ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS idle_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idle_warning_sent BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.machines.idle_started_at IS 'When ComfyUI queue last became empty (idle counting starts)';
COMMENT ON COLUMN public.machines.idle_warning_sent IS 'Whether 55-minute idle warning notification was sent';
