-- Trigger trùng với logic trong /api/register → gây lỗi 500 khi createUser.
-- Chạy file này một lần trên Supabase SQL Editor.

drop trigger if exists on_auth_user_created on auth.users;

-- (Tuỳ chọn) giữ function để dùng sau, hoặc xóa:
-- drop function if exists public.handle_new_user();
