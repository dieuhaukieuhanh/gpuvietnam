-- Architecture Freeze v3.2 - machines.port nullable (Pending external endpoint)
-- Apply after projection-read-path.sql (0032).
--
-- NULL port  = Pending (HostPort not yet synced)
-- port > 0   = Resolved external HostPort (must NOT store internal container port 8080)

alter table public.machines
  alter column port drop default;

alter table public.machines
  alter column port drop not null;

comment on column public.machines.port is
  'External HostPort only. NULL = Pending. Must not store internal container port 8080. '
  'Canonical writer: syncMachineFromLiveStatus when provider resolves v1 HostPort.';