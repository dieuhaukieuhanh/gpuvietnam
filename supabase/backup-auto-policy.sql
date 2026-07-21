-- Auto-backup policy: plan defaults + global Starter campaign + per-user override.
-- Formula: enabled = userOverride ?? (starter ? globalStarterWindow : planDefault)
-- Plan default: Starter off, Pro/Studio on

create table if not exists public.backup_auto_policy (
  id integer primary key default 1 check (id = 1),
  starter_auto_backup boolean not null default false,
  starts_at timestamptz null,
  ends_at timestamptz null,
  note text null,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

insert into public.backup_auto_policy (id, starter_auto_backup)
values (1, false)
on conflict (id) do nothing;

comment on table public.backup_auto_policy is
  'Singleton: global Starter auto-backup campaign (windowed). Pro/Studio use plan defaults.';

create or replace function public.set_backup_auto_policy_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists backup_auto_policy_updated_at on public.backup_auto_policy;
create trigger backup_auto_policy_updated_at
  before update on public.backup_auto_policy
  for each row
  execute function public.set_backup_auto_policy_updated_at();

alter table public.backup_auto_policy enable row level security;

drop policy if exists "Authenticated read backup auto policy" on public.backup_auto_policy;
create policy "Authenticated read backup auto policy"
  on public.backup_auto_policy for select
  to authenticated
  using (true);

drop policy if exists "Admin update backup auto policy" on public.backup_auto_policy;
create policy "Admin update backup auto policy"
  on public.backup_auto_policy for update
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

alter table public.users
  add column if not exists auto_backup_override text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_auto_backup_override_check'
  ) then
    alter table public.users
      add constraint users_auto_backup_override_check
      check (
        auto_backup_override is null
        or auto_backup_override in ('force_on', 'force_off')
      );
  end if;
end $$;

comment on column public.users.auto_backup_override is
  'Admin override for auto backup: null = follow policy, force_on, force_off.';
