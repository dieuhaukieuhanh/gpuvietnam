-- =================================================================
-- GPUVietnam — SC Schema Version Marker + 3.4B Readiness (RC1)
-- ------------------------------------------------------------------
-- Version marker: production can query `public.schema_version` to
-- determine which SCB schema generation the database has converged to,
-- and `public.sc_schema_verification` to see — per requirement —
-- whether the SCB 3.4B settlement prerequisites are present.
--
-- This file changes NO business logic, settlement behaviour, lifecycle
-- behaviour, or transaction semantics. It only records version state
-- and exposes a read-only verification view over the data dictionary.
--
-- Idempotent: safe to re-run. Apply LAST (after settle-session-
-- transaction.sql). The runner applies it automatically as the final
-- migration in the canonical order (id 0099).
-- =================================================================

-- ------------------------------------------------------------------
-- 1. public.schema_version  (single-row version marker)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schema_version (
  id              integer   PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version         text      NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  scb_3_4b_ready  boolean   NOT NULL DEFAULT false,
  notes           text
);

ALTER TABLE public.schema_version ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages schema_version" ON public.schema_version;
CREATE POLICY "Service role manages schema_version"
  ON public.schema_version FOR ALL
  TO service_role, postgres
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone reads schema_version" ON public.schema_version;
CREATE POLICY "Anyone reads schema_version"
  ON public.schema_version FOR SELECT
  USING (true);

COMMENT ON TABLE public.schema_version IS
  'RC1 version marker. Single row (id=1). `version` is the SCB schema '
  'generation label; `scb_3_4b_ready` is recomputed from '
  'sc_schema_verification each time this migration is (re)applied. '
  'Read-only operational state — not business truth.';

-- ------------------------------------------------------------------
-- 2. public.sc_schema_verification  (per-requirement readiness view)
--    One row per SCB 3.4B settlement prerequisite. `present` is
--    computed live from the Postgres catalog, so the view always
--    reflects the actual database state (never goes stale).
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW public.sc_schema_verification AS
SELECT 'SCB-3.4B'::text                AS category,
       'settlement RPC function'::text AS requirement,
       'public.settle_session_transaction(json)'::text AS object_name,
       EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'settle_session_transaction'
       ) AS present
UNION ALL SELECT 'SCB-3.4B', 'wallet ledger idempotency column',
       'public.wallet_transactions.idempotency_key',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'wallet_transactions'
           AND column_name = 'idempotency_key'
       )
UNION ALL SELECT 'SCB-3.4B', 'wallet ledger idempotency unique index',
       'public.wallet_transactions_idempotency_key_uniq',
       EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'wallet_transactions'
           AND indexname = 'wallet_transactions_idempotency_key_uniq'
       )
UNION ALL SELECT 'SCB-3.4B', 'settlement claim guard column',
       'public.gpu_sessions.settlement_status',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'gpu_sessions'
           AND column_name = 'settlement_status'
       )
UNION ALL SELECT 'SCB-3.4B', 'settlement status CHECK constraint',
       'public.gpu_sessions_settlement_status_check',
       EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.gpu_sessions'::regclass
           AND conname = 'gpu_sessions_settlement_status_check'
       )
UNION ALL SELECT 'SCB-3.4B', 'wallet balance column (W3 debit target)',
       'public.users.wallet_balance',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name = 'wallet_balance'
       )
UNION ALL SELECT 'SCB-3.4B', 'wallet ledger table (W4 insert target)',
       'public.wallet_transactions',
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'wallet_transactions'
       )
UNION ALL SELECT 'SCB-3.4B', 'entitlement CAS target — grants',
       'public.manual_hour_grants',
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'manual_hour_grants'
       )
UNION ALL SELECT 'SCB-3.4B', 'entitlement CAS target — subscriptions',
       'public.subscriptions',
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'subscriptions'
       )
UNION ALL SELECT 'SCB-3.4B', 'projection sync target (W6)',
       'public.user_plan_inventory',
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'user_plan_inventory'
       )
UNION ALL SELECT 'SCB-3.4B', 'session SoT table (W2/W7)',
       'public.gpu_sessions',
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'gpu_sessions'
       );

COMMENT ON VIEW public.sc_schema_verification IS
  'RC1 — per-requirement SCB 3.4B settlement readiness. Computed live '
  'from the Postgres catalog. `SELECT category, bool_and(present) AS '
  'ready FROM sc_schema_verification GROUP BY category` gives the '
  'aggregate gate. See supabase/verify-sc-schema.sql for the full '
  'production checklist.';

-- ------------------------------------------------------------------
-- 3. Upsert the version marker row. `scb_3_4b_ready` is recomputed
--    from the verification view so the marker never lies — if a
--    prerequisite is missing, the flag is false even though this
--    migration ran.
-- ------------------------------------------------------------------
DO $$
DECLARE
  ready boolean;
BEGIN
  SELECT COALESCE(bool_and(present), false) INTO ready
  FROM public.sc_schema_verification
  WHERE category = 'SCB-3.4B';

  INSERT INTO public.schema_version (id, version, applied_at, scb_3_4b_ready, notes)
  VALUES (1, 'SCB-3.4B-RC1', now(), ready,
          'Migration system RC1. SCB 3.4B settlement transaction RPC + idempotency.')
  ON CONFLICT (id) DO UPDATE
    SET version        = EXCLUDED.version,
        applied_at     = now(),
        scb_3_4b_ready = ready,
        notes          = EXCLUDED.notes;
END $$;
