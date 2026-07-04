-- =================================================================
-- GPUVietnam — SCB M2 Schema Migration (Architecture 3.0)
-- Milestone: M2 — Database Rebuild
-- Style: ADDITIVE + BACKWARD COMPATIBLE (no DROP, no CHECK narrowing)
--
-- Purpose:
--   Bring an EXISTING database (created under pre-SCB or SCB 2.0 schema) up
--   to the SCB 3.0 foundation described in supabase/gpu-sessions.sql and
--   supabase/machines.sql (canonical), WITHOUT breaking the legacy runtime.
--
-- M2 scope (per approved M2 plan):
--   * add columns / FKs / indexes
--   * add SCB 3.0 invariant CHECKs as additive (NOT VALID where existing rows
--     might violate; future writes are still checked)
--   * merge the canonical schema (fold machine_id, fold
--     scb-schema-started-at-nullable.sql which is now Superseded)
--   * update comments to SCB 3.0 and mark deprecated projection columns
--   * change status DEFAULT from legacy 'completed' to 'pending'
--   * keep status CHECK WIDE — narrowing to ('pending','running','closed') is
--     deferred to M3 after the Session/Billing rewrite
--   * NO DROP of billing_started_at / closing_started_at / duration_seconds
--
-- Idempotent: safe to re-run. Uses DO-block exception handling for
--   ADD CONSTRAINT (Postgres has no ADD CONSTRAINT IF NOT EXISTS) and
--   IF NOT EXISTS for columns / indexes.
--
-- Apply order (existing DB):
--   prerequisite: schema.sql, subscriptions.sql, user-plan-inventory.sql,
--                 hour-grants.sql, machines.sql, gpu-sessions.sql already
--                 applied (gpu-sessions.sql may have been applied via the
--                 legacy file that lacked machine_id — this migration adds it).
--   then: run this file.
--
-- Supersedes:
--   - supabase/scb-schema-started-at-nullable.sql (folded into section 2 + 3)
--   - supabase/machines-billing.sql (its additive columns are folded into
--     canonical machines.sql / gpu-sessions.sql and section 1 of this file)
-- =================================================================

-- ------------------------------------------------------------------
-- 0. PRE-CHECK — duplicate running sessions per user (DEC-011)
--    The partial unique index in section 4 will FAIL to create if any user
--    has more than one row with status='running'. Run this query first and
--    resolve duplicates manually (keep the latest, close the rest) BEFORE
--    re-running this migration if the index creation below errors out.
-- ------------------------------------------------------------------
-- Diagnostic (non-mutating):
--   SELECT user_id, count(*) AS running_count
--   FROM public.gpu_sessions
--   WHERE status = 'running'
--   GROUP BY user_id
--   HAVING count(*) > 1;


-- ------------------------------------------------------------------
-- 1. ADD COLUMN IF NOT EXISTS — gpu_sessions.machine_id (fold from
--    machines-billing.sql, now Superseded)
-- ------------------------------------------------------------------
ALTER TABLE public.gpu_sessions
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gpu_sessions_machine ON public.gpu_sessions(machine_id);


-- ------------------------------------------------------------------
-- 2. started_at NULLABLE (fold from scb-schema-started-at-nullable.sql)
--    ALTER ... DROP NOT NULL is idempotent.
-- ------------------------------------------------------------------
ALTER TABLE public.gpu_sessions
  ALTER COLUMN started_at DROP NOT NULL;

-- status DEFAULT -> 'pending' (SCB 3.0: new sessions start pending, not
-- legacy 'completed'). Does not affect existing rows.
ALTER TABLE public.gpu_sessions
  ALTER COLUMN status SET DEFAULT 'pending';


-- ------------------------------------------------------------------
-- 3. ADD SCB 3.0 CHECK constraints (additive, NOT VALID where existing
--    rows might violate). NOT VALID skips existing rows but still checks
--    all future INSERT / UPDATE writes. Current runtime (session-start.js,
--    session-lifecycle.js, destroy-pipeline-run.js) already satisfies every
--    constraint on writes — verified during M2.
--
--    Constraints that already exist (from prior M1 / started-at-nullable
--    migration) are kept; the DO blocks below are idempotent.
-- ------------------------------------------------------------------

-- Folded from scb-schema-started-at-nullable.sql:
DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_running_requires_started_at
    CHECK (status <> 'running' OR started_at IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_closed_requires_started_at
    CHECK (status <> 'closed' OR started_at IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- New SCB 3.0 invariants (M2):
DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_pending_has_no_started_at
    CHECK (status <> 'pending' OR started_at IS NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_running_requires_machine_id
    CHECK (status <> 'running' OR machine_id IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_running_requires_verified_running_at
    CHECK (status <> 'running' OR verified_running_at IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_closed_requires_ended_at
    CHECK (status <> 'closed' OR ended_at IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_closed_requires_verified_destroyed_at
    CHECK (status <> 'closed' OR verified_destroyed_at IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ------------------------------------------------------------------
-- 4. DEC-011 — at most one running session per user (partial unique index)
--    Will fail if duplicate running rows exist for a user; see section 0.
-- ------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS gpu_sessions_one_running_per_user
  ON public.gpu_sessions(user_id)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_gpu_sessions_user_running
  ON public.gpu_sessions(user_id) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_gpu_sessions_settlement_retry
  ON public.gpu_sessions(settlement_status) WHERE settlement_status in ('pending','failed');


-- ------------------------------------------------------------------
-- 5. REVERSE PROJECTION FK — machines.gpu_session_id -> gpu_sessions(id)
--    Added NOT VALID so existing rows that point at non-existent sessions
--    do not block the migration; future writes are still checked. Validate
--    manually once data is clean:
--      ALTER TABLE public.machines VALIDATE CONSTRAINT machines_gpu_session_fk;
-- ------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.machines'::regclass
      AND conname = 'machines_gpu_session_fk'
  ) THEN
    ALTER TABLE public.machines
      ADD CONSTRAINT machines_gpu_session_fk
      FOREIGN KEY (gpu_session_id) REFERENCES public.gpu_sessions(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- Ensure the projection lookup index exists on machines.
CREATE INDEX IF NOT EXISTS machines_gpu_session_id_idx ON public.machines(gpu_session_id);


-- ------------------------------------------------------------------
-- 6. machines.billing_inventory_id FK (ensure present on legacy DBs where
--    it was added by machines-billing.sql). Idempotent guard.
-- ------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.machines'::regclass
      AND conname = 'machines_billing_inventory_id_fkey'
  ) THEN
    ALTER TABLE public.machines
      ADD CONSTRAINT machines_billing_inventory_id_fkey
      FOREIGN KEY (billing_inventory_id) REFERENCES public.user_plan_inventory(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;


-- ------------------------------------------------------------------
-- 7. COMMENT ON COLUMN — SCB 3.0 semantics + DEPRECATED markers
--    (idempotent)
-- ------------------------------------------------------------------
COMMENT ON TABLE public.gpu_sessions IS
  'SCB 3.0 Single Source of Truth for GPU session billing. Billing reads ONLY this table. '
  'Machine (public.machines) is a disposable projection.';

COMMENT ON COLUMN public.gpu_sessions.status IS
  'SCB 3.0 session lifecycle target: pending -> running -> closed. '
  'Legacy values closing/interrupted/completed are retained in the CHECK during M2 for '
  'backward compatibility; they will be removed from the CHECK in M3 after the Session/Billing rewrite. '
  'New code MUST write only pending / running / closed.';

COMMENT ON COLUMN public.gpu_sessions.started_at IS
  'SCB 3.0 billable start timestamp. NULL when status=pending (not yet billable). '
  'NOT NULL when status in (running, closed). Set ONCE at pending -> running (immutable). '
  'DB enforcement: gpu_sessions_running_requires_started_at, gpu_sessions_closed_requires_started_at, '
  'gpu_sessions_pending_has_no_started_at.';

COMMENT ON COLUMN public.gpu_sessions.ended_at IS
  'SCB 3.0 billable end timestamp. NOT NULL when status=closed. '
  'Billable duration = ended_at - started_at (derived). '
  'DB enforcement: gpu_sessions_closed_requires_ended_at.';

COMMENT ON COLUMN public.gpu_sessions.machine_id IS
  'SCB 3.0 relational link to the machine provisioning this session. '
  'NOT NULL when status=running (gpu_sessions_running_requires_machine_id). '
  'Nullable for pending (machine still provisioning) and after machine deletion (ON DELETE SET NULL). '
  'This is the relational SoT; machines.gpu_session_id is the reverse projection link.';

COMMENT ON COLUMN public.gpu_sessions.verified_running_at IS
  'SCB 3.0: timestamp when Provider Adapter verified instance RUNNING. '
  'NOT NULL when status=running (gpu_sessions_running_requires_verified_running_at). '
  'Billing MUST NOT start before this is set (DEC-004: Verify before Billing).';

COMMENT ON COLUMN public.gpu_sessions.verified_destroyed_at IS
  'SCB 3.0: timestamp when Provider Adapter verified instance DESTROYED. '
  'NOT NULL when status=closed (gpu_sessions_closed_requires_verified_destroyed_at). '
  'Settlement MUST NOT run before this is set (DEC-015: Verify before Settlement).';

COMMENT ON COLUMN public.gpu_sessions.settlement_status IS
  'SCB 3.0 settlement outcome. NOT NULL when status=closed. '
  'Values: not_applicable, awaiting_verify, pending, in_progress, settled, skipped, failed.';

COMMENT ON COLUMN public.gpu_sessions.settlement_at IS
  'Timestamp when settlement completed successfully. Populated from M6 (Billing Domain).';

COMMENT ON COLUMN public.gpu_sessions.settlement_breakdown IS
  'Settlement allocation audit (JSONB, not validated at DB layer). '
  'Official shape: {"gift": {"hours": number}, "combo": {"hours": number, "inventory_id": number|null}, '
  '"wallet": {"vnd": number, "hours_equivalent": number|null}, "bonus": {"hours": number|null}, '
  '"promotion": {"code": string|null, "hours": number|null}, "cap_applied_seconds": number|null}. '
  'All keys optional; populated only at settlement. SoT for amounts committed remains '
  'entitlement tables + wallet_transactions.';

COMMENT ON COLUMN public.gpu_sessions.destroy_reason IS
  'Unified destroy pipeline reason metadata (e.g. user_stop, idle_timeout, out_of_credit).';

COMMENT ON COLUMN public.gpu_sessions.duration_seconds IS
  'DEPRECATED (M2). Legacy per-minute billing artifact. Not SCB SoT. '
  'Billable duration = ended_at - started_at (derived). '
  'Retained for backward compatibility with current readers (gpu-sessions.js mapSessionRow); '
  'will be dropped in M11 after view-model rewrite. New code MUST NOT read or write this column.';

COMMENT ON TABLE public.machines IS
  'SCB 3.0 projection of GPU instances per user. NOT a source of truth. '
  'Billing reads ONLY public.gpu_sessions. This table is disposable and rebuildable.';

COMMENT ON COLUMN public.machines.instance_id IS
  'GPU Provider instance identifier (Machine Domain SoT). '
  'Session resolves provider instance via gpu_sessions.machine_id -> machines.instance_id. '
  'Live existence is confirmed by Provider Adapter verify (DEC-008).';

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


-- =================================================================
-- VERIFY (run manually after applying):
--
--   -- status DEFAULT is 'pending':
--   SELECT column_name, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='gpu_sessions' AND column_name='status';
--
--   -- started_at is nullable:
--   SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='gpu_sessions' AND column_name='started_at';
--
--   -- machine_id column + index:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='gpu_sessions' AND column_name='machine_id';
--
--   -- SCB 3.0 constraints present (NOT VALID):
--   SELECT conname, pg_get_constraintdef(oid), convalidated
--   FROM pg_constraint
--   WHERE conrelid = 'public.gpu_sessions'::regclass
--     AND conname IN (
--       'gpu_sessions_pending_has_no_started_at',
--       'gpu_sessions_running_requires_machine_id',
--       'gpu_sessions_running_requires_verified_running_at',
--       'gpu_sessions_closed_requires_ended_at',
--       'gpu_sessions_closed_requires_verified_destroyed_at',
--       'gpu_sessions_running_requires_started_at',
--       'gpu_sessions_closed_requires_started_at'
--     );
--
--   -- partial unique index present:
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='gpu_sessions'
--     AND indexname = 'gpu_sessions_one_running_per_user';
--
--   -- reverse FK present (NOT VALID):
--   SELECT conname, convalidated FROM pg_constraint
--   WHERE conrelid = 'public.machines'::regclass
--     AND conname = 'machines_gpu_session_fk';
--
-- NOTE on validating NOT VALID constraints:
--   After M3 (Session/Billing rewrite) and M6 (Destroy Pipeline rewrite)
--   complete and the legacy status values are migrated, run:
--     ALTER TABLE public.gpu_sessions VALIDATE CONSTRAINT gpu_sessions_pending_has_no_started_at;
--     ALTER TABLE public.gpu_sessions VALIDATE CONSTRAINT gpu_sessions_running_requires_machine_id;
--     ALTER TABLE public.gpu_sessions VALIDATE CONSTRAINT gpu_sessions_running_requires_verified_running_at;
--     ALTER TABLE public.gpu_sessions VALIDATE CONSTRAINT gpu_sessions_closed_requires_ended_at;
--     ALTER TABLE public.gpu_sessions VALIDATE CONSTRAINT gpu_sessions_closed_requires_verified_destroyed_at;
--     ALTER TABLE public.machines VALIDATE CONSTRAINT machines_gpu_session_fk;
--     ALTER TABLE public.machines VALIDATE CONSTRAINT machines_billing_inventory_id_fkey;
-- =================================================================
