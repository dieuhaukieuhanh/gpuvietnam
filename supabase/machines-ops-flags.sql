-- Ops flags from HTTP-first provision gate (SSH soft-fail).
-- ssh_ok NULL = not probed; true/false after soft SSH check.
-- ops_degraded true = customer-path OK but SSH (or other ops channel) degraded.

alter table public.machines
  add column if not exists ssh_ok boolean null;

alter table public.machines
  add column if not exists ops_degraded boolean not null default false;

comment on column public.machines.ssh_ok is
  'Soft SSH probe after HTTP gate: true=ok, false=failed, null=not probed.';

comment on column public.machines.ops_degraded is
  'True when machine is customer-usable but ops channels (e.g. SSH) are degraded.';

create index if not exists machines_ops_degraded_idx
  on public.machines (ops_degraded)
  where ops_degraded = true;
