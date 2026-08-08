-- Sepay webhook dedup & audit log
-- Run on Supabase SQL Editor once.

CREATE TABLE IF NOT EXISTS public.sepay_transactions (
  id              bigint PRIMARY KEY,                  -- Sepay transaction ID (dedup)
  gateway         text,                                -- e.g. "MB Bank", "Vietcombank"
  account_number  text,                                -- bank account that received money
  transfer_amount numeric NOT NULL,                    -- amount in VND
  transfer_type   text NOT NULL DEFAULT 'in',          -- 'in' | 'out'
  code            text,                                -- parsed payment code (e.g. GDX7)
  content         text,                                -- raw transfer content from bank
  transaction_date timestamptz,                        -- when the bank processed it
  matched_type    text,                                -- 'wallet_deposit' | 'gpu_plan' | 'plan_renew' | null
  matched_id      uuid,                                -- matched row ID (wallet_transactions / subscriptions / plan_renew_requests)
  matched_amount  numeric,                             -- expected amount from the matched row
  status          text NOT NULL DEFAULT 'processed'    -- 'processed' | 'amount_mismatch' | 'no_match' | 'duplicate'
    CHECK (status IN ('processed', 'amount_mismatch', 'no_match', 'duplicate', 'error')),
  raw_payload     jsonb,                               -- full webhook payload for audit
  error_message   text,                                -- error detail if status = 'error'
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Dedup: block duplicate webhook deliveries
CREATE UNIQUE INDEX IF NOT EXISTS idx_sepay_transactions_id
  ON public.sepay_transactions (id);

-- Lookup by matched row
CREATE INDEX IF NOT EXISTS idx_sepay_transactions_matched
  ON public.sepay_transactions (matched_type, matched_id);

-- Reconciliation: find transactions by date
CREATE INDEX IF NOT EXISTS idx_sepay_transactions_date
  ON public.sepay_transactions (transaction_date DESC);

-- Only service_role can write (webhook + cron)
ALTER TABLE public.sepay_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage sepay_transactions" ON public.sepay_transactions;
CREATE POLICY "Service role can manage sepay_transactions"
  ON public.sepay_transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);
