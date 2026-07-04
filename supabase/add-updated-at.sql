-- Thêm cột updated_at nếu bảng users được tạo từ schema cũ
alter table public.users
  add column if not exists updated_at timestamptz not null default now();
