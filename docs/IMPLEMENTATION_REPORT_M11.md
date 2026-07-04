# IMPLEMENTATION_REPORT_M11

**Milestone:** M11 — Frontend Integration & SCB UI  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M11 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md)  
**Date:** 2026-07-03  
**Scope:** Frontend displays API-only SCB fields — no client remaining/billing formulas; no API/backend changes; no M12/M13

---

## Objective

Chuyển Dashboard và các màn hình liên quan sang **API-only** Session-Centric Billing:

- Hiển thị `remainingHours`, `sessionStatus`, `settlementStatus`, `verifiedRunningAt` từ API (M9/M10)
- Xóa localStorage billing anchor, session-start-hours cache, và client subtract remaining
- Timer phiên dùng `sessionDurationSeconds` từ poll — không client elapsed smoothing
- `outOfHours` / `lowCreditWarning` chỉ từ API — không tự quyết định out-of-credit trên UI
- View Model layer (`scb-ui-view-model.js`) — map API → display, không business rules

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/scb-ui-view-model.js` | **File mới** — API → View Model mappers (machine status, destroy, plan card picks) |
| `src/lib/scb-ui-m11.test.mjs` | **File mới** — view model + frontend grep regression tests |
| `src/components/dashboard/DashboardOverview.tsx` | **Major** — remove billing caches/client math; use SCB view model + API fields |
| `src/components/dashboard/DashboardCurrentSessionCard.tsx` | `remainingHours`, `sessionStatus`, `settlementStatus`, `verifiedRunningAt` from props |
| `src/hooks/useDashboard.ts` | Expose `remaining` from `/api/dashboard/me` (M9/M10) |
| `src/components/pages/DashboardPage.tsx` | Pass `dashboardRemaining` to overview |
| `package.json` | `npm test` includes `scb-ui-m11.test.mjs` |

**Không thay đổi:** Backend domains M2–M10, API route logic, `DashboardLichSuPage` session history (M12), reconciliation (M13).

---

## UI Integration Summary

| Screen | Source | SCB fields used |
|--------|--------|-----------------|
| Dashboard — Plan card | `/api/machines/status` (running) + `/api/dashboard/me` (offline) | `remainingHours`, `totalEntitlementHours` |
| Dashboard — Session card | `/api/machines/status` | `sessionDurationSeconds`, `remainingHours`, `sessionStatus`, `settlementStatus`, `verifiedRunningAt`, `outOfHours`, `lowCreditWarning` |
| Dashboard — Out-of-hours destroy | API `outOfHours` flag | triggers destroy API only when server says so |
| Dashboard — Stop machine | `/api/machines/destroy` | toast shows `settlementStatus` from response |
| Auto Renew (settings) | `/api/user/settings` via `evaluateAutoRenew` | `autoRenewPreview.hoursRemaining` (M10, unchanged route) |
| Admin Customers | `/api/admin/customers` | `hoursLeft` from M10 backend (display only) |
| Start machine confirm | Inventory plan API | `hoursRemaining` per-plan inventory (server field, not client formula) |

---

## API → View Mapping

```
GET /api/machines/status
  └─ mapMachineStatusApiToScbView()
       ├─ remainingHours, totalEntitlementHours
       ├─ sessionDurationSeconds (timer display)
       ├─ sessionStatus, settlementStatus, verifiedRunningAt
       └─ outOfHours, lowCreditWarning

GET /api/dashboard/me
  └─ dashboardRemaining (hook)
       └─ pickPlanCardRemainingHours() when machine offline

POST /api/machines/destroy
  └─ mapDestroyApiToScbView()
       └─ settlementStatus, verifyStatus, billableSeconds (toast)
```

---

## Legacy UI Removed

| Removed | Replacement |
|---------|-------------|
| `BILLING_ANCHOR_CACHE_KEY` localStorage | `billingStartedAt` / `sessionDurationSeconds` from API poll |
| `SESSION_START_HOURS_CACHE_KEY` | `remainingHours` from status API |
| `resolveLiveEffectiveHours()` client subtract | `remainingHours` API |
| `elapsedSessionSeconds()` client clock | `sessionDurationSeconds` API (updates on poll) |
| 1s `setSessionClockTick` interval | removed — timer jumps on poll (acceptable per plan) |
| `effectiveHoursRemaining` in components | `remainingHours` |
| `applySessionStartHours` on machine start | removed |

---

## Architecture Compliance

| Rule | Status |
|------|--------|
| UI = display only | ✅ view model + props |
| No client remaining formula | ✅ grep verified |
| No client elapsed for remaining | ✅ |
| No client out-of-credit decision | ✅ uses `outOfHours` API |
| No session lifecycle inference | ✅ displays `sessionStatus` only |
| No settlement logic on UI | ✅ displays `settlementStatus` only |
| M2–M10 backend unchanged | ✅ |
| No API redesign | ✅ |
| No DB migrations | ✅ |

---

## Test Coverage

**Total: 179 tests pass** (`npm test`)

### scb-ui-m11.test.mjs (10)

| # | Case | Expected |
|---|------|----------|
| T1 | `mapMachineStatusApiToScbView` | fields pass-through |
| T2 | `pickPlanCardRemainingHours` | running → status API; offline → dashboard/me |
| T3 | `pickSessionRemainingHours` | API scalar only |
| T4 | `mapDestroyApiToScbView` | settlement fields |
| T5–T8 | Grep — no legacy tokens in key components | ✅ |
| T9 | DashboardOverview uses view model | ✅ |
| T10 | Session card uses `remainingHours` | ✅ |

### Regression (M2–M10)

All prior milestone tests unchanged and passing.

**Note:** No dedicated React/component test runner in project; coverage is view-model unit tests + source grep regressions.

---

## Limitations

1. **Session timer** updates on status poll interval (30s running / 10s boot) — no per-second smooth countdown (by design per M11 plan).
2. **Session history page** (`DashboardLichSuPage`) not updated — settlement/billable display deferred to **M12**.
3. **Plan selector / My Plan** still show per-inventory `hoursRemaining` from server inventory API (not total SCB remaining) — appropriate for plan pick UX.
4. **Admin hour grants / payments panels** show entity fields (`hours_used`, `hours_total`) from admin APIs — historical/grant records, not client remaining math.
5. **Machine status cache** (`MACHINE_STATUS_CACHE_KEY`) retained for UI state hydration only — no billing SoT fields stored.

---

## Next Milestone Dependencies

| Milestone | Dependency on M11 |
|-----------|-------------------|
| **M12** — Session History & Admin Billing View | History page settlement labels, `closed` status display, billable time from API |
| **M13** — Reconciliation | Not started; no UI wiring |

---

## Frontend Legacy Verification (grep)

| Pattern | Dashboard components | Status |
|---------|---------------------|--------|
| `BILLING_ANCHOR_CACHE_KEY` | DashboardOverview | ✅ removed |
| `SESSION_START_HOURS_CACHE_KEY` | DashboardOverview | ✅ removed |
| `resolveLiveEffectiveHours` | DashboardOverview | ✅ removed |
| `effectiveHoursRemaining` | Dashboard components | ✅ removed |
| `liveEffectiveHours` | DashboardCurrentSessionCard | ✅ removed |
| `billed_seconds` / `duration_seconds` client math | Dashboard components | ✅ absent |
