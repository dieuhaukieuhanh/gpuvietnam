-- =================================================================
-- GPUVietnam — Production SCB Schema Verification Checklist (RC1)
-- ------------------------------------------------------------------
-- Read-only. Run in the Supabase SQL Editor (or via the runner's
-- `npm run db:verify` wrapper) against the target database.
-- Changes nothing. Reports whether the SCB 3.4B settlement
-- prerequisites are present and which migrations are recorded as
-- applied.
--
-- This is the human-facing checklist; the live view backing it is
-- public.sc_schema_verification (defined in 0099_sc_schema_version.sql).
-- =================================================================

-- ------------------------------------------------------------------
-- A. SCB 3.4B settlement prerequisites — per-requirement gate.
--    Every row must show present = true.
-- ------------------------------------------------------------------
SELECT
  category,
  requirement,
  object_name,
  present
FROM public.sc_schema_verification
ORDER BY category, requirement;

-- ------------------------------------------------------------------
-- B. Aggregate readiness — the single go/no-go gate.
--    Expected: scb_3_4b_ready = true
-- ------------------------------------------------------------------
SELECT
  version,
  applied_at,
  scb_3_4b_ready,
  notes
FROM public.schema_version
WHERE id = 1;

-- ------------------------------------------------------------------
-- C. Settlement RPC signature + ownership (SECURITY DEFINER).
--    Expected: one row, kind = 'function', security_definer = true.
-- ------------------------------------------------------------------
SELECT
  p.proname                                       AS function_name,
  pg_get_function_identity_arguments(p.oid)       AS args,
  pg_get_userbyid(p.proowner)                     AS owner,
  p.prosecdef                                     AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'settle_session_transaction';

-- ------------------------------------------------------------------
-- D. Wallet ledger idempotency — column + partial unique index.
--    Expected: idempotency_key present; index predicate
--    "WHERE (idempotency_key IS NOT NULL)".
-- ------------------------------------------------------------------
SELECT
  i.indexname,
  i.indexdef
FROM pg_indexes i
WHERE i.schemaname = 'public'
  AND i.tablename = 'wallet_transactions'
  AND i.indexname = 'wallet_transactions_idempotency_key_uniq';

-- ------------------------------------------------------------------
-- E. Session lifecycle constraints (SCB 3.0, finalized at M5).
--    Expected: gpu_sessions_status_check def = CHECK (status IN
--    ('pending','running','closed')), convalidated = true.
-- ------------------------------------------------------------------
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition,
  convalidated
FROM pg_constraint
WHERE conrelid = 'public.gpu_sessions'::regclass
  AND conname IN (
    'gpu_sessions_status_check',
    'gpu_sessions_settlement_status_check',
    'gpu_sessions_running_requires_started_at',
    'gpu_sessions_closed_requires_ended_at',
    'gpu_sessions_closed_requires_verified_destroyed_at'
  )
ORDER BY conname;

-- ------------------------------------------------------------------
-- F. Applied migration ledger.
--    Compare against supabase/MIGRATION_MANIFEST.json — every
--    migration id should appear here exactly once.
-- ------------------------------------------------------------------
SELECT id, file, category, applied_at
FROM public.schema_migrations
ORDER BY id;
