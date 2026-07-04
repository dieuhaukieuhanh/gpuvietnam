-- =================================================================
-- SUPERSEDED — SCB M2 (Database Rebuild, 2026-07-04)
-- ------------------------------------------------------------------
-- This file is superseded by the canonical SCB 3.0 schema:
--   * machines.billing_started_at, machines.billing_inventory_id,
--     machines.gpu_session_id are now declared in
--     supabase/machines.sql (with DEPRECATED markers where applicable).
--   * gpu_sessions.machine_id is now declared in
--     supabase/gpu-sessions.sql (canonical).
--   * The reverse FK machines.gpu_session_id -> gpu_sessions(id) is
--     added by supabase/gpu-sessions.sql (greenfield) or
--     supabase/scb-schema.sql (M2 migration).
--
-- Retained for audit history. DO NOT apply on SCB 3.0 databases — the
-- canonical schema files and supabase/scb-schema.sql cover everything.
-- =================================================================

-- Billing columns for GPU machines
ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS billing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_inventory_id bigint REFERENCES public.user_plan_inventory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gpu_session_id uuid REFERENCES public.gpu_sessions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.machines.billing_started_at IS
  'Legacy per-minute billing anchor — not SCB SoT. Retained until M5 removes tick billing.';
COMMENT ON COLUMN public.machines.gpu_session_id IS
  'Link to active gpu_sessions row for the current machine lifecycle.';

-- Link sessions to machines
ALTER TABLE public.gpu_sessions
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gpu_sessions_machine ON public.gpu_sessions(machine_id);
