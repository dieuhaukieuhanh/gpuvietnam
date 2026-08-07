-- Google OAuth: auto tạo public.users khi auth.users có user mới
-- Chạy 1 lần trong Supabase SQL Editor

create or replace function public.handle_new_auth_user()
returns trigger as $$
begin
  insert into public.users (id, email, email_verified, phone_verified)
  values (
    new.id,
    new.email,
    case when new.email_confirmed_at is not null then true else false end,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
