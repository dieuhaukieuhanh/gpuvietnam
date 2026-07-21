-- Shared provider bad-host exclusions (Vast + Clore).
-- Renames legacy public.vast_bad_hosts if present; otherwise creates fresh.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vast_bad_hosts'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'provider_bad_hosts'
  ) then
    alter table public.vast_bad_hosts rename to provider_bad_hosts;
  end if;
end $$;

create table if not exists public.provider_bad_hosts (
  host_key text primary key,
  provider text not null default 'vast',
  reason text,
  reason_category text,
  offer_id text,
  instance_id text,
  excluded_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Rename legacy indexes if they still point at the old names after table rename
alter index if exists public.idx_vast_bad_hosts_expires rename to idx_provider_bad_hosts_expires;
alter index if exists public.idx_vast_bad_hosts_category rename to idx_provider_bad_hosts_category;

create index if not exists idx_provider_bad_hosts_expires
  on public.provider_bad_hosts (expires_at);

create index if not exists idx_provider_bad_hosts_category
  on public.provider_bad_hosts (reason_category);

create index if not exists idx_provider_bad_hosts_provider
  on public.provider_bad_hosts (provider);

comment on table public.provider_bad_hosts is
  'Hosts excluded after L2 provision-gate failures (Vast/Clore). TTL by reason_category; provider = vast|clore.';

alter table public.provider_bad_hosts enable row level security;

drop policy if exists "Service role manages vast_bad_hosts" on public.provider_bad_hosts;
drop policy if exists "Service role manages provider_bad_hosts" on public.provider_bad_hosts;
create policy "Service role manages provider_bad_hosts"
  on public.provider_bad_hosts for all
  to service_role
  using (true)
  with check (true);
