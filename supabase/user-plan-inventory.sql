CREATE TABLE IF NOT EXISTS public.user_plan_inventory (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    plan_type VARCHAR(20) NOT NULL,
    plan_name VARCHAR(50) NOT NULL,
    hours_total INTEGER,
    hours_remaining DECIMAL(10,2),
    price_per_hour DECIMAL(12,0),
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active',
    source VARCHAR(50),
    grant_id BIGINT REFERENCES public.manual_hour_grants(id),
    billing VARCHAR(20),
    subscription_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_plan_inventory_user_id ON public.user_plan_inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plan_inventory_active ON public.user_plan_inventory(user_id, is_active);

ALTER TABLE public.user_plan_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own plan inventory"
ON public.user_plan_inventory FOR SELECT
TO authenticated
USING (user_id = auth.uid());
