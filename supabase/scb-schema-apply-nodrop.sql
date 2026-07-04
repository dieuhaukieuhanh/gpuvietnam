-- =================================================================
-- SUPERSEDED — SCB M2 (Database Rebuild, 2026-07-04)
-- ------------------------------------------------------------------
-- This file is superseded by supabase/scb-schema.sql (M2 migration),
-- which is the single canonical SCB 3.0 migration and uses no-DROP
-- DO-block exception handling for constraints (so the separate
-- no-DROP variant is no longer needed).
--
-- Retained for audit history. DO NOT apply on SCB 3.0 databases —
-- apply supabase/scb-schema.sql instead.
-- =================================================================

-- =================================================================
-- SCB M1 Schema Migration — FILTERED EXECUTION (no DROP, idempotent)
-- Source: supabase/scb-schema.sql (official Architecture 2.0 M1 migration)
-- Filtered: all DROP COLUMN / DROP CONSTRAINT statements removed per
--           no-DROP constraint. Constraint adds use DO-block exception
--           handling (duplicate_object swallowed) to remain idempotent
--           without DROP.
-- Safe to re-run. No data modified. No DROP/TRUNCATE/UPDATE/DELETE/INSERT.
-- =================================================================

-- ------------------------------------------------------------------
-- 1. ADD COLUMN IF NOT EXISTS — gpu_sessions (6 SCB columns)
-- ------------------------------------------------------------------
alter table public.gpu_sessions
  add column if not exists settlement_status text,
  add column if not exists settlement_at timestamptz,
  add column if not exists settlement_breakdown jsonb,
  add column if not exists destroy_reason text,
  add column if not exists verified_running_at timestamptz,
  add column if not exists verified_destroyed_at timestamptz;

-- ------------------------------------------------------------------
-- 2. ADD COLUMN IF NOT EXISTS — machines.closing_started_at
-- ------------------------------------------------------------------
alter table public.machines
  add column if not exists closing_started_at timestamptz;

-- ------------------------------------------------------------------
-- 3. CHECK constraints — idempotent DO blocks (no DROP needed)
--    Postgres has no ADD CONSTRAINT IF NOT EXISTS, so we use the
--    standard BEGIN/EXCEPTION WHEN duplicate_object pattern.
-- ------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_status_check
    CHECK (status IN ('completed','pending','running','closing','closed','interrupted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_settlement_status_check
    CHECK (settlement_status IS NULL OR settlement_status IN
      ('not_applicable','awaiting_verify','pending','in_progress','settled','skipped','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_no_settled_while_running
    CHECK (NOT (status = 'running' AND settlement_status = 'settled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_running_no_settlement_commit
    CHECK (status != 'running' OR settlement_status IS NULL
           OR settlement_status IN ('not_applicable','awaiting_verify'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gpu_sessions ADD CONSTRAINT gpu_sessions_closed_requires_settlement_status
    CHECK (status != 'closed' OR settlement_status IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.machines ADD CONSTRAINT machines_status_check
    CHECK (status IN ('creating','starting','running','closing','destroyed','error')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------
-- 4. CREATE INDEX IF NOT EXISTS
-- ------------------------------------------------------------------
create index if not exists idx_gpu_sessions_user_running
  on public.gpu_sessions(user_id) where status = 'running';

create index if not exists idx_gpu_sessions_settlement_retry
  on public.gpu_sessions(settlement_status) where settlement_status in ('pending','failed');

-- ------------------------------------------------------------------
-- 5. COMMENT ON COLUMN — gpu_sessions (idempotent)
-- ------------------------------------------------------------------
comment on column public.gpu_sessions.status is
  'Session lifecycle (SCB): pending, running, closing, closed, interrupted. LEGACY STATUS "completed": pre-SCB terminal rows only. DO NOT CREATE NEW ROWS with completed — use "closed" instead (M3+).';
comment on column public.gpu_sessions.duration_seconds is
  'Legacy/derived display only — not SCB billing SoT. Billable duration = ended_at - started_at (derived). See SESSION_CENTRIC_BILLING_ARCHITECTURE.md §2.2, INV-9.';
comment on column public.gpu_sessions.settlement_status is
  'Settlement outcome (SCB). Required when status=closed. Values align OPERATIONAL_STATE_MACHINE §4 composite + §7 Settlement domain.';
comment on column public.gpu_sessions.settlement_at is
  'Timestamp when settlement completed successfully (M6+). Not written in M1.';
comment on column public.gpu_sessions.settlement_breakdown is
  'Settlement allocation audit (M6+). JSONB — not validated at DB layer. Official shape: {"gift": {"hours": number}, "combo": {"hours": number, "inventory_id": number|null}, "wallet": {"vnd": number, "hours_equivalent": number|null}, "bonus": {"hours": number|null}, "promotion": {"code": string|null, "hours": number|null}, "cap_applied_seconds": number|null}. All keys optional; populated only at settlement. SoT for amounts committed remains entitlement tables + wallet_transactions.';
comment on column public.gpu_sessions.destroy_reason is
  'Unified destroy pipeline reason metadata (e.g. user_stop, idle_timeout, out_of_credit).';
comment on column public.gpu_sessions.verified_running_at is
  'Timestamp when GPU Provider Adapter verified instance RUNNING (session billable gate).';
comment on column public.gpu_sessions.verified_destroyed_at is
  'Timestamp when GPU Provider Adapter verified instance DESTROYED (gate before settlement). Provider instance identity SoT: machines.instance_id via gpu_sessions.machine_id — not stored on session.';

-- ------------------------------------------------------------------
-- 6. COMMENT ON COLUMN — machines (idempotent)
-- ------------------------------------------------------------------
comment on column public.machines.instance_id is
  'GPU Provider instance identifier (Machine Domain SoT). Session resolves provider instance via machine_id -> machines.instance_id. Live existence: Provider Adapter verify (ADR-007).';
comment on column public.machines.status is
  'Machine lifecycle: creating, starting, running, closing, destroyed, error (OPERATIONAL_STATE_MACHINE §5).';
comment on column public.machines.closing_started_at is
  'When unified destroy pipeline entered closing state; KPI destroy verify latency (SCB M1).';
comment on column public.machines.billing_started_at is
  'Legacy per-minute billing anchor — not SCB SoT. Retained for current billing until M5+. See SESSION_CENTRIC_BILLING_ARCHITECTURE.md §2.2.';
