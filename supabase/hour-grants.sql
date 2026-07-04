-- Bảng lưu lịch sử tặng giờ
CREATE TABLE IF NOT EXISTS public.manual_hour_grants (
    id BIGSERIAL PRIMARY KEY,
    admin_id UUID REFERENCES auth.users(id),
    user_id UUID REFERENCES auth.users(id),
    hours_granted INTEGER NOT NULL,
    hours_used INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ,
    internal_note TEXT,
    customer_note TEXT,
    grant_type VARCHAR(50) DEFAULT 'manual',
    gpu_plan VARCHAR(20) DEFAULT 'pro',
    status VARCHAR(20) DEFAULT 'active',
    adjusted_by UUID REFERENCES auth.users(id),
    adjustment_reason TEXT,
    adjustment_amount INTEGER,
    adjustment_type VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng log điều chỉnh (audit trail)
CREATE TABLE IF NOT EXISTS public.hour_grant_logs (
    id BIGSERIAL PRIMARY KEY,
    grant_id BIGINT REFERENCES public.manual_hour_grants(id),
    admin_id UUID REFERENCES auth.users(id),
    action_type VARCHAR(20) NOT NULL,
    amount INTEGER,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_hour_grants_user_id ON public.manual_hour_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_hour_grants_status ON public.manual_hour_grants(status);
CREATE INDEX IF NOT EXISTS idx_hour_grant_logs_grant_id ON public.hour_grant_logs(grant_id);
CREATE INDEX IF NOT EXISTS idx_hour_grant_logs_created_at ON public.hour_grant_logs(created_at DESC);

-- RLS
ALTER TABLE public.manual_hour_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hour_grant_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages hour grants"
ON public.manual_hour_grants FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users view own grants"
ON public.manual_hour_grants FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admin manages grant logs"
ON public.hour_grant_logs FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Migration cho DB đã tạo trước đó
ALTER TABLE public.manual_hour_grants
  ADD COLUMN IF NOT EXISTS gpu_plan VARCHAR(20) DEFAULT 'pro';
