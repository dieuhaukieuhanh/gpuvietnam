-- Fix legacy drift: machines.gpu_session_id stored as bigint cannot reference gpu_sessions(id uuid).
-- Run once on databases that show: invalid input syntax for type bigint: "<uuid>"
--
-- Safe when column is already uuid (Postgres will no-op the type change path if compatible).

ALTER TABLE public.machines
  DROP CONSTRAINT IF EXISTS machines_gpu_session_id_fkey;

ALTER TABLE public.machines
  ALTER COLUMN gpu_session_id DROP DEFAULT;

ALTER TABLE public.machines
  ALTER COLUMN gpu_session_id TYPE uuid USING NULL;

ALTER TABLE public.machines
  ADD CONSTRAINT machines_gpu_session_id_fkey
  FOREIGN KEY (gpu_session_id) REFERENCES public.gpu_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS machines_gpu_session_id_idx ON public.machines(gpu_session_id);

COMMENT ON COLUMN public.machines.gpu_session_id IS
  'Reverse projection link to the active gpu_sessions row (uuid). '
  'SoT is gpu_sessions.machine_id; this column may drift and is rebuildable.';
