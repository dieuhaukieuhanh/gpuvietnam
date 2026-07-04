# IMPLEMENTATION_REPORT_M10

**Milestone:** M10 — Entitlement Consumers & Auto-Renew Integration  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M10 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) §3  
**Date:** 2026-07-03  
**Scope:** Unify entitlement consumers on M2 Remaining; auto-renew as read-only consumer — no frontend (M11), no reconciliation (M13)

---

## Objective

Thống nhất tất cả **entitlement consumers** sử dụng **Remaining Domain (M2)**:

- Auto-renew evaluation dùng SCB `remainingHours` (bao gồm session elapsed)
- Renew quote / proactive bonus dùng cùng metric
- Admin customer list hiển thị Remaining khớp user dashboard
- Không công thức `hours_total − hours_used` cho consumer-facing remaining
- Auto-renew chỉ **quyết định** gia hạn; ghi entitlement qua `processPlanRenew` (purchase flow) — không bypass Settlement / Destroy / Session Lifecycle

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/billing.js` | Export `readRemainingForUser()` — M2 read without billing-anchor gate |
| `src/lib/gpu/billing-projection.js` | Export `resolveScbRemainingHours()` |
| `src/lib/gpu/remaining-consumer.js` | **File mới** — `loadScbRemainingForUser`, `loadScbRemainingBatch` |
| `src/lib/auto-renew.js` | `evaluateAutoRenew` → M2 via `loadScbRemainingForUser`; remove `getHoursRemaining(subscription)` |
| `src/lib/user-plan-inventory.js` | `processPlanRenew` quote uses M2 remaining |
| `src/lib/plan-renew-request.js` | `loadRenewContext` quote uses M2 remaining |
| `src/lib/admin-customers.js` | Customer `hoursLeft` / `totalHours` from M2 batch read |
| `src/lib/gpu/index.js` | Export M10 consumer helpers |
| `src/lib/gpu/auto-renew-m10.test.mjs` | **File mới** — threshold + grep regression tests |
| `package.json` | `npm test` includes `auto-renew-m10.test.mjs` |

**Không thay đổi:** `remaining-time.js` (M2 formulas), `session-lifecycle.js`, `settlement.js`, `destroy-pipeline*.js`, `provider-verify.js`, API route signatures (M9), frontend components (M11).

---

## Consumer Wiring Summary

| Consumer | Before | After |
|----------|--------|-------|
| `evaluateAutoRenew` | `subscription.hours_total − hours_used` | `loadScbRemainingForUser` → M2 |
| `processPlanRenew` (quote) | subscription delta | M2 `hoursRemaining` |
| `loadRenewContext` (renew request) | subscription delta | M2 `hoursRemaining` |
| `fetchCustomersFromDb` (admin) | subscription delta per row | `loadScbRemainingBatch` → M2 |
| `GET /api/user/settings` | via `evaluateAutoRenew` | unchanged route; SCB preview |
| `POST /api/user/auto-renew` | via `executeAutoRenew` | unchanged route; SCB threshold |
| `POST /api/user/auto-renew/check` | via `executeAutoRenewCheck` | unchanged route; SCB threshold |

---

## Remaining Consumer Mapping

```
loadScbRemainingForUser(supabase, userId)
  └─ readRemainingForUser (billing.js)
       ├─ active running machine (if any)
       ├─ resolveBillingAnchor
       ├─ buildRemainingSnapshot (plans + sessions + verify flag)
       └─ calculateRemaining (M2)
  └─ resolveScbRemainingHours (billing-projection.js)
       → scalar hoursRemaining | null
```

| Field | M2 source |
|-------|-----------|
| `hoursRemaining` | `RemainingResult.remainingHours` (OK state) |
| `totalEntitlementHours` | `RemainingResult.totalEntitlementHours` |
| `settledSessionUsageHours` | M2 settled usage |
| `currentSessionElapsedHours` | M2 current session (0 if not verified running) |

---

## Auto-Renew Flow

```
evaluateAutoRenew(userId)
  ├─ loadScbRemainingForUser → hoursRemaining (M2)
  ├─ load subscription metadata (plan/billing only — no remaining math)
  ├─ isWithinAutoRenewThreshold(hoursRemaining, threshold)
  └─ wallet / renew price decision (no entitlement write)

executeAutoRenew(userId)
  ├─ evaluateAutoRenew (read-only)
  └─ if can charge → processPlanRenew (purchase — adds hours_total, not settlement)
```

Auto-renew **không**:

- Ghi settlement
- Gọi destroy pipeline
- Thay đổi session lifecycle
- Tính remaining locally

---

## Architecture Compliance

| Rule | Status |
|------|--------|
| Single Remaining formula (M2) | ✅ consumers use `calculateRemaining` |
| No duplicate out-of-credit in M10 scope | ✅ auto-renew uses threshold on M2 hours |
| Auto-renew = decision only | ✅ writes only via existing `processPlanRenew` purchase |
| No new settlement / billing logic | ✅ |
| No session lifecycle changes | ✅ |
| No destroy / verify changes | ✅ |
| No frontend changes | ✅ (M11) |
| No reconciliation | ✅ (M13) |
| No DB migrations | ✅ |

---

## Test Coverage

**Total: 169 tests pass** (`npm test`)

### auto-renew-m10.test.mjs (12)

| # | Case | Expected |
|---|------|----------|
| T1 | 12h entitlement, 3h running, threshold 10 | `remainingHours=9`, `withinThreshold=true` |
| T2 | No running session | remaining = entitlement − settled |
| T3 | `resolveScbRemainingHours` | OK → scalar; invalid → null |
| T4–T7 | Grep — no `hours_total - hours_used` in consumers | ✅ |
| T8 | auto-renew uses `loadScbRemainingForUser` | ✅ |
| T9 | admin uses `loadScbRemainingBatch` | ✅ |
| T10 | settings API uses `evaluateAutoRenew` | ✅ |

### Regression (M2–M9)

All prior milestone tests unchanged and passing.

---

## Limitations

1. **`syncUserPlanInventory`** still derives per-row `hours_remaining` on inventory from raw subscription/grant tables — this is **inventory sync projection**, not a consumer-facing Remaining formula; M2 reads inventory via `fetchOrderedBillablePlansForUser`.
2. **Per-grant APIs** (`my-grants.js`, dashboard `hourGrants` items) still show grant-level `hours_granted − hours_used` for individual grant display — not total SCB Remaining (M11 may unify display).
3. **Admin batch read** — `loadScbRemainingBatch` is N parallel M2 reads; acceptable for current admin scale; batch optimization deferred.
4. **Frontend** still renders API values — no component changes in M10; M11 will align dashboard cards.

---

## Next Milestone Dependencies

| Milestone | Dependency on M10 |
|-----------|-------------------|
| **M11** — Frontend Dashboard | Consume `remainingHours` / `effectiveHoursRemaining` from M9 APIs; auto-renew preview already SCB-backed |
| **M12** — Session History Admin | Admin remaining column now SCB-consistent |
| **M13** — Reconciliation | Not started; stubs unchanged |

---

## Legacy Consumer Verification (grep)

| Pattern | Consumer files | Status |
|---------|----------------|--------|
| `hours_total - hours_used` (remaining) | auto-renew, processPlanRenew, loadRenewContext, admin-customers | ✅ removed |
| `getHoursRemaining(subscription)` | auto-renew.js | ✅ removed |
| Direct `calculateRemaining` outside M2/billing/consumer | entitlement consumers | ✅ none |
