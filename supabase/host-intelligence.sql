-- Host Intelligence System — Supabase persistence
-- Replaces tmp/host-reputation.json and tmp/host-intelligence-config.json

-- Table 1: Host reputation records (known-good pool, scores, failures)
CREATE TABLE IF NOT EXISTS host_reputation (
  host_key      TEXT PRIMARY KEY,
  provider      TEXT,
  host_id       TEXT,
  server_id     TEXT,
  region        TEXT,
  gpu_type      TEXT,
  gpu_line      TEXT,
  last_seen     BIGINT,
  reputation_score      INTEGER DEFAULT 50,
  failure_count         INTEGER DEFAULT 0,
  success_count         INTEGER DEFAULT 0,
  last_failure_reason   TEXT,
  last_failure_category TEXT,
  blacklist_until       BIGINT,
  consecutive_failures  INTEGER DEFAULT 0,
  last_ready_latency_ms BIGINT,
  -- Host Intelligence fields
  gpu_name        TEXT,
  vram_gb         INTEGER,
  driver_version  TEXT,
  cuda_version    TEXT,
  last_verified   BIGINT,
  verification_count INTEGER DEFAULT 0,
  pass_rate       REAL,
  avg_boot_sec    REAL,
  avg_latency_ms  REAL,
  benchmark_score REAL,
  last_failure_at BIGINT,
  cooldown_until  BIGINT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_host_rep_provider ON host_reputation (provider);
CREATE INDEX IF NOT EXISTS idx_host_rep_gpu_line ON host_reputation (gpu_line);
CREATE INDEX IF NOT EXISTS idx_host_rep_last_verified ON host_reputation (last_verified);
CREATE INDEX IF NOT EXISTS idx_host_rep_score ON host_reputation (reputation_score DESC);

-- Table 2: Runtime config (single row, upserted by admin UI)
CREATE TABLE IF NOT EXISTS host_intelligence_config (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  target_per_line JSONB NOT NULL DEFAULT '{"rtx3090":4,"rtx4090_1x":4,"rtx5090_1x":4}',
  providers       JSONB NOT NULL DEFAULT '{"vast":true,"clore":false}',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure single row
INSERT INTO host_intelligence_config (id, enabled, target_per_line, providers)
VALUES (1, TRUE, '{"rtx3090":4,"rtx4090_1x":4,"rtx5090_1x":4}', '{"vast":true,"clore":false}')
ON CONFLICT (id) DO NOTHING;
