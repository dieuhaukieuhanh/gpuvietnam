-- Auto-backup logs before machine destroy (R2 archives)
CREATE TABLE IF NOT EXISTS public.backup_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  machine_id UUID REFERENCES public.machines(id) ON DELETE SET NULL,
  reason VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  error_message TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  archives JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_user_created
  ON public.backup_logs (user_id, created_at DESC);

COMMENT ON TABLE public.backup_logs IS 'Snapshots uploaded to R2 before auto-stop destroy';
COMMENT ON COLUMN public.backup_logs.archives IS 'JSON array: [{folder, sourcePath, r2Key, sizeBytes}]';

ALTER TABLE public.backup_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own backup logs" ON public.backup_logs;
CREATE POLICY "Users read own backup logs"
  ON public.backup_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages backup logs" ON public.backup_logs;
CREATE POLICY "Service role manages backup logs"
  ON public.backup_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
