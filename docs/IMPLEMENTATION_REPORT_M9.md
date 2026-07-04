# IMPLEMENTATION_REPORT_M9

**Milestone:** M9 — API Wiring & Integration  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M9 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md)  
**Date:** 2026-07-03  
**Scope:** Wire existing API routes to M2–M8 domains; API orchestration/mapping only — no domain logic changes, no frontend (M11), no reconciliation (M13)

---

## Objective

Wire toàn bộ API consumers sang Session-Centric Billing domains:

- **Session start** → M4 Provider Verify RUNNING → M3 Session Lifecycle (`pending` → `running`)
- **Destroy** → M7 Unified Destroy Pipeline (`destroyMachineWithBackup` / `destroyUserMachine` wrapper)
- **Remaining / billing display** → M2 Remaining (read-only)
- **Settlement fields** → projection từ M6/M7 pipeline results
- **Auto Stop** → M8 (unchanged; already wired in status poll)

API layer chỉ orchestration và request/response mapping — **không** chứa business rules.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/session-start.js` | **File mới** — `openBillableSession`, `createProvisioningPendingSession`, `interruptPendingSessionForUser`, `loadActiveSessionRow` |
| `src/lib/gpu/api-scb.js` | **File mới** — pure response mappers (`mapSessionStatusFields`, `mapRemainingStatusFields`, `mapDestroyApiResponse`) |
| `src/lib/gpu/api-m9.test.mjs` | **File mới** — mapper + API grep integration tests |
| `src/lib/gpu/index.js` | Export session-start + api-scb + `fetchOrderedBillablePlansForUser` |
| `src/lib/gpu/billing.js` | Export `findMachineForBilling`, `linkMachineToBillingSession`, `fetchOrderedBillablePlansForUser`; `startBilling` marked deprecated (M9) |
| `src/lib/machines.js` | Pass-through `verifyStatus` / `verify` from M7 destroy result |
| `src/pages/api/machines/status.js` | `openBillableSession` thay `startBilling`; M2 remaining + session/settlement fields in response |
| `src/pages/api/user/start-machine.js` | `createProvisioningPendingSession` after machine insert |
| `src/pages/api/dashboard/me.js` | `readRemainingForMachine` (M2) in response |
| `src/pages/api/machines/destroy.js` | `mapDestroyApiResponse` — settlement/verify/billable fields |
| `src/pages/api/user/stop-machine.js` | `mapDestroyApiResponse` — settlement/verify/billable fields |
| `src/pages/api/user/cancel-start-machine.js` | `interruptPendingSessionForUser` (M3) before M7 destroy |
| `src/lib/gpu/billing-m5.test.mjs` | Regression: status API must not call `startBilling` |
| `package.json` | `npm test` includes `api-m9.test.mjs` |

**Không thay đổi:** `remaining-time.js`, `session-lifecycle.js` (domain logic), `provider-verify.js`, `settlement.js`, `destroy-pipeline*.js`, `auto-stop.js`, frontend, DB migrations.

---

## API Wiring Summary

| Route | Domain wiring |
|-------|----------------|
| `GET /api/machines/status` | `openBillableSession` (M4→M3), `readRemainingForMachine` (M2), `getBillingStatus` (M2 projection), `checkAutoStop` (M8), `destroyUserMachine` on provision error (M7 wrapper) |
| `POST /api/user/start-machine` | `repairUserBillingState`, `createProvisioningPendingSession` (M3 pending) |
| `GET /api/dashboard/me` | `readRemainingForMachine` (M2), `repairUserBillingState` |
| `POST /api/machines/destroy` | `destroyMachineWithBackup` → M7; response maps settlement/verify |
| `POST /api/user/stop-machine` | `destroyMachineWithBackup` → M7; response maps settlement/verify |
| `POST /api/user/cancel-start-machine` | `interruptPendingSessionForUser` (M3) → `destroyMachineWithBackup` (M7) |

---

## Request → Domain Mapping

### Session start (status poll when live = running)

```
openBillableSession(supabase, userId, instanceId, gpuService)
  ├─ findMachineForBilling (read)
  ├─ closeOrphanRunningSessions (repair helper)
  ├─ verifyInstanceRunning (M4)
  ├─ createPendingSession → insert pending (M3) [if no pending row]
  ├─ activateRunningSession (M3, providerRunningVerified=true)
  └─ linkMachineToBillingSession (machine anchor only)
```

### Provision start

```
createProvisioningPendingSession(...)
  └─ createPendingSession (M3) → DB insert status=pending, link gpu_session_id
```

### Cancel during boot

```
interruptPendingSessionForUser → interruptSession CANCELLED (M3)
destroyMachineWithBackup → runUnifiedDestroy (M7)
```

### Destroy / stop

```
destroyMachineWithBackup → destroyUserMachine → runUnifiedDestroy (M7)
```

### Remaining read

```
readRemainingForMachine → buildRemainingSnapshot → calculateRemaining (M2)
getBillingStatus → mapRemainingResultToBillingCredit (M5 projection)
```

---

## Response Changes

### `GET /api/machines/status`

| Field | Source |
|-------|--------|
| `remainingHours`, `totalEntitlementHours`, `currentSessionElapsedHours`, `settledSessionUsageHours` | M2 via `mapRemainingStatusFields` |
| `sessionStatus`, `settlementStatus`, `verifiedRunningAt`, `verifiedDestroyedAt` | Session row projection |
| `hoursRemaining`, `effectiveHoursRemaining`, `billingStartedAt` | M2 via `getBillingStatus` (unchanged field names for M11 compat) |
| `outOfHours` | M2 `isOutOfCredit` (M8 path, from M8) |

### `GET /api/dashboard/me`

| Field | Source |
|-------|--------|
| `remaining` | M2 `readRemainingForMachine` when state OK |

### `POST /api/machines/destroy`, `POST /api/user/stop-machine`

| Field | Source |
|-------|--------|
| `settlementStatus` | M7 pipeline result |
| `verifiedDestroyedAt` | M4 verify in M7 pipeline |
| `verifyStatus` | M4 verify state |
| `billableSeconds` | M6 `calculateBillableSeconds` via pipeline `billingResult` |
| `session.durationSeconds`, `session.hoursUsed` | Pipeline billing result |

### `POST /api/user/cancel-start-machine`

| Field | Source |
|-------|--------|
| `sessionStatus`, `settlementStatus` | M3 interrupt result |

---

## Architecture Compliance

| Rule | Status |
|------|--------|
| API = orchestration only | ✅ `session-start.js`, `api-scb.js` |
| Session start: Verify RUNNING before `running` | ✅ `openBillableSession` gates on M4 |
| Destroy via M7 only from API | ✅ `destroyMachineWithBackup` / `destroyUserMachine` |
| Remaining from M2 only | ✅ no API-side formula |
| No `deductPerMinute` / `applyBillingDeduction` | ✅ grep verified |
| No `stopBilling` from APIs | ✅ grep verified |
| No `startBilling` from APIs | ✅ replaced by `openBillableSession` |
| M2–M8 domain logic unchanged | ✅ |
| No frontend changes | ✅ |
| No reconciliation (M13) | ✅ |
| No DB migrations | ✅ |

---

## Test Coverage

**Total: 156 tests pass** (`npm test`)

### api-m9.test.mjs (15)

| # | Case | Expected |
|---|------|----------|
| T1 | `mapSessionStatusFields` | Projects session/settlement/verify timestamps |
| T2 | `mapRemainingStatusFields` | Projects M2 OK breakdown |
| T3 | `mapDestroyApiResponse` | settlement + verify + billableSeconds |
| T4–T9 | API grep — no legacy billing | `startBilling`, `stopBilling`, `deductPerMinute`, `applyBillingDeduction` absent |
| T10 | status uses `openBillableSession` | ✅ |
| T11 | destroy APIs use `mapDestroyApiResponse` | ✅ |
| T12 | cancel uses M3 interrupt | ✅ |
| T13 | start-machine pending session | ✅ |
| T14 | dashboard/me M2 remaining | ✅ |
| T15 | session-start wires M3+M4 | ✅ |

### Regression (M2–M8)

All prior milestone tests unchanged and passing (remaining-time, session-lifecycle, provider-verify, billing-m5, settlement, destroy-pipeline, auto-stop-m8).

---

## Limitations

1. **`startBilling()` deprecated but retained** — internal legacy path still exists in `billing.js` for backward compatibility; APIs no longer call it. Full removal deferred to cleanup milestone.
2. **`verifyStatus` on status poll** — exposed via session row / open result; not re-fetched on every poll when session already running (reads DB projection).
3. **No HTTP-level integration tests** — coverage is module mappers + source grep + existing domain tests; E2E API tests depend on M11 test harness.
4. **Frontend still consumes legacy field names** — `effectiveHoursRemaining` retained; M11 will align UI types.

---

## Next Milestone Dependencies

| Milestone | Dependency on M9 |
|-----------|------------------|
| **M10** — Auto-Renew & Entitlement Consumers | Uses same M2 remaining module; APIs now consistent |
| **M11** — Frontend | Consume new `sessionStatus`, `settlementStatus`, `remainingHours`, destroy settlement fields |
| **M13** — Reconciliation | `reconcileMachine` stubs only; not wired in APIs |

---

## Legacy Caller Verification (grep)

| Symbol | API callers | Status |
|--------|-------------|--------|
| `stopBilling()` | None in `src/pages/api` | ✅ |
| `deductPerMinute` | None in `src` | ✅ |
| `applyBillingDeduction` | None in `src` | ✅ |
| `startBilling()` | None in `src/pages/api` | ✅ |
| `destroyUserMachine` | status (provision error), start-machine (stale retry) | ✅ Official M7 wrapper |
