-- Fix lỗi đăng ký 500: bỏ trigger auth.users (API /api/register tự ghi public.users)
-- Supabase SQL Editor → Run

drop trigger if exists on_auth_user_created on auth.users;
