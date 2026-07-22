-- A1 M1: editor-only comfy access tokens (upstream / machine optional).
-- Allows Workspace shell on work.* without a running GPU Runtime.

alter table public.comfy_access_tokens
  alter column machine_id drop not null;

alter table public.comfy_access_tokens
  alter column upstream_url drop not null;

comment on column public.comfy_access_tokens.upstream_url is
  'Comfy Runtime base URL; NULL = editor-only Workspace session (A1 offline).';

comment on column public.comfy_access_tokens.machine_id is
  'Bound machine when Runtime online; NULL for editor-only tokens.';
