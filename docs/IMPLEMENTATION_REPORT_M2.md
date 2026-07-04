# IMPLEMENTATION_REPORT_M2

**Milestone:** M2 — Remaining Time Module  
**Architecture Version:** 2.0  
**Date:** 2026-06-28  
**Scope:** Pure domain service only — no billing/API/UI/cron integration

---

## Objective

Xây dựng **Remaining Time Domain Service** — nguồn tính Remaining **duy nhất** cho toàn hệ thống (SCB §3, ADR-002). Module read-only, deterministic, không side effect.

Consumers (Dashboard, Auto Stop, Renew, Admin) **chưa wired** — integration thuộc M9+.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/remaining-time.js` | **File mới** — pure Remaining Time engine |
| `src/lib/gpu/remaining-time.test.mjs` | **File mới** — 21 unit tests (Node test runner) |
| `src/lib/gpu/index.js` | Export remaining-time public API |
| `package.json` | Script `"test": "node --test src/lib/gpu/remaining-time.test.mjs"` |

**Không thay đổi:** `billing.js`, API routes, frontend, auto-stop, renew, cron, settlement, session lifecycle.

---

## New Domain Services

| Module | Path | Role |
|--------|------|------|
| Remaining Time | `src/lib/gpu/remaining-time.js` | SCB Remaining formula — single domain service |

Theo [CODING_RULES.md](./CODING_RULES.md) Rule 3 — logic billing domain nằm trong `src/lib/gpu/`, không utils.

---

## Public Functions

| Function | Description |
|----------|-------------|
| `calculateRemaining(snapshot, clock?)` | Full breakdown + clamped `remainingHours` |
| `calculateTotalEntitlement(snapshot, clock?)` | Gift + combo + wallet→hours |
| `calculateSettledUsage(snapshot, clock?)` | Σ settled session duration (hours) |
| `calculateCurrentSessionElapsed(snapshot, clock?)` | Single verified `running` session elapsed |
| `calculateSessionBillableSeconds(startedAt, endedAt)` | Derived seconds from timestamps |
| `isOutOfCredit(breakdown)` | SCB §3.3 — remaining ≤ 0 or hourly wallet empty |
| `roundHours(value)` | 2 decimal places — unified rounding |
| `clampRemainingHours(hours)` | Floor at 0 |
| `createClock(at)` / `systemClock()` | Injected time — no `Date.now()` in logic |
| `isUsableEntitlementPlan(plan, nowMs)` | Entitlement row filter (active, not expired) |
| `resolvePrimaryPlanType(plans, nowMs)` | `hourly` vs `combo` for `isOutOfCredit` |

**Input:** `RemainingSnapshot` — plain objects (plans, wallet, sessions, `providerRunningVerified`). **No Supabase** inside module.

---

## Formula

```
RemainingHours = clamp(0, TotalEntitlement − SettledSessionUsage − CurrentSessionElapsed)
```

| Component | Definition |
|-----------|------------|
| **TotalEntitlement** | Σ usable `hours_remaining` (gift/combo) + `walletBalance / price_per_hour` (if active hourly plan) |
| **SettledSessionUsage** | Σ `(ended_at − started_at)` in hours WHERE `settlement_status = 'settled'` |
| **CurrentSessionElapsed** | `(now − started_at)` in hours IF exactly one `status = 'running'` AND `providerRunningVerified === true`; else **0** |

Rounding: `roundHours` (2 decimals) on components; final remaining clamped ≥ 0.

---

## Source Of Truth

### Used (read via snapshot — loader M9+)

| Data | Field |
|------|-------|
| Billable start | `gpu_sessions.started_at` |
| Billable end | `gpu_sessions.ended_at` |
| Settlement state | `gpu_sessions.settlement_status` |
| Session lifecycle | `gpu_sessions.status` |
| Gift/combo hours | `user_plan_inventory.hours_remaining` |
| Wallet | `users.wallet_balance` |
| Hourly rate | `user_plan_inventory.price_per_hour` |
| Provider running gate | `providerRunningVerified` (from M4 verify — passed into snapshot) |
| Provider instance | `machines.instance_id` via `machine_id` (not used in Remaining math) |

### Not used (explicitly excluded)

| Field | Reason |
|-------|--------|
| `duration_seconds` | Legacy — not SCB SoT |
| `billable_seconds` | Removed M1 Review — derived only |
| `billing_started_at` | Legacy tick anchor |
| `localStorage` | Never (Rule 9) |
| In-memory cache | Never (Rule 8) |

---

## Dependencies

| Dependency | Usage |
|------------|-------|
| None (runtime) | Pure JS — no imports from billing, supabase, API |

**Future (M9):** Snapshot loader will query Supabase and call `calculateRemaining()`.

---

## Unit Tests

**Runner:** `npm test` → `node --test src/lib/gpu/remaining-time.test.mjs`

**Results:** 21 tests, 0 failures

| Case | Covered |
|------|---------|
| User chưa có session | ✓ |
| User có 1 session running | ✓ |
| User có nhiều session settled | ✓ |
| Session interrupted (`skipped`) | ✓ |
| Settlement failed | ✓ |
| Không có entitlement | ✓ |
| Gift hết / expired | ✓ |
| Wallet còn (hourly) | ✓ |
| Tổng remaining = 0 | ✓ |
| Remaining âm clamp về 0 | ✓ |
| Provider not verified → elapsed 0 | ✓ |
| Multiple running → elapsed 0 | ✓ |
| Deterministic same inputs | ✓ |

---

## Manual Tests

Chạy sau deploy module (không cần DB — dùng snapshot giả):

```bash
npm test
```

**Optional REPL check:**

```javascript
import { calculateRemaining, createClock } from './src/lib/gpu/remaining-time.js';

const clock = createClock('2026-06-28T10:00:00.000Z');
console.log(
  calculateRemaining(
    {
      entitlementPlans: [{ status: 'active', plan_type: 'combo', hours_remaining: 10 }],
      sessions: [
        {
          status: 'running',
          started_at: '2026-06-28T09:00:00.000Z',
          settlement_status: null,
        },
      ],
      providerRunningVerified: true,
    },
    clock,
  ),
);
// remainingHours: 9
```

**Production wiring:** Chưa có — `getBillingStatus()` vẫn dùng tick-based `summarizeAvailableCredit` (M9).

---

## ADR Compliance

| ADR | Compliance |
|-----|------------|
| ADR-001 SCB | Formula matches session-centric read-only model |
| ADR-002 Single Remaining Formula | One module, one formula |
| ADR-008 Correctness | No tick; timestamps only; provider gate |
| ADR-009 Session central | Settled/running from session rows |
| ADR-013 Single SoT | No derived column reads |
| ADR-015 Docs | This report + SCB §3 |

**Không cần ADR mới.**

---

## Architecture Principles Compliance

| Principle | Compliance |
|-----------|------------|
| §8 Billing time-based | Elapsed from `started_at` / `ended_at` |
| §20 Domain logic | Pure domain module — no API/UI |
| §29 Idempotency | Pure function — same snapshot → same output |

---

## Coding Rules Compliance

| Rule | Status |
|------|--------|
| R2 No duplicate logic | Single Remaining module |
| R3 One Remaining service | ✓ |
| R5–R6 No billing/UI | ✓ — no UI |
| R8 No singleton SoT | ✓ — snapshot input |
| R9 No localStorage | ✓ |
| R10 Domain not utils | ✓ — `src/lib/gpu/` |
| R11 Session billing unit | Settled/running from sessions |

---

## Breaking Changes

**None at runtime.**

- `getBillingStatus()`, Dashboard, Auto Stop **unchanged** — still legacy tick semantics until M9.
- New module is **additive** — no caller switched yet.

---

## Technical Debt Added

| Debt | Description | Resolve |
|------|-------------|---------|
| **No snapshot loader** | Callers must build `RemainingSnapshot` manually | M9 API integration |
| **Not wired to billing.js** | Dual formula until M9 delegates | M9 |
| **providerRunningVerified manual** | M4 verify not integrated | M4 + M9 |
| **TotalEntitlement vs legacy summarizeAvailableCredit** | M2 sums gift+combo+wallet; legacy hourly path may return to combo when hourly plan present | Align at M9 when wiring |
| **Test via .mjs** | ESM test file separate from Next bundle | Acceptable for M2 |

---

## Known Limitations

1. **No DB loader** — service accepts snapshots only; production use requires orchestration layer (M9).
2. **Provider verify gate** — caller must set `providerRunningVerified`; default behavior treats unverified as elapsed = 0.
3. **Exactly one running session** — if invariant violated (2+ running), elapsed = 0 (safe default).
4. **Legacy `completed` sessions** — not counted as running; settled usage only when `settlement_status = 'settled'`.
5. **Subscription `hours_used`** — not subtracted from TotalEntitlement (SCB: entitlement snapshot is current inventory + wallet, settled usage separate).
6. **IMPLEMENTATION_PLAN M2** listed `billing.js` refactor — **deferred** per M2 scope constraint (no billing changes).

---

## Ready For M3

| Prerequisite | Status |
|--------------|--------|
| Remaining formula implemented | ✓ |
| Unit tests pass | ✓ |
| Exported from `gpu/index.js` | ✓ |
| No dependency on legacy tick fields | ✓ |
| Clock injectable for tests | ✓ |

**Verdict: Ready for M3** — Session Lifecycle can write `status`/`started_at`/`ended_at`/`settlement_status` knowing Remaining will consume those fields via snapshot (wired M9).

**Không triển khai M3 trong scope này.**

---

*GPUVietnam IMPLEMENTATION_REPORT_M2 — Architecture 2.0 — 2026-06-28*
