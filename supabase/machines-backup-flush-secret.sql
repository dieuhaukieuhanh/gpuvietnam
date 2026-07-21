-- L2 HTTP flush secret (shared with container; app POSTs to Comfy /gpuvietnam/backup/flush)
alter table public.machines
  add column if not exists backup_flush_secret text;

comment on column public.machines.backup_flush_secret is
  'Opaque secret injected as GPUVIETNAM_BACKUP_FLUSH_SECRET; authorizes stop-time HTTP backup flush.';