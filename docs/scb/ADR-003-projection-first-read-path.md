# ADR-003 — Projection-first Read Path

| | |
|---|---|
| **Status** | Approved |
| **Date** | 2026-07-05 |
| **Approved** | 2026-07-05 — SCB Architecture complete; Maintenance Mode |
| **Architecture** | SCB 2.1 — Architecture Freeze v2 |
| **Depends on** | ADR-001, ADR-002, Phase 2.5 Queue |
| **Supersedes** | Read-path provider coupling (detect + status poll) |

---

## Context

Profiling showed `/api/dashboard/me` spends ~1831ms in `runReadPathDriftDetectAndEnqueue`, of which **Vast GET /instances ≈ 1630ms**.

HTTP read paths (`dashboard/me`, `machines/status`) still call Provider via:

- `detectSubscriptionMachineDrift` → `resolveLiveMachineStatus` / `getInstanceStatus`
- `machines/status` → live status, Comfy metrics, `openBillableSession`

This violates the SCB principle: **Projection is the read model; Provider is write/verify only.**

Architecture Freeze v1 allowed ADR-driven changes. This ADR upgrades Freeze to **v2** with Projection-first Read Path.

---

## Problem

1. **Dashboard latency** bound to Provider RTT (~1.6s+ per request).
2. **Read/write coupling** — status poll triggers billing side effects (`openBillableSession`).
3. **Scale** — every UI poll hits Vast API.
4. **Architecture drift** — read path not projection-driven despite SCB design.

---

## Decision

### 1. Projection-first Read Path (feature flag)

When `SCB_READ_PROJECTION_FIRST` is unset or `1` (default):

- Read APIs **must not** call Provider (no `getInstanceStatus`, `healthCheck`, Comfy metrics on HTTP path).
- Response built from **DB projection** (`machines`, `subscriptions`, `gpu_sessions`).
- Drift detect on read uses **projection-only rules** (`detectSubscriptionMachineDriftProjectionOnly`).
- Async **Verification Pipeline** scheduled via Queue (`projection_verify` operation).

Rollback: `SCB_READ_PROJECTION_FIRST=0` → ADR-001 read path behavior.

### 2. Verification Pipeline (off HTTP)

New module: `projection-verification-pipeline.js`

Executed by **Worker** on `projection_verify` queue jobs:

1. Provider verify (`resolveLiveMachineStatus`)
2. Update projection (`syncMachineFromLiveStatus`, `projection_verified_at`)
3. Full drift detect (with Provider)
4. Enqueue repairs
5. Side effects moved from read path: `openBillableSession`, `updateSubscriptionServerStatus`

Scheduler: `scheduleProjectionVerification()` — deduped, stale threshold `SCB_PROJECTION_VERIFY_STALE_MS` (default 30s).

### 3. Projection fields (migration 0032)

On `machines`:

- `projection_verified_at` — last Worker verification
- `projection_message` — user-facing status from verification

UI status derived via `resolveProjectionMachineStatus(machine, subscription)`.

### 4. Unchanged (frozen)

- SCB Core / Destroy Pipeline ordering
- Billing lifecycle / settlement RPC
- Queue / Scheduler / Worker semantics (additive `projection_verify` op only)
- Provider Abstraction interface

---

## Alternatives Considered

| Option | Rejected because |
|--------|------------------|
| Cache Provider responses in Redis | New infra; stale cache risk; not projection-first |
| Shorter detect on read, full detect in worker only | Still blocks on some provider branches |
| Remove detect entirely from read | Loses reconciliation overlay on dashboard |
| Poll Vast from UI directly | Violates architecture; exposes provider |

---

## Trade-offs

| Gain | Cost |
|------|------|
| Read latency decoupled from Vast (~ms DB vs ~1.6s) | UI may lag provider truth by verify interval |
| Metrics null on read until verified | Acceptable; verification updates projection |
| Clear read/write separation | Requires migration + worker processing verify jobs |
| Rollback via env flag | Two code paths until v2 default |

---

## Rollback

| Level | Action |
|-------|--------|
| **L1** | `SCB_READ_PROJECTION_FIRST=0` — immediate revert to ADR-001 path |
| **L2** | Worker cron off — verify jobs accumulate, read still works on projection |
| **L3** | Migration 0032 columns additive — safe to leave |

---

## Invariants (unchanged)

1. Truth = `gpu_sessions`; billing reads sessions only
2. Destroy ordering frozen
3. Settlement RPC atomicity frozen
4. Queue durability frozen
5. Provider adapter contract frozen

## New invariant (v2)

6. **When `SCB_READ_PROJECTION_FIRST=1`, HTTP read handlers MUST NOT invoke Provider adapters or Comfy HTTP.**

---

## Impact

| Area | Change |
|------|--------|
| `dashboard/me.js` | `runReadPathProjectionFirst` when flag on |
| `machines/status.js` | Delegates to `handleMachinesStatusProjectionFirst` |
| `machines-drift-projection.js` | Projection-only detect + read helper |
| `projection-verification-pipeline.js` | Worker-side verify |
| `machine-operation-worker.js` | Handles `projection_verify` |
| `machine-operation-scheduler.js` | `scheduleProjectionVerification` |
| `supabase/projection-read-path.sql` | Migration 0032 |

---

## Verification

- Unit tests: `scb-read-path.test.mjs`
- Full test suite + build
- Benchmark: dashboard/me & machines/status before/after (see PHASE-AF-V2-REVIEW.md)

---

## Out of scope

- Multi-provider scheduling
- Cost / region optimization
- Projection state machine (`requested`, `allocating`, …) — future ADR
