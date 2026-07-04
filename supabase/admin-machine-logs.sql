-- Audit log when admin starts/stops a customer's GPU machine
CREATE TABLE IF NOT EXISTS public.admin_machine_logs (
    id BIGSERIAL PRIMARY KEY,
    admin_id UUID REFERENCES auth.users(id),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    action VARCHAR(20) NOT NULL,
    machine_id UUID REFERENCES public.machines(id) ON DELETE SET NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_machine_logs_user_id_idx ON public.admin_machine_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_machine_logs_admin_id_idx ON public.admin_machine_logs(admin_id, created_at DESC);

COMMENT ON TABLE public.admin_machine_logs IS 'Admin interventions on customer GPU machines';
