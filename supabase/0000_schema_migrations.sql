-- =================================================================
-- GPUVietnam — SQL Migration System Bootstrap (RC1)
-- ------------------------------------------------------------------
-- Creates the tracking table that records every applied migration.
-- This is the ONLY migration-system file that must run before the
-- runner. The runner (scripts/run-migrations.mjs) executes this file
-- automatically on first invocation, then records every subsequent
-- migration listed in supabase/MIGRATION_MANIFEST.json.
--
-- Idempotent: safe to re-run. No business logic, no settlement /
-- lifecycle / transaction semantics — schema plumbing only.
--
-- Existing databases that were built manually (before this tracking
-- table existed) are handled by the runner's --baseline mode, which
-- records the already-applied migration set WITHOUT re-executing them.
-- See supabase/MIGRATIONS.md §"Existing databases".
-- =================================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id           text        PRIMARY KEY,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  file         text        NOT NULL,
  checksum     text,
  category     text        NOT NULL DEFAULT 'migration'
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- Only the service role / postgres may read or write migration state.
-- Application code must never depend on this table.
DROP POLICY IF EXISTS "Service role manages schema_migrations" ON public.schema_migrations;
CREATE POLICY "Service role manages schema_migrations"
  ON public.schema_migrations FOR ALL
  TO service_role, postgres
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.schema_migrations IS
  'RC1 migration tracking. One row per applied migration id (see '
  'supabase/MIGRATION_MANIFEST.json). Managed by scripts/run-migrations.mjs. '
  'Not a source of business truth — operational/deploy state only.';
