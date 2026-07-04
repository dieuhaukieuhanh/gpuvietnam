# IMPLEMENTATION_REPORT_M13

**Milestone:** M13 — Infrastructure Reconciliation  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M13 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) §8  
**Date:** 2026-07-03  
**Scope:** Reconciliation domain — detect drift, repair via M3/M4/M6/M7; no new business rules; no frontend/API cron (deferred M14)

---

## Objective

Xây dựng **Infrastructure Reconciliation** tách domain (SCB §8):

- Phát hiện drift provider vs DB
- Repair bằng cách gọi domain hiện có (M3 lifecycle, M4 verify, M6 settlement, M7 destroy pipeline)
- **Không** tính Remaining, **không** settlement logic mới, **không** verify logic mới
- Idempotent / retry-safe / reentrant

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/infrastructure/reconciliation-core.js` | **File mới** — pure drift detection (SCB §8.2 + plan T1–T5) |
| `src/lib/infrastructure/reconciliation.js` | **File mới** — scan orchestration + repair routing |
| `src/lib/infrastructure/reconciliation.test.mjs` | **File mới** — detection, repair, idempotency, scan-only tests |
| `src/lib/gpu/provider-verify.js` | M4 contract `reconcileMachine/Session/Settlement` wired to core detection |
| `src/lib/gpu/provider-verify.test.mjs` | Updated M13 contract tests |
| `supabase/infrastructure-reconciliation.sql` | **File mới** — `reconciliation_runs`, `drift_items` audit schema |
| `package.json` | `npm test` includes `reconciliation.test.mjs` |

**Không thay đổi:** M2–M12 domain modules (settlement formulas, remaining, session transitions, destroy pipeline core), frontend, cron/admin API routes (plan items deferred).

---

## Reconciliation Architecture

```
runInfrastructureReconciliation(supabase, deps, { repair })
  ├─ Load gpu_sessions + machines (candidate rows)
  ├─ M4 verifyProviderState (per instance_id) — read-only provider snapshot
  ├─ reconciliation-core detect* → drift descriptors
  ├─ dedupeDrifts
  └─ if repair: repairDriftItem per drift
        ├─ ORPHAN_SESSION → M3 interruptSession (ORPHAN)
        ├─ ZOMBIE_LOCAL / STALE_CLOSING → M7 runDestroyPipeline
        ├─ SETTLEMENT_FAILED / SETTLEMENT_PENDING → M6 settleSession (if verified_destroyed_at)
        └─ DESTROYED_MISMATCH / ORPHAN_PROVIDER → skipped (operator required)
```

M4 contract functions (`reconcileMachine`, `reconcileSession`, `reconcileSettlement`) remain **detection-only** entry points for single-entity scans.

---

## Detection Rules

| Drift Type | Source | Condition |
|------------|--------|-----------|
| `zombie_local` | SCB §8.2 T1 | Session `running` or machine active; provider destroyed / not found |
| `destroyed_mismatch` | SCB §8.2 T2 | Machine `destroyed` in DB; provider `running` |
| `stale_closing` | Plan T4 | Session `closing`; `closing_started_at` (or machine `updated_at`) > 30 min |
| `orphan_session` | Plan T5 | Session `running`; no active machine |
| `settlement_failed` | Recovery matrix | Session `closed`; `settlement_status = failed` |
| `settlement_pending` | Recovery matrix | Session `closed`; settlement in retryable non-terminal state |

**Not implemented** (not in plan test matrix): pending timeout, full orphan-provider provider-wide scan, machine/session mismatch beyond above — documented as limitations.

---

## Repair Flow

| Drift | Repair Action | Domain |
|-------|---------------|--------|
| `orphan_session` | `interruptSession(ORPHAN)` → `interrupted` + `settlement_status=skipped` | M3 |
| `zombie_local` | `runDestroyPipeline({ reason: admin_stop })` | M7 (+ M4 verify inside pipeline) |
| `stale_closing` | `runDestroyPipeline` retry verify/destroy path | M7 |
| `settlement_failed` / `settlement_pending` | `settleSession({ providerDestroyedVerified: true })` when `verified_destroyed_at` present | M6 |
| `destroyed_mismatch` | Skip — operator alert | — |
| `orphan_provider` | Skip — operator alert (SCB §8.3) | — |

No direct provider destroy or settlement formulas in reconciliation module.

---

## Idempotency Strategy

| Repair | Idempotency |
|--------|-------------|
| Orphan interrupt | M3 `IGNORED` when already `interrupted` → `already_consistent` |
| Destroy pipeline | M7 `already_destroyed` / session terminal guards |
| Settlement retry | M6 `IDEMPOTENT` when `settlement_status ∈ {settled, skipped}` |
| Scan-only (`repair: false`) | No side effects (Plan T3) |
| Re-run reconciliation | Safe on empty drift set; repair paths delegate to domain idempotency |

---

## Failure & Retry Strategy

| Scenario | Outcome |
|----------|---------|
| Provider verify unknown / timeout | Repair via M7 returns `pending_verify`, `retryable: true` |
| Settlement without `verified_destroyed_at` | `skipped` — `awaiting_provider_verify` |
| Destroyed mismatch | `skipped` — `operator_required` |
| Destroy pipeline failure | `failed` with pipeline outcome; no duplicate settlement attempted |
| Repair exception | Logged; drift marked `failed` in run counts |

---

## Observability

`runInfrastructureReconciliation` returns:

```json
{
  "driftCount": 0,
  "drifts": [],
  "repairs": [],
  "counts": {
    "repaired": 0,
    "skipped": 0,
    "failed": 0,
    "already_consistent": 0
  }
}
```

Structured logging via `deps.log(event, payload)`:

- `scan started` / `scan complete`
- `repair orphan session` / `repair via destroy pipeline` / `repair settlement retry`
- `operator required drift` / `repair failed`

`supabase/infrastructure-reconciliation.sql` defines persistent `reconciliation_runs` + `drift_items` — schema ready; runtime persistence wiring deferred to M14 cron/admin API.

---

## Architecture Compliance

| Rule | Status |
|------|--------|
| SCB §8 — reconciliation separate from billing | ✅ |
| INV-7 — reconciliation does not implement settlement math | ✅ |
| §8.5 — no Remaining calculation | ✅ |
| §8.5 — no direct wallet / hours_used writes | ✅ |
| Repair reuses M3/M4/M6/M7 | ✅ |
| No new session transitions | ✅ |
| M2–M12 domain logic unchanged | ✅ |
| `reconcileSettlement` contract — detect only at API boundary | ✅ (repair routes through M6 when explicitly enabled) |

---

## Test Coverage

| # | Case | Result |
|---|------|--------|
| T1 | DB running, provider destroyed → `zombie_local` | ✅ |
| T2 | DB destroyed, provider running → `destroyed_mismatch` | ✅ |
| T3 | Scan-only run — no settlement called | ✅ |
| T4 | Stale closing > 30 min | ✅ |
| T5 | Orphan repair → interrupted, no settle | ✅ |
| — | Settlement retry delegates M6 | ✅ |
| — | Duplicate orphan repair idempotent | ✅ |
| — | Reconciliation rerun safe | ✅ |
| — | Destroyed mismatch operator skip | ✅ |
| — | Settlement without verify skipped | ✅ |
| — | M4 contract wiring in provider-verify | ✅ |

### Regression (M1–M12)

**206 tests pass** (`npm test`).

---

## Limitations

1. **Cron / admin API** — `reconcile-infrastructure.js`, `admin/infrastructure/reconcile.js`, `vercel.json` schedule not wired (user scope: no API/frontend in this pass).
2. **Admin Infrastructure Panel** — drift UI deferred to M14.
3. **Drift persistence** — SQL schema provided; `runInfrastructureReconciliation` returns in-memory results until API layer writes `drift_items`.
4. **Orphan provider scan** — detection only when machine row exists; no provider-wide instance listing (requires provider adapter extension — M14).
5. **Pending session timeout** — not in plan T1–T5; not implemented.
6. **`RECONCILIATION_STUB_MESSAGE`** — retained export for backward compatibility; contract functions now live.

---

## Next Milestone Dependencies

| Milestone | Dependency on M13 |
|-----------|-------------------|
| **M14** — Cleanup & Doc Sync | Wire cron + admin API to `runInfrastructureReconciliation`; persist `reconciliation_runs`; AdminInfrastructurePanel; remove dead `buildLiveSessionFromSubscription` |

---

**Verdict: M13 complete** — Infrastructure Reconciliation domain implemented with SCB-aligned detection and domain-delegated repair; scan-only mode verified; M2–M12 regression clean.
