-- Persist Clore SSH password for backup/restore (service-role only; never expose to client).
alter table public.machines
  add column if not exists ssh_password text;

comment on column public.machines.ssh_password is
  'Provider SSH password for backup/restore (Clore). Service-role only; do not select from browser.';
