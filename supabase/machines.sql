-- GPUVietnam — machines (Session-Centric Billing 3.0)
-- Projection table. NOT a source of truth. Billing MUST NOT read this table.
--
-- Milestone: M2 — Database Rebuild (additive, backward compatible)
-- Architecture: SCB 3.0 (docs/scb/SCB-ARCHITECTURE.md)
--
-- SCB 3.0 principle: Machine is a disposable projection of the GPU session
-- state. The Single Source of Truth is public.gpu_sessions. Columns such as
-- billing_started_at, gpu_session_id and status on this table are projection
-- fields only — they can be rebuilt from gpu_sessions.
--
-- M2 policy (per M2 plan, "additive + backward compatible"):
--   * status CHECK is KEPT WIDE (includes 'closing') so legacy runtime that
--     still writes 'closing' does not break. Narrowing to
--     ('creating','starting','running','destroyed','error') is deferred to M6
--     after the Destroy Pipeline rewrite completes.
--   * billing_started_at and closing_started_at are NOT dropped in M2. They
--     are marked DEPRECATED and retained until M3 (billing_started_at) and
--     M6 (closing_started_at) remove their readers.
--   * gpu_session_id is retained as the reverse projection link; its FK to
--     gpu_sessions(id) is added in gpu-sessions.sql (greenfield) or
--     scb-schema.sql (existing DB) once gpu_sessions exists.
--
-- Apply order (greenfield):
--   1. schema.sql (auth)
--   2. subscriptions.sql, user-plan-inventory.sql, hour-grants.sql, ...
--   3. this file
--   4. gpu-sessions.sql   (Truth table — adds reverse FK to this table)
--   5. machines-idle.sql, infrastructure-reconciliation.sql

CREATE TABLE IF NOT EXISTS public.machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  instance_id text NOT NULL,
  provider text NOT NULL DEFAULT 'vast',
  ip_address text,
  port integer,
  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'starting', 'running', 'closing', 'destroyed', 'error')),
  closing_started_at timestamptz,
  gpu_type text NOT NULL,
  gpu_line text,
  region text,
  template text,
  image text,
  error_message text,
  started_at timestamptz DEFAULT now(),
  stopped_at timestamptz,
  billing_started_at timestamptz,
  billing_inventory_id bigint REFERENCES public.user_plan_inventory(id) ON DELETE SET NULL,
  gpu_session_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS machines_user_id_status_idx ON public.machines(user_id, status);
CREATE INDEX IF NOT EXISTS machines_instance_id_idx ON public.machines(instance_id);
-- Projection lookup: machine -> its active session. The relational SoT is the
-- reverse FK gpu_sessions.machine_id; this column is a denormalized projection
-- for fast UI/admin queries and MUST NOT be used to compute billing.
CREATE INDEX IF NOT EXISTS machines_gpu_session_id_idx ON public.machines(gpu_session_id);

COMMENT ON TABLE public.machines IS
  'SCB 3.0 projection of GPU instances per user. NOT a source of truth. '
  'Billing reads ONLY public.gpu_sessions. This table is disposable and rebuildable.';
COMMENT ON COLUMN public.machines.instance_id IS
  'GPU Provider instance identifier (Machine Domain SoT). '
  'Session resolves provider instance via gpu_sessions.machine_id -> machines.instance_id. '
  'Live existence is confirmed by Provider Adapter verify (DEC-008).';
COMMENT ON COLUMN public.machines.port IS
  'External HostPort only. NULL = Pending. Must not store internal container port 8080. '
  'Canonical writer: syncMachineFromLiveStatus when provider resolves v1 HostPort.';
COMMENT ON COLUMN public.machines.status IS
  'Machine projection lifecycle: creating, starting, running, destroyed, error. '
  'Legacy value closing is retained in the CHECK during M2 for backward compatibility; '
  'it will be removed in M6 after the Destroy Pipeline rewrite. '
  'This is a PROJECTION status; the authoritative session status lives on gpu_sessions.status.';
COMMENT ON COLUMN public.machines.closing_started_at IS
  'DEPRECATED (M2). Legacy closing-state timestamp. No equivalent in SCB 3.0 (no closing state). '
  'Retained until M6 (Destroy Pipeline rewrite) removes its readers. New code MUST NOT read or write this column.';
COMMENT ON COLUMN public.machines.billing_started_at IS
  'DEPRECATED (M2). Legacy per-minute billing anchor. NOT SCB SoT. '
  'Billing SoT is gpu_sessions.started_at. '
  'Retained until M3 (Billing Domain rewrite) removes its readers. New code MUST NOT read or write this column.';
COMMENT ON COLUMN public.machines.billing_inventory_id IS
  'Projection of the entitlement inventory row currently being consumed by the machine. '
  'Authoritative entitlement linkage lives on the session settlement path (gpu_sessions). '
  'Reusable for fast lookup but MUST NOT be used to compute billing.';
COMMENT ON COLUMN public.machines.gpu_session_id IS
  'Reverse projection link to the active gpu_sessions row. '
  'SoT is the forward FK gpu_sessions.machine_id. '
  'Nullable / may drift; recovery reconciles from gpu_sessions. '
  'Billing MUST NOT resolve sessions through this column; query gpu_sessions.machine_id instead.';
COMMENT ON COLUMN public.machines.image IS
  'ADMIN AUDIT ONLY — ComfyUI Docker image at provision (e.g. …:v3|:v4). '
  'Never expose on customer-facing APIs. Projection for dual-image supply audit; not billing.';
