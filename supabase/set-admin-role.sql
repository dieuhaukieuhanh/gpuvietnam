-- Gán quyền admin theo email đăng nhập (chạy trên Supabase SQL Editor)

-- Email admin: admin@gpuvietnam.com



-- 0) Đảm bảo có cột role (bỏ qua nếu đã chạy add-user-role.sql)

alter table public.users

  add column if not exists role text not null default 'user';



-- 1) Cập nhật mọi hàng public.users có email admin

update public.users

set role = 'admin'

where email = lower(trim('admin@gpuvietnam.com'));



-- 2) Tạo / cập nhật hàng khớp auth.users.id

insert into public.users (id, email, role, phone_verified)

select

  au.id,

  lower(trim(au.email)),

  'admin',

  false

from auth.users au

where lower(trim(au.email)) = lower(trim('admin@gpuvietnam.com'))

on conflict (id) do update

set role = 'admin', email = excluded.email;



-- Kiểm tra (phải thấy role = admin, id khớp auth.users):

-- select u.id, u.email, u.role, au.id as auth_id

-- from public.users u

-- join auth.users au on au.id = u.id

-- where lower(u.email) = lower(trim('admin@gpuvietnam.com'));

