-- Yêu cầu tái tục gói qua chuyển khoản bổ sung (chờ Admin duyệt)
CREATE TABLE IF NOT EXISTS public.plan_renew_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan text NOT NULL,
  billing text NOT NULL CHECK (billing IN ('combo1', 'combo2')),
  renew_price numeric NOT NULL,
  transfer_amount numeric NOT NULL,
  wallet_balance numeric NOT NULL,
  hours_to_add numeric NOT NULL,
  transfer_note text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_plan_renew_requests_user
  ON public.plan_renew_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_renew_requests_pending
  ON public.plan_renew_requests (status, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.plan_renew_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own plan renew requests" ON public.plan_renew_requests;
DROP POLICY IF EXISTS "Service role manages plan renew requests" ON public.plan_renew_requests;

CREATE POLICY "Users read own plan renew requests"
  ON public.plan_renew_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages plan renew requests"
  ON public.plan_renew_requests FOR ALL
  USING (true)
  WITH CHECK (true);
