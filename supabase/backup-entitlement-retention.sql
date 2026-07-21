-- Backup entitlement + retention (Storage roadmap B/C)
-- Effective backup GB = max(GPU plan tier GB, backup_upgrade_gb)
-- States: active -> grace -> deleted

alter table public.users
  add column if not exists backup_upgrade_gb integer not null default 0,
  add column if not exists backup_retention_state text not null default 'active',
  add column if not exists backup_grace_started_at timestamptz,
  add column if not exists backup_purge_after timestamptz,
  add column if not exists backup_entitled_plan text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_backup_retention_state_check'
  ) then
    alter table public.users
      add constraint users_backup_retention_state_check
      check (backup_retention_state in ('active', 'grace', 'deleted'));
  end if;
end $$;

update public.users u
set backup_upgrade_gb = greatest(coalesce(u.backup_upgrade_gb, 0), coalesce(u.backup_plan_gb, 0))
where exists (
  select 1
  from public.storage_upgrades s
  where s.user_id = u.id
    and s.status = 'completed'
)
and coalesce(u.backup_upgrade_gb, 0) < coalesce(u.backup_plan_gb, 0);

create index if not exists idx_users_backup_retention_purge
  on public.users (backup_retention_state, backup_purge_after)
  where backup_retention_state = 'grace';

-- Align default effective backup with Starter floor (sync still recomputes).
alter table public.users
  alter column backup_plan_gb set default 10;
