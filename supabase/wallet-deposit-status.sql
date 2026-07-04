-- Cột updated_at trên users (DB cũ có thể thiếu — gây lỗi khi duyệt nạp Ví)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Thêm loại giao dịch deposit cho nạp Ví
ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('topup', 'deposit', 'payment', 'refund', 'bonus'));

-- Mở rộng trạng thái giao dịch ví cho luồng nạp chờ Admin duyệt
ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_status_check;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_status_check
  CHECK (status IN ('pending', 'pending_deposit', 'completed', 'failed', 'cancelled', 'rejected'));

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_pending_deposit
  ON public.wallet_transactions (status, created_at DESC)
  WHERE status = 'pending_deposit';
