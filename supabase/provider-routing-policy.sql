-- 0056: Central provider routing policy (Admin Hạ tầng SoT)
-- Applies to NEW rents only — does not affect machines already running.

CREATE TABLE IF NOT EXISTS provider_routing_policy (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- { "vast": true, "clore": false, "salad": false }
  providers   JSONB NOT NULL DEFAULT '{"vast":true,"clore":false,"salad":false}',
  -- Attempt order, e.g. ["vast","clore","salad"]
  priority    JSONB NOT NULL DEFAULT '["vast","clore","salad"]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT NULL
);

INSERT INTO provider_routing_policy (id, providers, priority)
VALUES (
  1,
  '{"vast":true,"clore":false,"salad":false}'::jsonb,
  '["vast","clore","salad"]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE provider_routing_policy IS
  'Admin Hạ tầng: enable + priority for GPU providers. SoT for Start/rent walk (new sessions only).';
