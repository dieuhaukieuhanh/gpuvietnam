# IMPLEMENTATION_REPORT_M12

**Milestone:** M12 — Session History & Billing History UI  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M12 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md)  
**Date:** 2026-07-03  
**Scope:** Session History / Billing History UI — API-only display; read-only API projection; no M2–M11 domain logic changes; no M13 reconciliation

---

## Objective

Hoàn thiện trang **Lịch sử phiên** (`DashboardLichSuPage`) theo Session-Centric Billing:

- UI chỉ hiển thị dữ liệu từ `GET /api/user/sessions`
- Không tính billing / remaining / duration trên frontend
- View Model (`scb-session-history-view-model.js`) — map API → display, không business rules
- Billing History section — chỉ phiên `settlementStatus ∈ {settled, skipped}` từ API
- Verify status từ `verifiedRunningAt` / `verifiedDestroyedAt` — không suy luận từ `session.status`

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/scb-session-history-view-model.js` | **File mới** — API → History/Billing view mappers |
| `src/lib/scb-ui-m12.test.mjs` | **File mới** — view model + grep regression tests |
| `src/lib/gpu-sessions.js` | SCB status/settlement labels; `mapSessionRow` passthrough SCB fields; `projectBillableSeconds` (server display projection) |
| `src/pages/api/user/sessions.js` | DB-only sessions; remove synthetic `buildLiveSessionFromSubscription` row |
| `src/components/dashboard/HistoryPanel.tsx` | **Major** — SCB fields UI; remove client `liveDuration` timer; Billing History section |
| `src/components/dashboard/DashboardRecentSessionsCard.tsx` | Remove client elapsed math; use API `billableSeconds` / `durationSeconds` |
| `package.json` | `npm test` includes `scb-ui-m12.test.mjs` |

**Không thay đổi:** M2–M11 domain modules (`settlement.js`, `remaining-time.js`, `session-lifecycle.js`, destroy pipeline, provider verify), admin drill-down (deferred), DB schema, M13 reconciliation.

---

## Session History UI Summary

| Field | Source | Display |
|-------|--------|---------|
| Session Status | API `status` + `statusLabel` | Badge per lifecycle (`pending`, `running`, `closing`, `closed`, `interrupted`, legacy `completed`) |
| Started At | API `startedAt` | `formatSessionTime` |
| Ended At | API `endedAt` | `formatSessionTime` or "Đang chạy" |
| Duration | API `durationLabel` / `durationSeconds` | Server-computed in `mapSessionRow`; 30s poll when running (no per-second client math) |
| Billable Seconds | API `billableSeconds` + `billableLabel` | Shown when API provides (terminal sessions) |
| Settlement Status | API `settlementStatus` + `settlementStatusLabel` | Badge when present |
| Settlement At | API `settlementAt` | Timestamp |
| Settlement Breakdown | API `settlementBreakdown` | Summary text from JSON keys (display only) |
| Verify Status | API `verifiedRunningAt` / `verifiedDestroyedAt` | `running verified` / `destroy verified` |
| Verified Destroyed At | API `verifiedDestroyedAt` | Timestamp |
| Destroy Reason | API `destroyReason` | When present (e.g. failed destroy path) |

---

## Billing History UI Summary

Section **LỊCH SỬ QUYẾT TOÁN** trong `HistoryPanel`:

- Filter: `settlementStatus === 'settled' || settlementStatus === 'skipped'` (API field only via `filterBillingHistorySessions`)
- Hiển thị cùng `SessionCard` với settlement/billable/verify fields
- Không tự tính billable, remaining, entitlement, hoặc allocation order
- Phiên `failed` / `in_progress` / `awaiting_verify` chỉ xuất hiện ở Session History, không trong Billing History

---

## API → View Mapping

```
GET /api/user/sessions
  └─ mapSessionRow() [server read projection]
       ├─ status, statusLabel (SCB lifecycle labels)
       ├─ settlementStatus, settlementStatusLabel, settlementAt, settlementBreakdown
       ├─ verifiedRunningAt, verifiedDestroyedAt, destroyReason
       ├─ billableSeconds, billableLabel (server projection for terminal rows)
       └─ durationSeconds, durationLabel (server; live elapsed on API refresh)

  └─ mapSessionsApiList() / mapSessionApiToHistoryView() [frontend]
       ├─ verifyStatusLabel ← verified timestamps only
       ├─ settlementBreakdownSummary ← breakdown JSON keys (display)
       └─ isBillingHistory ← settlementStatus settled|skipped
```

---

## Legacy UI Removed

| Removed | Replacement |
|---------|-------------|
| Client `liveDuration` + 1s `setInterval` in `HistoryPanel` | API `durationLabel`; 30s poll refresh when `status === 'running'` |
| `Date.now() - startedAt` in `DashboardRecentSessionsCard` | API `billableSeconds` or `durationSeconds` |
| Synthetic live session from subscription in sessions API | DB `gpu_sessions` rows only (SCB session SoT) |
| Legacy status label "✅ Hoàn thành" for all non-running | SCB labels: `closed`, `pending`, `closing`, etc. |
| Client references to `hours_used`, `hours_total`, `billed_seconds`, `duration_seconds` in history components | None (grep verified) |

---

## Architecture Compliance

| Rule | Status |
|------|--------|
| ADR — billing SoT on server | ✅ Frontend displays API fields only |
| Operational State Machine — session/settlement states | ✅ Labels map 1:1 from API values |
| No client remaining formula | ✅ Remaining not shown per-session (not in sessions API) |
| No client billable calculation | ✅ `billableSeconds` from API / server `mapSessionRow` |
| Verify status not inferred from session status alone | ✅ Uses `verifiedRunningAt` / `verifiedDestroyedAt` timestamps |
| No M2–M11 domain logic changes | ✅ Only read projection + UI |
| Architecture 2.0 frozen | ✅ No schema / settlement / destroy changes |

---

## Test Coverage

| # | Test | Result |
|---|------|--------|
| T1 | `mapSessionApiToHistoryView` — settled closed session | ✅ |
| T2 | `formatVerifyStatusLabel` — timestamps only | ✅ |
| T3 | `formatSettlementBreakdownSummary` — breakdown keys | ✅ |
| T4 | `filterBillingHistorySessions` — settled/skipped only | ✅ |
| T5–T7 | Grep — no legacy tokens in HistoryPanel, RecentSessions, LichSuPage | ✅ |
| T8 | HistoryPanel uses `scb-session-history-view-model` | ✅ |
| T9 | RecentSessions uses API fields only (no `Date.now`) | ✅ |
| T10 | sessions API — `mapSessionRow`, no synthetic live | ✅ |
| T11 | gpu-sessions SCB projection helpers present | ✅ |

### Regression (M1–M11)

**190 tests pass** (`npm test`).

---

## Limitations

1. **Per-session remaining hours** — not exposed by `GET /api/user/sessions`; dashboard remaining remains on `/api/machines/status` and `/api/dashboard/me` (M9/M10). Not computed in history UI.
2. **Running session duration** — updates on 30s poll (same pattern as M11 dashboard timer), not per-second smooth countdown.
3. **Settlement retry UI** — `failed` / `in_progress` states display label only; no retry actions (domain M6/M7, out of M12 scope).
4. **Admin billing drill-down** — `AdminCustomersPanel` session/settlement link deferred (plan optional item).
5. **Legacy `completed` rows** — still valid in DB; shown with legacy label until data migration (M14).
6. **Reconciliation gaps** — orphan/stale `closing` sessions may appear with API state as-is; repair belongs to **M13**.

---

## Next Milestone Dependencies

| Milestone | Dependency on M12 |
|-----------|-------------------|
| **M13** — Infrastructure Reconciliation | May need richer API fields or admin views for stale `closing` / failed settlement visibility |
| **M14** — Cleanup & Doc Sync | Remove dead `buildLiveSessionFromSubscription`; migrate legacy `completed` → `closed` display; admin drill-down |

---

**Verdict: M12 complete** — Session History and Billing History UI consume SCB API projection only; no client billing formulas in history surfaces.
