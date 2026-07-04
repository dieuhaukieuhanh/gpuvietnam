# IMPLEMENTATION_REPORT_M2_REVIEW

**Milestone:** M2 Review — Remaining Time Domain Service  
**Architecture Version:** 2.0  
**Date:** 2026-06-28  
**Scope:** Refinement only — no M3, no billing/API/UI integration

---

## Review Summary

Hoàn thiện Remaining Time Domain Service theo hai thay đổi:

1. **Full precision trong Domain** — bỏ `roundHours()` khỏi mọi công thức; làm tròn thuộc Presentation Layer.
2. **Invariant violation** — nhiều hơn một session `running` không còn trả elapsed = 0; trả `INVALID_STATE` hoặc throw `RemainingInvariantError`.

**Verdict:** M2 domain service sẵn sàng cho wiring M9; **không** triển khai M3.

---

## Các điểm đã sửa

| # | Thay đổi | Trước | Sau |
|---|----------|-------|-----|
| 1 | Rounding | `roundHours()` trên entitlement, settled, elapsed, remaining | Full IEEE float — không làm tròn |
| 2 | `roundHours()` export | Exported từ `remaining-time.js` | **Removed** — không thuộc domain |
| 3 | `clampRemainingHours` | `roundHours(max(0, x))` | `Math.max(0, x)` only |
| 4 | Multiple running sessions | `calculateCurrentSessionElapsed` → 0 | **Throw** `RemainingInvariantError` |
| 5 | `calculateRemaining` multi-running | N/A (elapsed 0 → sai remaining) | **`state: 'INVALID_STATE'`** + `code: MULTIPLE_RUNNING_SESSIONS` |
| 6 | Return type | `RemainingBreakdown` flat | **`RemainingResult`** = `OK` \| `INVALID_STATE` |
| 7 | Constants / error class | — | `REMAINING_STATE_OK`, `REMAINING_INVALID_STATE`, `RemainingInvariantError` |
| 8 | Unit tests | 21 tests | **23 tests** — full precision + invariant cases |

---

## Các điểm giữ nguyên

| Mục | Lý do |
|-----|-------|
| Công thức SCB | Total − Settled − Current (unchanged) |
| SoT fields | `started_at`, `ended_at`, `settlement_status` only |
| Provider verify gate | `providerRunningVerified === false` → elapsed = 0 (valid, not invariant) |
| Zero running sessions | elapsed = 0 (valid) |
| `isOutOfCredit` | Chỉ nhận breakdown `state === 'OK'` |
| Không wire billing/API | M2 scope |
| `calculateSessionBillableSeconds` | Integer seconds via `Math.floor` — billable boundary, not display rounding |

---

## Lý do từng quyết định

### 1. Full precision (no rounding in Domain)

**Quyết định:** Loại bỏ `roundHours()` khỏi domain module.

**Lý do:**
- SCB §3 `roundHours` là quy ước **hiển thị** — thuộc Presentation Layer (API response format, UI `toFixed`).
- Domain giữ giá trị chính xác để Auto Stop / Settlement (M6+) không tích lũy sai số.
- ADR-008 Correctness — không mất precision trước khi so sánh threshold.

**Presentation:** API/UI gọi formatter riêng khi render (M11).

### 2. Multiple running sessions — INVALID_STATE

**Quyết định:**
- `calculateCurrentSessionElapsed()` → **throw** `RemainingInvariantError` (`MULTIPLE_RUNNING_SESSIONS`).
- `calculateRemaining()` → **return** `{ state: 'INVALID_STATE', code, message, runningSessionCount }` — caller quyết định (repair, alert, reject API).

**Lý do:**
- OSM + SCB INV: tối đa một session `running` — nhiều hơn là **data corruption**, không phải “0 elapsed”.
- Trả 0 che lỗi → Remaining sai, Auto Stop không kích hoạt (rủi ro tài chính).
- `calculateRemaining` dùng INVALID_STATE (không throw) để orchestration layer xử lý graceful; `calculateCurrentSessionElapsed` throw khi gọi trực tiếp.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/remaining-time.js` | Remove rounding; invariant error + INVALID_STATE result |
| `src/lib/gpu/remaining-time.test.mjs` | Updated assertions; new invariant tests |
| `src/lib/gpu/index.js` | Export error/constants; remove `roundHours` |

**Không thay đổi:** `billing.js`, API, frontend, auto-stop, renew, settlement, session lifecycle.

---

## Public API Changes

### Removed

| Export | Reason |
|--------|--------|
| `roundHours` | Presentation concern — not domain |

### Added

| Export | Purpose |
|--------|---------|
| `RemainingInvariantError` | Domain error class |
| `REMAINING_STATE_OK` | `'OK'` |
| `REMAINING_INVALID_STATE` | `'INVALID_STATE'` |
| `REMAINING_ERROR_MULTIPLE_RUNNING_SESSIONS` | Error code constant |
| `assertAtMostOneRunningSession(sessions)` | Reusable invariant check (throws) |

### Changed

| Function | Change |
|----------|--------|
| `calculateRemaining()` | Returns `RemainingResult` with `state` field |
| `calculateCurrentSessionElapsed()` | Throws on multiple running |
| `clampRemainingHours()` | No rounding |
| All entitlement/settled/elapsed calcs | Full precision |

---

## Unit Tests

```bash
npm test
```

**Results:** 23 tests, 0 failures

| Case | Status |
|------|--------|
| Full precision wallet hours (`100000/30000`) | ✓ |
| clamp preserves `3.3333333333` | ✓ |
| Multiple running → `RemainingInvariantError` on elapsed | ✓ |
| Multiple running → `INVALID_STATE` on `calculateRemaining` | ✓ |
| All prior M2 cases (updated for `state: 'OK'`) | ✓ |

---

## ADR Compliance

| ADR | Status |
|-----|--------|
| ADR-002 Single Remaining Formula | ✓ — formula unchanged |
| ADR-008 Correctness | ✓ — invariant surfaced, full precision |
| ADR-005 One session running | ✓ — enforced via INVALID_STATE |
| ADR-013 Single SoT | ✓ — unchanged |

**Không cần ADR mới.**

---

## Coding Rules Compliance

| Rule | Status |
|------|--------|
| R3 One Remaining service | ✓ |
| R11 Session billing unit | ✓ |
| R14 State machine | ✓ — multiple running flagged as invalid |

---

## Breaking Changes

**None for production runtime** — module chưa wired.

**Breaking for future callers of M2 module:**

| Change | Migration |
|--------|-----------|
| `calculateRemaining` return shape | Check `result.state === 'OK'` before using hours |
| `roundHours` removed from module | Use presentation formatter in API/UI |
| `calculateCurrentSessionElapsed` throws | Catch `RemainingInvariantError` or pre-check sessions |

---

## Technical Debt Added

| Debt | Resolve |
|------|---------|
| Presentation `roundHours` chưa có shared formatter | M9/M11 API + UI |
| Callers must handle `INVALID_STATE` | M9 snapshot loader + repair hook (M3 reconciliation) |

---

## Known Limitations

1. **`isOutOfCredit`** — expects OK breakdown; caller must guard `INVALID_STATE`.
2. **SCB doc §3 `roundHours`** — applies at presentation when M9 exposes Remaining to API.
3. **Repair path** for `MULTIPLE_RUNNING_SESSIONS` — M3 orphan repair / M13 reconciliation (not M2).

---

## Ready For M3

| Item | Status |
|------|--------|
| Domain formula full precision | ✓ |
| Invariant violation explicit | ✓ |
| Tests pass | ✓ |
| No billing integration | ✓ (by design) |

**Verdict:** M2 domain **complete**. M3 may implement session lifecycle writes knowing Remaining consumer handles `INVALID_STATE` when invariants break.

**Không triển khai M3 trong scope review này.**

---

*GPUVietnam IMPLEMENTATION_REPORT_M2_REVIEW — Architecture 2.0 — 2026-06-28*
