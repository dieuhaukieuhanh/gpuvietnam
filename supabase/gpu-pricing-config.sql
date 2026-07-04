-- GPUVietnam GPU pricing config — chạy trên Supabase SQL Editor
-- Lưu toàn bộ nội dung bảng giá (câu chữ, thông số, giá) dạng JSON

create table if not exists public.gpu_pricing_config (
  id integer primary key default 1 check (id = 1),
  config jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_gpu_pricing_config_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gpu_pricing_config_updated_at on public.gpu_pricing_config;
create trigger gpu_pricing_config_updated_at
  before update on public.gpu_pricing_config
  for each row
  execute function public.set_gpu_pricing_config_updated_at();

alter table public.gpu_pricing_config enable row level security;

create policy "Authenticated read gpu pricing config"
  on public.gpu_pricing_config for select
  to authenticated
  using (true);

create policy "Admin update gpu pricing config"
  on public.gpu_pricing_config for update
  to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  );

-- Service role full access (API routes — bypass RLS qua supabaseAdmin)
drop policy if exists "Service role manages gpu pricing config" on public.gpu_pricing_config;
create policy "Service role manages gpu pricing config"
  on public.gpu_pricing_config for all
  to service_role
  using (true)
  with check (true);
