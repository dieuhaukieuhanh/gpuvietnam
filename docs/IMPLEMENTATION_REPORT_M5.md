# IMPLEMENTATION_REPORT_M5

**Milestone:** M5 — Loại bỏ Per-Minute Billing  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M5 · ADR-001 · OP-9 · [CODING_RULES.md](./CODING_RULES.md) Rule 11  
**Date:** 2026-07-03  
**Scope:** Remove tick billing only — no Settlement (M6), Destroy Pipeline (M7), API redesign (M9)

---

## Objective

Loại bỏ hoàn toàn **per-minute billing tick** (`deductPerMinute`) và mọi **entitlement write** trong lúc session `running`. Remaining trong runtime chỉ **đọc** qua Remaining Time Domain (M2).

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/billing.js` | Xóa `deductPerMinute`, tick helpers; `getBillingStatus` dùng `calculateRemaining` (M2) |
| `src/lib/gpu/billing-projection.js` | **File mới** — pure projection M2 → billing status fields |
| `src/lib/gpu/billing-m5.test.mjs` | **File mới** — 6 unit tests (M5 regression) |
| `src/lib/gpu/auto-stop.js` | Xóa gọi `deductPerMinute` trong `checkAutoStop` |
| `src/pages/api/machines/status.js` | Xóa side-effect `deductPerMinute` trên status poll |
| `src/lib/gpu/index.js` | Xóa export `deductPerMinute`; export `mapRemainingResultToBillingCredit` |
| `package.json` | `npm test` includes `billing-m5.test.mjs` |

**Không thay đổi:** `session-lifecycle.js`, `remaining-time.js` (logic), `provider-verify.js`, DB schema, frontend, Settlement, Destroy Pipeline.

---

## Public API

### Removed

| Export / Function | Notes |
|-------------------|-------|
| `deductPerMinute()` | **Deleted** — no replacement in M5 |

### Added

| Export | Module | Purpose |
|--------|--------|---------|
| `mapRemainingResultToBillingCredit()` | `billing-projection.js` | Pure map M2 `RemainingResult` → billing status shape |

### Retained (read / legacy destroy path)

| Function | M5 behavior |
|----------|-------------|
| `getBillingStatus()` | **Read-only** — builds M2 snapshot, calls `calculateRemaining()` |
| `startBilling()` | Session/machine anchor (unchanged — M7/M9 will delegate lifecycle) |
| `stopBilling()` | Legacy destroy settle — **no tick**; still writes on stop (→ M6) |
| `finalizeGpuSession()` | Unchanged |
| `applyBillingDeduction()` | Internal — used by `stopBilling` only (M6 replaces) |
| `repairUserBillingState()` | Unchanged |
| `collectSessionMetrics()` | Unchanged |

---

## Removed Legacy Components

| Component | Location | Status |
|-----------|----------|--------|
| `deductPerMinute()` | `billing.js` | **Removed** |
| `MINUTE_BILLING_SECONDS` | `billing.js` | **Removed** |
| `getUnbilledSeconds()` | `billing.js` | **Removed** |
| `updateSessionBilledSeconds()` | `billing.js` | **Removed** |
| `summarizeAvailableCredit()` | `billing.js` | **Removed** — replaced by M2 |
| `findMachineByIdForBilling()` | `billing.js` | **Removed** (tick-only) |
| Status poll tick | `machines/status.js` | **Removed** |
| Cron/poll tick prelude | `auto-stop.js` | **Removed** |
| `unbilledSeconds` in `getBillingStatus` return | `billing.js` | **Removed** |

### Verification (T3)

`grep deductPerMinute src/` → **0 matches** (excluding tests that assert absence).

---

## Architecture Compliance

| Requirement | Status |
|-------------|--------|
| OP-9 — No billing write while `running` | ✓ No tick writes during RUNNING |
| ADR-001 — No per-minute tick | ✓ `deductPerMinute` removed |
| CODING_RULES Rule 11 | ✓ No heartbeat billing |
| M2 — Single Remaining formula | ✓ `getBillingStatus` uses `calculateRemaining` |
| M3/M4 unchanged | ✓ No edits to session-lifecycle / provider-verify |
| M1 schema unchanged | ✓ No migration |

### `getBillingStatus` flow (M5)

1. `resolveBillingAnchor()` — read machine/session anchor  
2. `buildRemainingSnapshot()` — load plans, sessions, wallet  
3. `calculateRemaining(snapshot)` — M2 pure domain  
4. `mapRemainingResultToBillingCredit()` — projection for API  

`effectiveHoursRemaining` = M2 `remainingHours` (read-only elapsed deduction).

---

## Test Coverage

**Runner:** `npm test`  
**M5 tests:** 6 in `billing-m5.test.mjs`  
**Total:** 91 tests, 0 failures

| Category | Tests |
|----------|-------|
| `mapRemainingResultToBillingCredit` | OK + INVALID_STATE mapping |
| Tick removal regression | No `deductPerMinute` in billing, auto-stop, status API, index |
| M2 / M3 / M4 | All prior tests still pass |

### IMPLEMENTATION_PLAN cases

| # | Case | M5 |
|---|------|-----|
| T1 | Status poll — no `hours_used` mutation | ✓ tick removed from status.js |
| T2 | Cron idle — no tick | ✓ tick removed from auto-stop.js |
| T3 | grep `deductPerMinute` | ✓ 0 in `src/` |
| T4 | Remaining read-only while running | ✓ via M2 in `getBillingStatus` |

---

## Limitations

| Item | Status | Owner |
|------|--------|-------|
| `stopBilling()` still writes entitlement on destroy | Legacy path retained | M6 Settlement |
| `startBilling()` still creates session rows directly | Not session-lifecycle M3B | M9 API wiring |
| `providerRunningVerified` proxy via billing anchor | Until M4 wired in API | M9 |
| Frontend still uses `effectiveHoursRemaining` from API | Now M2-backed | M11 display |
| Auto Stop still calls `getBillingStatus` + destroy | No M5 auto-stop redesign | M7 pipeline |

---

## Next Milestone Dependencies

| Milestone | Depends on M5 |
|-----------|----------------|
| **M6 Settlement** | Replaces `stopBilling` / `applyBillingDeduction` entitlement writes |
| **M7 Destroy Pipeline** | Order: verify → close session → settlement (no pre-destroy billing) |
| **M9 API wiring** | Full M2 snapshot loader; session-lifecycle for status writes |
| **M11 Frontend** | Poll `remainingHours` from unified API |

---

## Verdict

**M5 Per-Minute Billing Removal — complete.**

Tick billing eliminated from poll, cron, and exports. Runtime Remaining projection uses M2 only. Legacy `stopBilling` on destroy retained until M6.

---

*GPUVietnam Implementation Report M5 — 2026-07-03*
