# IMPLEMENTATION_REPORT_M8

**Milestone:** M8 — Auto Stop Read-Only Refactor  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M8 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) §5 · ADR-001  
**Date:** 2026-07-03  
**Scope:** Auto Stop decision engine only — no API redesign (M9), frontend (M11), destroy pipeline changes (M7 frozen)

---

## Objective

Refactor **Auto Stop** thành **Decision Engine** read-only:

- Đọc **Remaining Time (M2)** để quyết định out-of-credit
- Đọc **Comfy queue + idle metadata** để quyết định idle timeout
- Khi cần destroy → gọi **`runUnifiedDestroy()` (M7)** duy nhất
- **Không** billing write, settlement, session state change, provider verify, hoặc destroy provider trực tiếp

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/auto-stop-core.js` | **File mới** — pure decision: `decideAutoStopAction`, `shouldStopForOutOfCredit` (M2) |
| `src/lib/gpu/auto-stop.js` | Refactor — M2 read, M7 destroy; xóa duplicate `isOutOfCredit`, `destroyMachineWithBackup`, `VastProvider` singleton |
| `src/lib/gpu/auto-stop-m8.test.mjs` | **File mới** — 12 unit + regression tests |
| `src/lib/gpu/billing.js` | Export `readRemainingForMachine()` — read-only M2 snapshot loader |
| `src/lib/gpu/billing-m5.test.mjs` | M8 regression grep tests |
| `src/lib/gpu/index.js` | Export auto-stop core + `readRemainingForMachine`, `triggerAutoStopDestroy` |
| `src/pages/api/machines/status.js` | `outOfHours` từ M2 `isOutOfCredit()` + `readRemainingForMachine()` |
| `package.json` | `npm test` includes `auto-stop-m8.test.mjs` |

**Không thay đổi:** `remaining-time.js`, `destroy-pipeline*.js`, `session-lifecycle.js`, `settlement.js`, `provider-verify.js`, cron API signature, frontend.

---

## Public API

### Auto Stop (`auto-stop.js` + `auto-stop-core.js`)

| Export | Purpose |
|--------|---------|
| `checkAutoStop(supabaseAdmin, machineId, deps?)` | Cron/poll entry — decision + optional destroy |
| `triggerAutoStopDestroy(db, userId, reason, deps?)` | Gọi `runUnifiedDestroy()` + notify |
| `syncMachineIdleState(supabaseAdmin, machine)` | Idle metadata sync (unchanged) |
| `decideAutoStopAction(input)` | Pure decision (testable) |
| `shouldStopForOutOfCredit(remaining, walletBalance, hasBilling)` | M2 `isOutOfCredit` wrapper |
| `AUTO_STOP_DECISION`, `AUTO_STOP_MODULE_VERSION` | Constants |

### Billing read helper

| Export | Purpose |
|--------|---------|
| `readRemainingForMachine(supabaseAdmin, userId, machine)` | Read-only M2 snapshot — no writes |

---

## Auto Stop Flow

```
checkAutoStop(machineId)
    │
    ├─ load machine (read)
    ├─ readRemainingForMachine → calculateRemaining (M2)
    │
    ├─ out of credit? → triggerAutoStopDestroy('out_of_credit') → runUnifiedDestroy (M7)
    │
    ├─ fetch Comfy queue (workstation idle probe — not provider verify)
    ├─ applyQueueIdleState (idle_started_at metadata only)
    │
    ├─ decideAutoStopAction
    │     ├─ idle ≥ 60 → runUnifiedDestroy('idle_timeout')
    │     ├─ idle ≥ 55 → notifyIdleWarning (side-effect: warn flag on machine)
    │     ├─ queue unreachable → error (no destroy)
    │     └─ active jobs → active (no destroy)
    │
    └─ return action payload
```

---

## Decision Rules

| Condition | Action |
|-----------|--------|
| Machine not `running` | `skipped` |
| M2 `isOutOfCredit` + billing started | **Destroy** `out_of_credit` |
| No endpoint IP | `skipped` (credit path runs first) |
| Queue unreachable | `error` — no idle destroy (T5) |
| Queue has jobs | `active` |
| Idle ≥ 60 min | **Destroy** `idle_timeout` |
| Idle ≥ 55 min, warn not sent | `warned` |
| Otherwise | `idle` |

---

## Architecture Compliance

| Rule | Status |
|------|--------|
| Auto Stop = decision only | ✅ `auto-stop-core.js` |
| Remaining from M2 only | ✅ `readRemainingForMachine` + `isOutOfCredit` |
| No duplicate Remaining logic | ✅ removed local `isOutOfCredit` |
| No billing / settlement writes | ✅ |
| No session lifecycle changes | ✅ |
| No provider verify in auto-stop | ✅ |
| Destroy via M7 only | ✅ `runUnifiedDestroy` |
| No `stopBilling()` | ✅ removed |
| Idempotent destroy | ✅ M7 `already_destroyed` handled |

---

## Test Coverage

**Total: 141 tests pass** (`npm test`)

### auto-stop-m8.test.mjs (12)

| # | Case | Status |
|---|------|--------|
| T1 | Remaining ≤ 0 → credit stop | ✅ |
| T1 | Remaining > 0 → no credit destroy | ✅ |
| T2 | Idle ≥ 60 → destroy decision | ✅ |
| T3 | Idle 55 → warn only | ✅ |
| T5 | Queue unreachable → error | ✅ |
| — | Active jobs block idle destroy | ✅ |
| — | Regression: no stopBilling / destroyMachineWithBackup / VastProvider | ✅ |

### Regression M2–M7

All prior suites pass (141 total).

---

## Limitations

1. **Idle probe** — vẫn dùng ComfyUI queue HTTP (workstation), không phải Provider Verify (M4) — đúng phạm vi idle detection.
2. **Warn side-effect** — `idle_warning_sent` + notification vẫn ghi machine row (metadata, không phải billing/session).
3. **status.js** — vẫn gọi `getBillingStatus` cho display fields; `outOfHours` dùng M2 (M9 sẽ unify).
4. **Destroy latency** — không còn per-minute tick; out-of-credit destroy theo poll/cron interval — by design (SCB).

---

## Next Milestone Dependencies

| Milestone | Dependency |
|-----------|------------|
| **M9 — API Wiring** | Unified remaining read trên tất cả API consumers |
| **M11 — Frontend** | Dashboard destroy trigger dùng cùng M2 remaining |
| **M13 — Reconciliation** | Không liên quan auto-stop |

---

**M8 complete.** Auto Stop is a read-only decision engine delegating destroy to Unified Destroy Pipeline (M7). Architecture 2.0 unchanged.
