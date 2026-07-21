-- Architecture v2.0 (ADR-005) — attach Runtime Image Spec refs (B1.3.5)
--
-- runtime_registry.image_spec_ref and job_attempts.image_spec_ref already exist
-- (0043). This migration adds jobs.required_image_spec_ref so a Job declares
-- the environment it needs before Attempt submit / parity gate.
--
-- Spec ids: e.g. gpuvietnam.comfy.v3@1.0 — see docs/architecture/RuntimeImageSpec.md
--
-- Idempotent. Apply via scripts/run-migrations.mjs (manifest id 0045).

alter table public.jobs
  add column if not exists required_image_spec_ref text;

comment on column public.jobs.required_image_spec_ref is
  'B1.3.5 required Runtime Image Spec id (e.g. gpuvietnam.comfy.v3@1.0). '
  'Parity gate compares this to runtime_registry.image_spec_ref before Attempt submit.';

comment on column public.runtime_registry.image_spec_ref is
  'B1.3.5 Runtime Image Spec id this Runtime provides after provision.';

comment on column public.job_attempts.image_spec_ref is
  'B1.3.5 Image Spec id bound for this Attempt (usually copy of Runtime at bind time).';

create index if not exists jobs_required_image_spec_ref_idx
  on public.jobs (required_image_spec_ref)
  where required_image_spec_ref is not null;
