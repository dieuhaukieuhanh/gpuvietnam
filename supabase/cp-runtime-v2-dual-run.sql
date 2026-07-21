-- B3 Dual-run policy columns on jobs (ADR-006)
-- Idempotent. Manifest id 0047.

alter table public.jobs
  add column if not exists dual_run_group_id uuid;

alter table public.jobs
  add column if not exists winner_attempt_id uuid references public.job_attempts(id) on delete set null;

alter table public.jobs
  add column if not exists dual_run_enabled boolean not null default false;

create index if not exists jobs_dual_run_group_id_idx
  on public.jobs (dual_run_group_id)
  where dual_run_group_id is not null;

comment on column public.jobs.execution_policy is
  'Runtime Policy: single | dual_run (B3 Render an toàn).';

comment on column public.jobs.dual_run_group_id is
  'B3 correlates Attempt A/B for a dual_run Job.';

comment on column public.jobs.winner_attempt_id is
  'B3 Attempt that produced durable outputs (winner).';

comment on column public.jobs.dual_run_enabled is
  'B3 user/request flag; must still pass plan + host eligibility.';
