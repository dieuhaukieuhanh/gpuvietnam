# Phase AF v2 — Projection-first Read Path — Review

| | |
|---|---|
| **Status** | Complete — **Approved**; SCB in Maintenance Mode |
| **Date** | 2026-07-05 |
| **Approved** | 2026-07-05 |
| **ADR** | [ADR-003-projection-first-read-path.md](./ADR-003-projection-first-read-path.md) |
| **Freeze** | [ARCHITECTURE-FREEZE-v2.md](./ARCHITECTURE-FREEZE-v2.md) |

---

## 1. Goal

Remove Provider latency from HTTP read path. Projection becomes **Source of Read**; Provider verify moves to Worker Verification Pipeline.

---

## 2. Performance Benchmark

### Before (flag OFF — measured profiling)

| Endpoint | Hot path | Provider time |
|----------|----------|---------------|
| `GET /api/dashboard/me` | `runReadPathDriftDetectAndEnqueue` | **~1831ms total**, Vast GET /instances **~1630ms** |
| `GET /api/machines/status` | `resolveLiveMachineStatus` + Comfy metrics | Provider-bound per poll |

### After (flag ON — `SCB_READ_PROJECTION_FIRST=1`)

| Endpoint | Hot path | Provider time |
|----------|----------|---------------|
| `GET /api/dashboard/me` | `runReadPathProjectionFirst` | **0ms Provider** — DB + Queue enqueue only |
| `GET /api/machines/status` | `handleMachinesStatusProjectionFirst` | **0ms Provider** — `resolveProjectionMachineStatus` |

**Expected read latency:** dominated by Supabase parallel queries (~50–200ms typical), not Vast (~1600ms).

**Async verify:** `projection_verify` job runs on cron Worker; updates `projection_verified_at` within `SCB_PROJECTION_VERIFY_STALE_MS` (default 30s).

### Proof criteria

- Server logs: no `[vast]` / `getInstanceStatus` during dashboard/me when flag ON
- `prof` tree: no `detectSubscriptionMachineDrift` provider span on read; `runReadPathProjectionFirst` only
- Response includes `projectionFirst: true` on machines/status

---

## 3. File Structure

```
src/lib/
├── scb-read-path.js                    # flag + resolveProjectionMachineStatus
├── machines-drift-projection.js        # projection-only detect + read helper
├── machines-status-projection.js       # machines/status handler (no Provider)
└── infrastructure/
    ├── projection-verification-pipeline.js
    ├── machine-operation-scheduler.js  # + scheduleProjectionVerification
    └── machine-operation-worker.js       # + projection_verify handler

supabase/projection-read-path.sql       # migration 0032

docs/scb/
├── ADR-003-projection-first-read-path.md
├── ARCHITECTURE-FREEZE-v1.md
├── ARCHITECTURE-FREEZE-v2.md
└── PHASE-AF-V2-PROJECTION-READ-PATH-REVIEW.md
```

---

## 4. Dependency Graph

```
dashboard/me ──► runReadPathProjectionFirst ──► Queue enqueue (no Provider)
machines/status ──► handleMachinesStatusProjectionFirst ──► scb-read-path

Worker ──► projection_verify ──► projection-verification-pipeline
                                      └── resolveLiveMachineStatus (Provider OK here)

Frozen unchanged:
  destroy-pipeline, settlement, queue core, provider-abstraction
```

---

## 5. Regression Risk

| Area | Risk | Mitigation |
|------|------|------------|
| Stale UI status | Medium | Verification Pipeline + 30s stale enqueue |
| Billing session open delayed | Low | Moved to verify pipeline when running |
| Live GPU metrics | Low | `metrics: null` on projection read; UI tolerates |
| Flag OFF path | Low | Unchanged ADR-001 code path |
| Queue op constraint | Low | Migration 0032 alters check |

---

## 6. Migration Plan

| Step | Action |
|------|--------|
| 1 | Apply `supabase/projection-read-path.sql` (0032) |
| 2 | Ensure 0030+0031 (`machine_operations`) applied |
| 3 | Deploy code |
| 4 | Set `SCB_READ_PROJECTION_FIRST=1` in staging |
| 5 | Smoke: dashboard load, status poll — confirm no Vast in logs |
| 6 | Enable Worker cron for `projection_verify` processing |
| 7 | Production rollout |

**Rollback:** `SCB_READ_PROJECTION_FIRST=0` — no schema rollback required.

---

## 7. Verification Checklist

- [x] Unit tests `scb-read-path.test.mjs`
- [x] Full `npm test`
- [x] `npm run build`
- [x] No changes to destroy pipeline ordering
- [x] No changes to Provider Interface contract
- [x] Queue/Scheduler/Worker extended, not rewritten

---

## 8. Out of Scope

- Multi-provider Scheduler
- Cost / Region optimization
- Extended projection state machine

**Stop here for review.**
