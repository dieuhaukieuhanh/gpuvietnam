-- GPUVietnam — gpu_sessions (Session-Centric Billing 3.0)
-- Truth table. Billing reads ONLY this table. Machine is a projection.
--
-- Milestone: M2 — Database Rebuild (additive, backward compatible)
-- Architecture: SCB 3.0 (docs/scb/SCB-ARCHITECTURE.md)
--
-- SCB 3.0 Session Lifecycle (target, enforced at application layer in M3):
--     pending -> running -> closed
--     NO closing / interrupted / completed in the final model.
--
-- M2 policy (per M2 plan, "additive + backward compatible"):
--   * status CHECK is KEPT WIDE (6 values) so legacy runtime that still writes
--     completed / interrupted / closing does not break. Narrowing to
--     ('pending','running','closed') is deferred to M3 after Session/Billing
--     rewrite completes.
--   * status DEFAULT changed from legacy 'completed' to 'pending'.
--   * started_at is NULLABLE (pending is not yet billable).
--   * machine_id is folded into canonical schema (previously added by the
--     legacy incremental file machines-billing.sql, now Superseded).
--   * New SCB 3.0 invariants are declared as CHECK constraints. On a greenfield
--     install they are VALID (no existing rows). On an existing DB they are
--     added via scb-schema.sql with NOT VALID (skip existing rows; future
--     writes are still checked). Current runtime (session-start.js,
--     session-lifecycle.js, destroy-pipeline-run.js) already satisfies every
--     new constraint on writes — verified during M2.
--
-- Apply order (greenfield):
--   1. schema.sql (auth)
--   2. subscriptions.sql, user-plan-inventory.sql, hour-grants.sql, ...
--   3. machines.sql   (projection table — must exist before gpu_sessions FK)
--   4. this file
--   5. machines-idle.sql, infrastructure-reconciliation.sql
--
-- Apply order (existing DB): see supabase/scb-schema.sql (M2 migration).

create table if not exists public.gpu_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  machine_id uuid references public.machines(id) on delete set null,
  template text not null,
  plan text not null,
  billing text not null default 'combo1',
  gpu_config text,
  status text not null default 'pending'
    check (status in (
      'pending',
      'running',
      'closed',
      -- Legacy values retained for M2 compatibility; removed from CHECK in M3:
      'closing',
      'interrupted',
      'completed'
    )),
  vram_avg_pct numeric,
  vram_current_pct numeric,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds numeric,
  settlement_status text
    check (settlement_status is null or settlement_status in (
      'not_applicable',
      'awaiting_verify',
      'pending',
      'in_progress',
      'settled',
      'skipped',
      'failed'
    )),
  settlement_at timestamptz,
  settlement_breakdown jsonb,
  destroy_reason text,
  verified_running_at timestamptz,
  verified_destroyed_at timestamptz,
  output_summary text,
  output_count integer,
  output_size_gb numeric,
  created_at timestamptz not null default now(),

  -- SCB 3.0 invariants (existing + new). See docs/scb/SCB-ARCHITECTURE.md.
  constraint gpu_sessions_no_settled_while_running
    check (not (status = 'running' and settlement_status = 'settled')),
  constraint gpu_sessions_running_no_settlement_commit
    check (
      status != 'running'
      or settlement_status is null
      or settlement_status in ('not_applicable', 'awaiting_verify')
    ),
  constraint gpu_sessions_closed_requires_settlement_status
    check (status != 'closed' or settlement_status is not null),

  -- Folded from scb-schema-started-at-nullable.sql (Superseded in M2).
  constraint gpu_sessions_running_requires_started_at
    check (status != 'running' or started_at is not null),
  constraint gpu_sessions_closed_requires_started_at
    check (status != 'closed' or started_at is not null),

  -- New SCB 3.0 invariants (M2 additive). Enforced on writes; current runtime
  -- satisfies them (verified: session-start.js sets machine_id +
  -- verified_running_at when activating running; closeSession sets ended_at +
  -- verified_destroyed_at when closing; pending is created without started_at).
  constraint gpu_sessions_pending_has_no_started_at
    check (status != 'pending' or started_at is null),
  constraint gpu_sessions_running_requires_machine_id
    check (status != 'running' or machine_id is not null),
  constraint gpu_sessions_running_requires_verified_running_at
    check (status != 'running' or verified_running_at is not null),
  constraint gpu_sessions_closed_requires_ended_at
    check (status != 'closed' or ended_at is not null),
  constraint gpu_sessions_closed_requires_verified_destroyed_at
    check (status != 'closed' or verified_destroyed_at is not null)
);

comment on table public.gpu_sessions is
  'SCB 3.0 Single Source of Truth for GPU session billing. Billing reads ONLY this table. '
  'Machine (public.machines) is a disposable projection.';
comment on column public.gpu_sessions.status is
  'SCB 3.0 session lifecycle target: pending -> running -> closed. '
  'Legacy values closing/interrupted/completed are retained in the CHECK during M2 for '
  'backward compatibility; they will be removed from the CHECK in M3 after the Session/Billing rewrite. '
  'New code MUST write only pending / running / closed.';
comment on column public.gpu_sessions.started_at is
  'SCB 3.0 billable start timestamp. NULL when status=pending (not yet billable). '
  'NOT NULL when status in (running, closed). Set ONCE at pending -> running (immutable). '
  'DB enforcement: gpu_sessions_running_requires_started_at, gpu_sessions_closed_requires_started_at, '
  'gpu_sessions_pending_has_no_started_at.';
comment on column public.gpu_sessions.ended_at is
  'SCB 3.0 billable end timestamp. NOT NULL when status=closed. '
  'Billable duration = ended_at - started_at (derived). '
  'DB enforcement: gpu_sessions_closed_requires_ended_at.';
comment on column public.gpu_sessions.machine_id is
  'SCB 3.0 relational link to the machine provisioning this session. '
  'NOT NULL when status=running (gpu_sessions_running_requires_machine_id). '
  'Nullable for pending (machine still provisioning) and after machine deletion (ON DELETE SET NULL). '
  'This is the relational SoT; machines.gpu_session_id is the reverse projection link.';
comment on column public.gpu_sessions.verified_running_at is
  'SCB 3.0: timestamp when Provider Adapter verified instance RUNNING. '
  'NOT NULL when status=running (gpu_sessions_running_requires_verified_running_at). '
  'Billing MUST NOT start before this is set (DEC-004: Verify before Billing).';
comment on column public.gpu_sessions.verified_destroyed_at is
  'SCB 3.0: timestamp when Provider Adapter verified instance DESTROYED. '
  'NOT NULL when status=closed (gpu_sessions_closed_requires_verified_destroyed_at). '
  'Settlement MUST NOT run before this is set (DEC-015: Verify before Settlement).';
comment on column public.gpu_sessions.settlement_status is
  'SCB 3.0 settlement outcome. NOT NULL when status=closed. '
  'Values: not_applicable, awaiting_verify, pending, in_progress, settled, skipped, failed.';
comment on column public.gpu_sessions.settlement_at is
  'Timestamp when settlement completed successfully. Populated from M6 (Billing Domain).';
comment on column public.gpu_sessions.settlement_breakdown is
  'Settlement allocation audit (JSONB, not validated at DB layer). '
  'Official shape: {"gift": {"hours": number}, "combo": {"hours": number, "inventory_id": number|null}, '
  '"wallet": {"vnd": number, "hours_equivalent": number|null}, "bonus": {"hours": number|null}, '
  '"promotion": {"code": string|null, "hours": number|null}, "cap_applied_seconds": number|null}. '
  'All keys optional; populated only at settlement. SoT for amounts committed remains '
  'entitlement tables + wallet_transactions.';
comment on column public.gpu_sessions.destroy_reason is
  'Unified destroy pipeline reason metadata (e.g. user_stop, idle_timeout, out_of_credit).';
comment on column public.gpu_sessions.duration_seconds is
  'DEPRECATED (M2). Legacy per-minute billing artifact. Not SCB SoT. '
  'Billable duration = ended_at - started_at (derived). '
  'Retained for backward compatibility with current readers (gpu-sessions.js mapSessionRow); '
  'will be dropped in M11 after view-model rewrite. New code MUST NOT read or write this column.';

create index if not exists idx_gpu_sessions_user on public.gpu_sessions(user_id);
create index if not exists idx_gpu_sessions_started on public.gpu_sessions(user_id, started_at desc);
create index if not exists idx_gpu_sessions_status on public.gpu_sessions(user_id, status);
create index if not exists idx_gpu_sessions_machine on public.gpu_sessions(machine_id);
create index if not exists idx_gpu_sessions_user_running
  on public.gpu_sessions(user_id)
  where status = 'running';
create index if not exists idx_gpu_sessions_settlement_retry
  on public.gpu_sessions(settlement_status)
  where settlement_status in ('pending', 'failed');

-- DEC-011: at most one running session per user. Partial unique index.
-- On an existing DB with duplicate running rows for a user, CREATE will fail;
-- see supabase/scb-schema.sql (M2 migration) for the pre-check / dedup guard.
create unique index if not exists gpu_sessions_one_running_per_user
  on public.gpu_sessions(user_id)
  where status = 'running';

-- Reverse projection FK: machines.gpu_session_id -> gpu_sessions(id).
-- Added after gpu_sessions exists (machines.sql runs first and declares the
-- column without an inline FK). On an existing DB this is added by
-- scb-schema.sql (M2 migration) with NOT VALID.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.machines'::regclass
      AND conname = 'machines_gpu_session_fk'
  ) THEN
    ALTER TABLE public.machines
      ADD CONSTRAINT machines_gpu_session_fk
      FOREIGN KEY (gpu_session_id) REFERENCES public.gpu_sessions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

alter table public.gpu_sessions enable row level security;

create policy "Users read own gpu sessions"
  on public.gpu_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "Service role manages gpu sessions" on public.gpu_sessions;
create policy "Service role manages gpu sessions"
  on public.gpu_sessions for all
  to service_role
  using (true)
  with check (true);
