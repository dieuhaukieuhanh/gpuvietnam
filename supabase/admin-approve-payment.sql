-- Admin duyệt thanh toán thủ công (Supabase SQL Editor)
-- Thay SUBSCRIPTION_ID bằng id từ bảng subscriptions (status = pending_payment)

update public.subscriptions
set
  status = 'active',
  server_status = 'provisioning',
  activated_at = now()
where id = 'SUBSCRIPTION_ID'
  and status = 'pending_payment';

-- Xem các yêu cầu đang chờ:
-- select id, user_id, plan, billing, env_name, transfer_note, created_at
-- from public.subscriptions
-- where status = 'pending_payment'
-- order by created_at desc;
