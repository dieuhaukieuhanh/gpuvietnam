-- Phiên hỗ trợ từ xa (Admin xem màn hình KH — WebRTC placeholder)
CREATE TABLE IF NOT EXISTS public.support_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'ended')),
    initiated_by VARCHAR(20) NOT NULL DEFAULT 'customer'
        CHECK (initiated_by IN ('customer', 'admin')),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_user_open
    ON public.support_sessions (user_id, created_at DESC)
    WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS idx_support_sessions_status
    ON public.support_sessions (status, created_at DESC);

ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own support sessions" ON public.support_sessions;
DROP POLICY IF EXISTS "Users create own support sessions" ON public.support_sessions;
DROP POLICY IF EXISTS "Users update own support sessions" ON public.support_sessions;
DROP POLICY IF EXISTS "Admin manages support sessions" ON public.support_sessions;
DROP POLICY IF EXISTS "Service role manages support sessions" ON public.support_sessions;

CREATE POLICY "Users view own support sessions"
    ON public.support_sessions FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users create own support sessions"
    ON public.support_sessions FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own support sessions"
    ON public.support_sessions FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin manages support sessions"
    ON public.support_sessions FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role manages support sessions"
    ON public.support_sessions FOR ALL
    USING (true)
    WITH CHECK (true);
