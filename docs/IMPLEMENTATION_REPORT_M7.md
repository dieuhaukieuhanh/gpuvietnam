# IMPLEMENTATION_REPORT_M7

**Milestone:** M7 — Unified Destroy Pipeline  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M7 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) §6.2 · [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md) · ADR-003 · OP-1  
**Date:** 2026-07-03  
**Scope:** Destroy orchestration only — no API redesign (M9), frontend (M11), reconciliation (M13)

---

## Objective

Xây dựng **Unified Destroy Pipeline** duy nhất — orchestration thuần, không business logic. Thứ tự SCB §6.2:

**Backup → Session closing → Provider destroy → Verify DESTROYED → Close session + `ended_at` → Settlement → Machine destroyed → subscription offline**

Thay thế luồng legacy: `stopBilling` trước `destroyInstance`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/destroy-pipeline-core.js` | **File mới** — pure step constants, verify outcome mapping, T8 ordering assert |
| `src/lib/destroy-pipeline-run.js` | **File mới** — `runDestroyPipeline()` orchestration (node-testable) |
| `src/lib/destroy-pipeline.js` | **File mới** — `runUnifiedDestroy()` wires production deps (billing, backup, settlement) |
| `src/lib/destroy-pipeline-core.test.mjs` | **File mới** — 7 unit tests |
| `src/lib/destroy-pipeline.test.mjs` | **File mới** — 6 integration tests (mock Supabase + injected deps) |
| `src/lib/machines.js` | `destroyUserMachine()` → delegate `runUnifiedDestroy()` |
| `src/lib/machine-destroy.js` | Doc comment cập nhật M7 flow |
| `src/lib/gpu/billing.js` | `stopBilling()` deprecated — không settlement; `finalizeGpuSession()` giữ `closed`; export `clearMachineBillingFieldsForPipeline` |
| `package.json` | `npm test` includes destroy-pipeline tests |

**Không thay đổi:** `session-lifecycle.js`, `provider-verify.js`, `settlement.js` logic, `remaining-time.js`, DB schema, API route signatures, frontend.

---

## Public API

| Export | Module | Purpose |
|--------|--------|---------|
| `runUnifiedDestroy(supabaseAdmin, gpuService, userId, options?)` | `destroy-pipeline.js` | **Entry point** production destroy |
| `runDestroyPipeline(supabaseAdmin, deps, input)` | `destroy-pipeline-run.js` | Orchestration core — injectable deps (tests) |
| `DESTROY_PIPELINE_STEP`, `DESTROY_PIPELINE_OUTCOME` | `destroy-pipeline-core.js` | Step / outcome constants |
| `mapDestroyedVerifyOutcome()`, `assertSettlementAfterVerify()` | `destroy-pipeline-core.js` | Pure helpers |
| `destroyUserMachine()` | `machines.js` | Thin wrapper → `runUnifiedDestroy` |
| `destroyMachineWithBackup()` | `machine-destroy.js` | Unchanged signature → `destroyUserMachine` |

### Deprecated

| Function | M7 behavior |
|----------|-------------|
| `stopBilling()` | **Không** gọi settlement; clear billing anchors only (`deprecated: true`) |

### Settlement invocation

`settleSession()` / `skipSessionSettlement()` chỉ được gọi từ **Destroy Pipeline** (`destroy-pipeline-run.js`) trong production path. `settleSessionForMachine()` giữ cho admin/retry tooling (export only).

---

## Destroy Pipeline Flow

```
runUnifiedDestroy(userId, options)
    │
    ├─ RESOLVE active machine (+ session row if billable)
    ├─ BACKUP (optional — policy + running)
    ├─ collectSessionMetrics (read-only)
    │
    ├─ SESSION_CLOSING — M3 requestDestroy (running → closing)
    │
    ├─ pre-verify DESTROYED
    ├─ PROVIDER_DESTROY — skip if already destroyed (idempotent)
    ├─ VERIFY_DESTROYED — M4 verifyInstanceDestroyed
    │     ├─ still_running → M3 rollbackClosingToRunning — no settlement
    │     ├─ unknown/timeout → stay closing, retryable
    │     └─ destroyed → continue
    │
    ├─ SESSION_CLOSED — M3 closeSession (ended_at = verified_at)
    │
    ├─ SETTLEMENT — M6 settleSession OR skipSessionSettlement (skipBilling)
    │
    └─ CLEANUP — finalizeGpuSession (metrics only if closed), clear billing fields,
                 machine → destroyed, subscription offline
```

---

## State Transition

| Phase | Session status | settlement_status | Machine |
|-------|----------------|-------------------|---------|
| Start (billable) | `running` | null / N/A | `running` |
| After requestDestroy | `closing` | `awaiting_verify` | `running` |
| Verify fail (running) | `running` (rollback) | null | `running` |
| Verify fail (unknown) | `closing` | `awaiting_verify` | `running` |
| After closeSession | `closed` | `pending` | `running` |
| After settlement | `closed` | `settled` / `skipped` / `failed` | `running` |
| Complete | `closed` | terminal | `destroyed` |

---

## Failure & Retry Strategy

| Failure | Outcome | Retry |
|---------|---------|-------|
| Provider destroy error | `provider_destroy_failed` | Retry destroy pipeline; session `closing` |
| Verify still running | `rolled_back` | Session `running`; retry destroy |
| Verify unknown/timeout | `pending_verify` | Retry verify (M3 `retryDestroyVerification`) |
| Settlement error | `settlement_failed` | Retry pipeline — M6 idempotent settle |
| Already destroyed machine | `already_destroyed` | Idempotent return |
| Provider pre-destroyed | Skip `destroyInstance` | Idempotent |

---

## Architecture Compliance

| Rule | Status |
|------|--------|
| Settlement after Verify DESTROYED (OP-1) | ✅ |
| Settlement after Session CLOSED | ✅ |
| No business logic in pipeline | ✅ delegates M3/M4/M6 |
| No duplicate billable / allocation | ✅ |
| No provider verify inside Settlement | ✅ |
| M2/M3/M4/M6 modules unchanged | ✅ |
| Single destroy orchestration | ✅ all paths → `destroyUserMachine` |
| Backup failure does not block destroy | ✅ continues (T6 policy) |

---

## Test Coverage

**Total: 125 tests pass** (`npm test`)

### destroy-pipeline-core.test.mjs (7)

Verify outcome mapping, backup policy, T8 step order.

### destroy-pipeline.test.mjs (6)

| # | Case | Status |
|---|------|--------|
| T1 | Happy path: verify → close → settle | ✅ |
| T2 | Provider destroy fail — no settlement | ✅ |
| T3 | Verify still running — rollback | ✅ |
| T4 | Pre-destroyed provider — skip destroy call | ✅ |
| T5 | skipBilling → skip settlement | ✅ |
| T8 | Settlement step after verify in trace | ✅ |

### Regression M2–M6

All prior suites pass (125 total).

---

## Limitations

1. **API response shape** — Routes vẫn trả JSON cũ; `settlementStatus` / `verifiedDestroyedAt` có trên `destroyUserMachine` result nhưng chưa expose đầy đủ trong API handlers (M9).
2. **Session start** — Legacy `startBilling` vẫn tạo session `running` trực tiếp (chưa M3 full provision path).
3. **Retry API** — Không có endpoint riêng `retry-settlement` / `retry-verify` (M9).
4. **Auto-stop** — Vẫn gọi `destroyMachineWithBackup` (đã đi pipeline); M8 read-only auto-stop refactor chưa làm.
5. **`stopBilling` deprecated** — Giữ compatibility; không dùng trong destroy path.

---

## Next Milestone Dependencies

| Milestone | Dependency |
|-----------|------------|
| **M8 — Auto Stop Read-Only** | Auto-stop trigger qua pipeline (đã wired); loại billing side-effects trong poll |
| **M9 — API Wiring** | Expose `settlementStatus`, `verifiedDestroyedAt`, retry endpoints |
| **M11 — Frontend** | Loading UX during verify/settle wait |
| **M13 — Reconciliation** | Drift repair — không thay pipeline |

---

**M7 complete.** Unified Destroy Pipeline is the sole orchestration path for machine teardown. Architecture 2.0 unchanged.
