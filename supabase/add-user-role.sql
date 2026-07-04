-- Thêm role cho users (chạy trên Supabase SQL Editor)

alter table public.users
  add column if not exists role text not null default 'user';

create index if not exists idx_users_role on public.users (role);

-- Gán admin cho tài khoản (thay email bằng email admin thật):
-- update public.users set role = 'admin' where email = 'admin@gpuvietnam.com';
