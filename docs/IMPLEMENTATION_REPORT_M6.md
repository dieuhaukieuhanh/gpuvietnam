# IMPLEMENTATION_REPORT_M6

**Milestone:** M6 — Settlement Engine  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M6 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) §6 · [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md) · ADR-003 · OP-1 · INV-6  
**Date:** 2026-07-03  
**Scope:** Settlement Domain only — no Destroy Pipeline (M7), API wiring (M9), frontend, reconciliation (M13)

---

## Objective

Xây dựng **Settlement Domain** — nơi duy nhất được phép **commit entitlement usage** sau Provider Verify DESTROYED (M4 gate). Settlement write-once, idempotent theo `session_id`; billable duration derive từ `ended_at − started_at` only.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/settlement-core.js` | **File mới** — pure domain: billable, cap, allocation order, eligibility, breakdown |
| `src/lib/gpu/settlement.js` | **File mới** — `settleSession()`, `skipSessionSettlement()`, entitlement commit |
| `src/lib/gpu/settlement-core.test.mjs` | **File mới** — 14 pure unit tests |
| `src/lib/gpu/settlement.test.mjs` | **File mới** — 7 integration tests (mock Supabase) |
| `src/lib/gpu/billing.js` | Xóa `applyBillingDeduction`, `deductHoursFromInventoryPlan`, `chargeWalletForHours`; `stopBilling()` delegate settlement khi preconditions đủ; `settleLinkedSessionWithoutCharge` → `skipSessionSettlement` cho closed session |
| `src/lib/gpu/index.js` | Export settlement API; sửa export billing từ `billing.js` (không còn `billing-projection`) |
| `src/lib/gpu/billing-m5.test.mjs` | Regression: `applyBillingDeduction` removed |
| `package.json` | `npm test` includes settlement tests |

**Không thay đổi:** `session-lifecycle.js`, `remaining-time.js`, `provider-verify.js`, `machines.js` destroy order, API routes, frontend, DB schema.

---

## Public API

### Settlement Domain (`settlement.js` + `settlement-core.js`)

| Export | Module | Purpose |
|--------|--------|---------|
| `settleSession(supabaseAdmin, { sessionId, userId, providerDestroyedVerified? }, deps?)` | `settlement.js` | Commit settlement một lần / session |
| `skipSessionSettlement(supabaseAdmin, sessionId, reason?, options?)` | `settlement.js` | Skip without entitlement write |
| `settleSessionForMachine(supabaseAdmin, userId, instanceId, options?)` | `settlement.js` | Machine-level helper (internal / M7) |
| `calculateBillableSeconds(startedAt, endedAt)` | `settlement-core.js` | `ended_at − started_at` (floor ≥ 0) |
| `evaluateSettlementEligibility(session, options?)` | `settlement-core.js` | Pure gate before commit |
| `allocateSettlementCharge({ chargeSeconds, plans, walletBalance })` | `settlement-core.js` | Pure allocation |
| `buildSettlementBreakdown(...)` | `settlement-core.js` | Audit JSON shape |
| `computeAvailableEntitlementSeconds`, `capChargeSeconds`, `orderPlansForSettlement` | `settlement-core.js` | Cap + ordering helpers |
| `SETTLEMENT_ERROR_CODE`, `SETTLEMENT_MODULE_VERSION` | both | Constants |

### Billing (legacy wrappers)

| Function | M6 behavior |
|----------|-------------|
| `stopBilling()` | **Không** gọi `applyBillingDeduction`. Chỉ gọi `settleSession()` khi session `closed`/`completed` + `ended_at` + verify DESTROYED. Trả `entitlementDeferred: true` khi chưa đủ gate (destroy path cũ — M7 sẽ reorder). |
| `settleMachineBillingWithoutCharge()` | Closed session → `skipSessionSettlement`; running orphan → `interrupted` (unchanged) |

### Removed

| Function | Replacement |
|----------|-------------|
| `applyBillingDeduction()` | **Deleted** — logic trong Settlement Domain |
| `deductHoursFromInventoryPlan()` (billing) | Moved → `settlement.js` (private) |
| `chargeWalletForHours()` (billing) | Moved → `chargeWalletForSession()` trong `settlement.js` |

---

## Settlement Flow

```
settleSession(sessionId)
    │
    ├─ load session
    ├─ idempotent return if settlement_status ∈ {settled, skipped}
    ├─ evaluateSettlementEligibility
    │     • status = closed | completed (legacy)
    │     • ended_at set
    │     • providerDestroyedVerified OR verified_destroyed_at
    │     • settlement_status ∉ terminal
    │
    ├─ billable_seconds = ended_at − started_at
    ├─ if billable_seconds = 0 → skipSessionSettlement
    │
    ├─ claim: settlement_status → in_progress (pending|failed|awaiting_verify|in_progress)
    │
    ├─ available_seconds = entitlement snapshot
    ├─ charge_seconds = min(billable, available)   ← cap policy SCB §6.3
    │
    ├─ allocate: manual_grant → gift → combo → hourly wallet
    ├─ commit: manual_hour_grants.hours_used, subscriptions.hours_used, wallet_balance, wallet_transactions
    ├─ syncUserPlanInventory
    │
    └─ settlement_status = settled, settlement_at, settlement_breakdown
          on error → settlement_status = failed (retry-safe)
```

**Consumption order:** Manual Grant (`grant_id`) → Gift → Combo → Hourly Wallet (expiring-soonest within grant/gift tiers).

---

## Settlement Breakdown Format

Persisted JSON on `gpu_sessions.settlement_breakdown`:

```json
{
  "session_id": "uuid",
  "billable_seconds": 3600,
  "charged_seconds": 3600,
  "uncharged_seconds": 0,
  "manual_grant": { "hours": 0, "grant_ids": [] },
  "gift": { "hours": 1 },
  "combo": { "hours": 0, "inventory_id": null },
  "wallet": { "vnd": 0, "hours_equivalent": null },
  "bonus": null,
  "promotion": null,
  "cap_applied_seconds": null
}
```

Skip path adds `skip_reason`. Wallet transaction description: `GPU session {sessionId} · {hours}h · {plan}` — idempotent on retry (T7).

---

## Architecture Compliance

| Rule | Status |
|------|--------|
| Settlement only after Verify DESTROYED (OP-1, ADR-003) | ✅ `evaluateSettlementEligibility` |
| Billable = `ended_at − started_at` only (INV-9) | ✅ `calculateBillableSeconds` |
| No `duration_seconds`, `billed_seconds`, tick, heartbeat, ledger | ✅ |
| No provider read in Settlement | ✅ |
| Remaining Domain (M2) read-only | ✅ unchanged |
| Session Lifecycle (M3) no settlement commit | ✅ unchanged |
| Provider Verify (M4) gate only | ✅ caller passes verify flag |
| Write-once / idempotent (INV-6) | ✅ terminal status + wallet tx dedup |
| Entitlement write only in Settlement | ✅ removed from `billing.js` |
| Consumption order SCB §6.3 + manual grant first | ✅ `settlementPlanTier` |

---

## Test Coverage

**Total: 112 tests pass** (`npm test`)

### settlement-core.test.mjs (14)

| # | Case | Status |
|---|------|--------|
| T1 | 3600s billable from timestamps | ✅ |
| T3 | Verify not destroyed rejected | ✅ |
| T5 | Manual grant → gift → combo → hourly order | ✅ |
| T5 | Gift before combo in allocation | ✅ |
| T6 | Cap at entitlement / wallet partial | ✅ |
| T8 | Zero billable | ✅ |

### settlement.test.mjs (7)

| # | Case | Status |
|---|------|--------|
| T1 | Gift 1h settled | ✅ |
| T2 | Idempotent double settle | ✅ |
| T3 | Verify gate | ✅ |
| T4 | Skip — no entitlement | ✅ |
| T7 | Retry failed — no duplicate wallet tx | ✅ |
| T8 | Zero billable → skipped | ✅ |
| — | Running session rejected | ✅ |

### Regression

| Suite | Status |
|-------|--------|
| M2 remaining-time (26) | ✅ |
| M3 session-lifecycle (44) | ✅ |
| M4 provider-verify (18) | ✅ |
| M5 billing-m5 (7) | ✅ |

---

## Limitations

1. **Destroy pipeline order chưa đổi (M7):** `destroyUserMachine()` vẫn gọi `stopBilling()` trước provider destroy — settlement không chạy cho đến khi session closed + verified (M7 wires verify → `ended_at` → settlement).
2. **`stopBilling()` legacy wrapper:** Trả duration metadata cho `finalizeGpuSession()`; entitlement deferred khi gate chưa pass.
3. **Session status legacy `completed`:** Accepted for settlement eligibility (pre-SCB rows); new rows should use `closed` (M3).
4. **No API exposure:** `settleSession` chưa wired vào destroy API (M9).
5. **Reconciliation (M13):** `reconcileSettlement` stub unchanged — không trigger settlement.

---

## Next Milestone Dependencies

| Milestone | Dependency on M6 |
|-----------|------------------|
| **M7 — Unified Destroy Pipeline** | Gọi `settleSession()` sau verify DESTROYED + `closeSession()` + `ended_at`; reorder destroy flow |
| **M9 — API Wiring** | Expose settlement status in destroy response |
| **M11 — Frontend** | Optional loading state during verify + settlement |
| **M13 — Reconciliation** | `reconcileSettlement` drift detection — không thay settlement commit |

---

**M6 complete.** Settlement Domain is the sole session entitlement writer. Architecture 2.0 unchanged.
