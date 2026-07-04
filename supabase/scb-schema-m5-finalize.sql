-- =================================================================
-- GPUVietnam — SCB M5 Schema Finalization (Architecture 3.0)
-- Milestone: M5 — SQL Finalization (WRITE SQL ONLY)
-- Style: IDEMPOTENT + NON-DESTRUCTIVE (no DROP of data / rows / columns)
--
-- Prerequisites:
--   * supabase/scb-schema.sql (M2 migration) has been applied, AND
--   * M3 (Session Domain Rewrite), M4 (Billing Domain Rewrite),
--     M6/M7/M10/M11 (downstream rewrites) are complete in src/**, AND
--   * Final SCB 3.0 runtime audit returned PASS — i.e. every runtime
--     write to gpu_sessions.status produces only pending / running / closed.
--
-- M5 scope (per approved M5 plan):
--   1. PRE-CHECK: detect any legacy gpu_sessions.status rows
--      (closing / interrupted / completed). Abort if present so the operator
--      cleans them BEFORE the CHECK is narrowed / constraints are VALIDATEd.
--   2. NARROW gpu_sessions.status CHECK to ('pending','running','closed').
--      The legacy wide inline CHECK (auto-named gpu_sessions_status_check)
--      is replaced by a narrow, VALID CHECK.
--   3. VALIDATE every M2 NOT VALID constraint (gpu_sessions + machines).
--   4. Re-assert SCB 3.0 comments.
--
-- Non-goals (explicitly out of M5 scope):
--   * machines.status CHECK is KEPT WIDE (includes 'closing') — narrowing is
--     deferred to a later machine-projection milestone. M5 only narrows
--     gpu_sessions.status (the Single Source of Truth).
--   * No DROP of billing_started_at / closing_started_at / duration_seconds.
--   * No DROP of data rows.
--
-- Idempotent: safe to re-run. The narrow CHECK is only (re)added when missing
--   or still wide; VALIDATE is only issued for constraints that exist and are
--   still NOT VALID. Re-running after success is a no-op.
--
-- Supersedes the "NOTE on validating NOT VALID constraints" block at the end
--   of supabase/scb-schema.sql (M2) — that manual step is now automated here.
-- =================================================================

-- ------------------------------------------------------------------
-- 0. PRE-CHECK — legacy gpu_sessions.status rows
--    The narrow CHECK and the VALIDATE steps below require that NO row
--    carries a legacy status (closing / interrupted / completed). If any such
--    row exists, abort with a summary so the operator can migrate them
--    (e.g. completed -> closed, interrupted -> closed, closing -> running
--    or closed) and re-run M5.
--
--    This is a READ-ONLY detection guard; it does NOT mutate or DROP data.
-- ------------------------------------------------------------------
DO $$
DECLARE
  legacy_count bigint;
  legacy_summary text;
BEGIN
  SELECT count(*) INTO legacy_count
  FROM public.gpu_sessions
  WHERE status IN ('closing', 'interrupted', 'completed');

  IF legacy_count > 0 THEN
    SELECT COALESCE(string_agg(status || ':' || cnt::text, ', '), '')
    INTO legacy_summary
    FROM (
      SELECT status, count(*) AS cnt
      FROM public.gpu_sessions
      WHERE status IN ('closing', 'interrupted', 'completed')
      GROUP BY status
    ) s;

    RAISE EXCEPTION
      'M5 BLOCKED: % legacy gpu_sessions.status row(s) found [%]. '
      'Migrate them before re-running M5: '
      'completed -> closed, interrupted -> closed, closing -> running|closed. '
      'No rows were modified or dropped.',
      legacy_count, legacy_summary;
  END IF;
END $$;


-- ------------------------------------------------------------------
-- 1. NARROW gpu_sessions.status CHECK -> ('pending','running','closed')
--    The legacy wide CHECK (auto-named gpu_sessions_status_check) is replaced
--    by a narrow VALID CHECK. Idempotent: only drops+re-adds when the existing
--    constraint is missing or still contains a legacy value; if the narrow
--    CHECK is already in place this block is a no-op.
-- ------------------------------------------------------------------
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conrelid = 'public.gpu_sessions'::regclass
    AND conname = 'gpu_sessions_status_check';

  -- Add when missing, or replace when the existing def still references any
  -- legacy status value (closing / interrupted / completed).
  IF def IS NULL
     OR def ILIKE '%''completed''%'
     OR def ILIKE '%''interrupted''%'
     OR def ILIKE '%''closing''%' THEN

    IF def IS NOT NULL THEN
      ALTER TABLE public.gpu_sessions DROP CONSTRAINT gpu_sessions_status_check;
    END IF;

    ALTER TABLE public.gpu_sessions
      ADD CONSTRAINT gpu_sessions_status_check
      CHECK (status IN ('pending', 'running', 'closed'));
  END IF;
END $$;


-- ------------------------------------------------------------------
-- 2. VALIDATE all M2 NOT VALID constraints
--    Only constraints that exist AND are still NOT VALID are validated —
--    re-running is a no-op. VALIDATE fails (and aborts the migration) if any
--    existing row violates the invariant; the operator fixes the data and
--    re-runs.
--
--    2a. gpu_sessions SCB 3.0 invariant CHECKs (7)
-- ------------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.gpu_sessions'::regclass
      AND convalidated = false
      AND conname IN (
        'gpu_sessions_running_requires_started_at',
        'gpu_sessions_closed_requires_started_at',
        'gpu_sessions_pending_has_no_started_at',
        'gpu_sessions_running_requires_machine_id',
        'gpu_sessions_running_requires_verified_running_at',
        'gpu_sessions_closed_requires_ended_at',
        'gpu_sessions_closed_requires_verified_destroyed_at'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.gpu_sessions VALIDATE CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- 2b. machines reverse-projection FK + billing_inventory_id FK (2)
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.machines'::regclass
      AND convalidated = false
      AND conname IN (
        'machines_gpu_session_fk',
        'machines_billing_inventory_id_fkey'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.machines VALIDATE CONSTRAINT %I', c.conname);
  END LOOP;
END $$;


-- ------------------------------------------------------------------
-- 3. COMMENT re-assert — gpu_sessions.status is now narrowed (M5)
--    (idempotent)
-- ------------------------------------------------------------------
COMMENT ON COLUMN public.gpu_sessions.status IS
  'SCB 3.0 session lifecycle: pending -> running -> closed (enforced by '
  'gpu_sessions_status_check since M5). Legacy values closing / interrupted / '
  'completed are NO LONGER accepted by the CHECK. Runtime (session-lifecycle.js, '
  'session-start.js, destroy-pipeline-run.js, reconciliation.js, billing.js) '
  'writes only pending / running / closed — verified by the M5 final runtime audit.';


-- =================================================================
-- VERIFY (run manually after applying):
--
--   -- status CHECK is narrow and VALID:
--   SELECT conname, pg_get_constraintdef(oid), convalidated
--   FROM pg_constraint
--   WHERE conrelid = 'public.gpu_sessions'::regclass
--     AND conname = 'gpu_sessions_status_check';
--   -- expected: CHECK (status IN ('pending','running','closed')) , convalidated = true
--
--   -- no legacy status rows remain:
--   SELECT status, count(*) FROM public.gpu_sessions
--   WHERE status IN ('closing','interrupted','completed')
--   GROUP BY status;
--   -- expected: 0 rows
--
--   -- all M2 constraints are now VALID:
--   SELECT conrelid::regclass::text AS tbl, conname, convalidated
--   FROM pg_constraint
--   WHERE convalidated = false
--     AND conname IN (
--       'gpu_sessions_running_requires_started_at',
--       'gpu_sessions_closed_requires_started_at',
--       'gpu_sessions_pending_has_no_started_at',
--       'gpu_sessions_running_requires_machine_id',
--       'gpu_sessions_running_requires_verified_running_at',
--       'gpu_sessions_closed_requires_ended_at',
--       'gpu_sessions_closed_requires_verified_destroyed_at',
--       'machines_gpu_session_fk',
--       'machines_billing_inventory_id_fkey'
--     );
--   -- expected: 0 rows (all validated)
-- =================================================================
