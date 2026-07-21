-- Persist ComfyUI Docker image tag used at provision (v3/v4 dual-image audit).
-- Additive / backward compatible. Projection only — not billing SoT.
alter table public.machines
  add column if not exists image text;

comment on column public.machines.image is
  'ADMIN AUDIT ONLY — ComfyUI Docker image at provision (e.g. …:v3|:v4). '
  'Never expose on customer-facing APIs. Projection only; not billing SoT.';

create index if not exists machines_image_idx on public.machines (image);
