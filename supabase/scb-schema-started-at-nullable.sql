-- =================================================================
-- SUPERSEDED — SCB M2 (Database Rebuild, 2026-07-04)
-- ------------------------------------------------------------------
-- This file is superseded by supabase/scb-schema.sql (M2 migration),
-- which folds its content (started_at nullable + running/closed
-- requires started_at CHECKs) into the canonical SCB 3.0 migration.
--
-- Retained for audit history. DO NOT apply on SCB 3.0 databases —
-- apply supabase/scb-schema.sql instead.
-- =================================================================

-- =================================================================
-- SCB BUG1 FIX — started_at NULLABLE migration
-- Architecture 2.0 (SCB) requires:
--   pending  -> started_at = NULL   (not yet billable)
--   running  -> started_at NOT NULL (SES-2 / SD-2)
--   closed   -> started_at NOT NULL (terminal from running, SD-3)
--   started_at is set ONLY at pending -> running transition (SD-5 immutable)
--
-- Legacy schema (gpu-sessions.sql L23) declared:
--   started_at timestamptz NOT NULL
-- This is a pre-SCB constraint that conflicts with the pending state:
-- every INSERT of a pending session (status='pending', no started_at)
-- fails with: null value in column "started_at" violates not-null constraint
-- -> openBillableSession cannot persist a billing anchor -> BUG1.
--
-- This migration:
--   1. DROP NOT NULL on gpu_sessions.started_at  (allows pending NULL)
--   2. ADD CHECK: status <> 'running' OR started_at IS NOT NULL  (SES-2 at DB)
--   3. ADD CHECK: status <> 'closed'  OR started_at IS NOT NULL  (SD-3 at DB)
-- No constraint forces pending -> started_at IS NULL: per SESSION_DOMAIN_DESIGN
--   L124 a pending row MAY carry a placeholder (M3B decision), so we do NOT
--   forbid a non-null placeholder at the DB layer.
-- Idempotent. No data backfill. No index/RLS/trigger changes. No app code changes.
-- =================================================================

-- ------------------------------------------------------------------
-- 1. DROP NOT NULL — gpu_sessions.started_at
--    ALTER ... DROP NOT NULL is idempotent: re-running on an already
--    nullable column is a no-op (no error).
-- ------------------------------------------------------------------
alter table public.gpu_sessions
  alter column started_at drop not null;

-- ------------------------------------------------------------------
-- 2. CHECK constraints — idempotent DO blocks
--    Postgres has no ADD CONSTRAINT IF NOT EXISTS; use the standard
--    BEGIN/EXCEPTION WHEN duplicate_object pattern (same as
--    scb-schema-apply-nodrop.sql §3).
-- ------------------------------------------------------------------

-- SES-2 / SD-2 enforced at DB layer (defense in depth; in-memory
-- enforcement already lives in session-lifecycle.js assertSessionIntegrity).
DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_running_requires_started_at
    CHECK (status <> 'running' OR started_at IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SD-3 enforced at DB layer: a closed session must have started_at
-- (closed is terminal-from-running; cannot close without having run).
DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_closed_requires_started_at
    CHECK (status <> 'closed' OR started_at IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------
-- 3. COMMENT ON COLUMN — update to reflect SCB semantics (idempotent)
-- ------------------------------------------------------------------
comment on column public.gpu_sessions.started_at is
  'Billable start timestamp (SCB). NULL when status=pending (not yet billable; may carry placeholder per SESSION_DOMAIN_DESIGN §pending). NOT NULL when status in (running, closing, closed) per SES-2/SD-2/SD-3. Set ONCE at pending->running transition (SD-5 immutable). DB enforcement: gpu_sessions_running_requires_started_at, gpu_sessions_closed_requires_started_at. In-memory enforcement: session-lifecycle.js assertSessionIntegrity.';

-- =================================================================
-- VERIFY (run manually after applying):
--   select column_name, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name   = 'gpu_sessions'
--     and column_name  = 'started_at';
--   -> is_nullable = 'YES'
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.gpu_sessions'::regclass
--     and conname in ('gpu_sessions_running_requires_started_at',
--                     'gpu_sessions_closed_requires_started_at');
-- =================================================================
