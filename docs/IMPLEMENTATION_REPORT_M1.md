# IMPLEMENTATION_REPORT_M1

**Milestone:** M1 — Database Schema SCB  
**Architecture Version:** 2.0  
**Date:** 2026-06-28  
**Scope:** Schema/database only — no business logic, API, UI, or billing behavior changes

---

## Objective

Xây dựng **nền tảng dữ liệu** cho Session-Centric Billing (SCB): mở rộng `gpu_sessions` và `machines` để hỗ trợ Session Lifecycle, Settlement metadata, và Provider Verification fields theo `OPERATIONAL_STATE_MACHINE.md` và `SESSION_CENTRIC_BILLING_ARCHITECTURE.md`.

M1 **không** ghi dữ liệu vào các field SCB mới, **không** migrate `completed` → `closed`, **không** thay đổi billing runtime hiện tại.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/gpu-sessions.sql` | Mở rộng `status` CHECK; thêm cột SCB; composite CHECK constraints; partial indexes; column comments |
| `supabase/machines.sql` | Thêm `closing_started_at`; `status` CHECK (greenfield); comments |
| `supabase/machines-billing.sql` | Deprecation comments cho `billing_started_at`, `gpu_session_id` |
| `supabase/scb-schema.sql` | **File mới** — migration idempotent cho DB đã tồn tại |

**Không thay đổi:** `src/**`, `pages/api/**`, components, seed data rows, billing logic.

---

## Database Changes

### `gpu_sessions`

| Change type | Detail |
|-------------|--------|
| Status enum (CHECK) | Mở rộng: giữ `completed` (legacy) + thêm `pending`, `closing`, `closed` |
| New columns | 8 cột SCB (nullable, không populate) |
| Constraints | `settlement_status` CHECK; không `settled` khi `running`; không settlement commit khi `running` |
| Indexes | Partial: `user_id WHERE status='running'`; `settlement_status WHERE IN ('pending','failed')` |
| Comments | `duration_seconds` marked legacy/derived — not SCB SoT |

### `machines`

| Change type | Detail |
|-------------|--------|
| New column | `closing_started_at timestamptz` (nullable) |
| Status enum (CHECK) | Thêm `closing` vào allowed values |
| Comments | `status`, `closing_started_at`, `billing_started_at` (legacy) |

---

## Migration Files

| File | Purpose | Apply order |
|------|---------|-------------|
| `supabase/scb-schema.sql` | ALTER idempotent cho database **đã có** dữ liệu | Sau `gpu-sessions.sql`, `machines.sql`, `machines-billing.sql` |

**Greenfield:** Chạy `gpu-sessions.sql` (đã chứa schema đầy đủ) — `scb-schema.sql` vẫn an toàn re-run (`IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`).

**Không tạo** `supabase/migrations/` runner — theo convention hiện tại của repo (apply script thủ công).

---

## New Columns

### `gpu_sessions`

| Column | Type | Nullable | Populated in M1 |
|--------|------|----------|-----------------|
| `settlement_status` | `text` | Yes | No |
| `settlement_at` | `timestamptz` | Yes | No |
| `billable_seconds` | `numeric` | Yes | No |
| `settlement_breakdown` | `jsonb` | Yes | No |
| `destroy_reason` | `text` | Yes | No |
| `verified_running_at` | `timestamptz` | Yes | No |
| `verified_destroyed_at` | `timestamptz` | Yes | No |
| `provider_instance_id` | `text` | Yes | No |

### `machines`

| Column | Type | Nullable | Populated in M1 |
|--------|------|----------|-----------------|
| `closing_started_at` | `timestamptz` | Yes | No |

---

## New Enums

PostgreSQL dùng `CHECK` constraints (không tạo TYPE enum riêng).

### `gpu_sessions.status`

| Value | Role |
|-------|------|
| `completed` | **Legacy** — giữ cho rows hiện có; tương đương hiển thị `closed` (migrate code M3+) |
| `pending` | OSM §4 — session created, chưa billable |
| `running` | OSM §4 — billable |
| `closing` | OSM §4 — destroy pipeline |
| `closed` | OSM §4 — terminal; `ended_at` set |
| `interrupted` | OSM §4 — orphan/cancel; không charge |

### `gpu_sessions.settlement_status`

| Value | Source |
|-------|--------|
| `not_applicable` | OSM §7 Settlement |
| `awaiting_verify` | OSM §7 Settlement |
| `pending` | OSM §4 composite + SCB §2 |
| `in_progress` | OSM §7 Settlement |
| `settled` | OSM §4 + SCB §2 |
| `skipped` | OSM §4 + SCB §2 |
| `failed` | OSM §4 + SCB §2 |

*SCB §2 liệt kê tập con `{pending, settled, skipped, failed}` — schema hỗ trợ **superset** OSM §7; không vi phạm SCB.*

### `machines.status` (CHECK mở rộng)

Thêm `closing` vào: `creating`, `starting`, `running`, `destroyed`, `error`.

---

## API Changes (Expected: None)

**Actual:** None.

Không sửa `src/pages/api/**`.

---

## Frontend Changes (Expected: None)

**Actual:** None.

Không sửa components.

---

## Business Logic Changes (Expected: None)

**Actual:** None.

Per-minute billing (`deductPerMinute`, `stopBilling`, `startBilling`) và destroy pipeline **không đổi**. Code vẫn ghi `status = 'completed'` / `'running'` như trước — các giá trị vẫn hợp lệ trong CHECK mới.

---

## Breaking Changes

| Area | Breaking? | Mitigation |
|------|-----------|------------|
| Existing `gpu_sessions` rows | **No** | `completed` retained in CHECK; no UPDATE migration |
| Existing `gpu_sessions.status` values | **No** | `running`, `interrupted`, `completed` still valid |
| New columns | **No** | All nullable; no default writes |
| Application code | **No** | No code changes in M1 |
| `machines.status` CHECK | **Low risk** | Applied `NOT VALID` in `scb-schema.sql` — validate manually when data clean |
| Future milestones | **Planned** | Code reading `completed` → `closed` deferred to M3+ |

**Không** breaking change tại runtime hiện tại.

---

## ADR Compliance

| ADR | Compliance |
|-----|------------|
| ADR-001 Session-Centric Billing | Schema supports SCB session + settlement fields; legacy columns retained |
| ADR-002 Single Remaining Formula | `billable_seconds`, settled sum fields prepared; formula not implemented (M2) |
| ADR-003 Verify Before Settlement | `verified_destroyed_at`, `verified_running_at` columns added |
| ADR-004 Restart-only Workspace | No schema change required — N/A |
| ADR-005 One Session / Machine | Indexes support single `running` session lookup per user |
| ADR-006 Monolith + Supabase | Changes only in Supabase SQL |
| ADR-007 Provider Adapter | `provider_instance_id` denormalization column added |
| ADR-008 Correctness > Performance | CHECK prevents `running` + `settled`; no tick schema added |
| ADR-009 Session central | Session table extended as billing unit SoT |
| ADR-010 Reconciliation | No reconciliation tables (M13) — not in M1 scope |
| ADR-013 Single SoT | Comments deprecate `duration_seconds`, `billing_started_at` as non-SCB SoT |
| ADR-014 State Machine | Full session + machine + settlement status values in CHECK |
| ADR-015 Docs as SoT | Implementation follows IMPLEMENTATION_PLAN_SCB M1 + OSM |

**Không cần ADR mới** — M1 additive, aligned with Architecture 2.0.

---

## Architecture Principles Compliance

| Principle | Compliance |
|-----------|------------|
| §3 Session ≠ Subscription | No change to subscription schema |
| §4 Machine ephemeral | `closing` state added to machine lifecycle |
| §8 Billing time-based | Schema prepares session `started_at`/`ended_at` SoT; legacy tick fields commented |
| §13 Unified destroy | `destroy_reason`, verify timestamps support future pipeline |
| §18 Incremental | Additive migration only |
| §25 Docs as truth | Matches frozen Architecture 2.0 docs |
| §29 Idempotency | Settlement status enum includes retry states; unique settled enforced in M6 logic |

---

## Coding Rules Compliance

| Rule | M1 |
|------|-----|
| R1 Principles | Schema only — no logic violations |
| R8 No singleton SoT | N/A — DB schema |
| R9 No localStorage SoT | N/A |
| R11 Session billing unit | Columns added on `gpu_sessions` |
| R14 State machine | CHECK values match OSM |
| R15 Update docs | This report documents M1 |

---

## Technical Debt Added

| Debt | Description | Resolve in |
|------|-------------|------------|
| **Legacy `completed` status** | Coexists with `closed` until code + optional data migration | M3+ |
| **`duration_seconds` column** | Still present; commented deprecated | M5/M6 cleanup optional |
| **`billing_started_at` on machines** | Still used by current billing | M5 remove tick dependency |
| **`machines_status_check NOT VALID`** | Constraint added but not validated on existing DBs | Ops: `VALIDATE CONSTRAINT` when ready |
| **`completed` vs `closed` dual terminal** | Two terminal session values in CHECK | M3 session-lifecycle normalizes writes |
| **Settlement superset enum** | OSM §7 states beyond SCB §2 minimum | M6 settlement engine uses subset actively |

---

## Manual Test Checklist

Chạy trên database dev/staging **sau** apply `scb-schema.sql`:

- [ ] **T1** — Apply schema trên DB có tables cũ: không lỗi SQL; columns tồn tại
- [ ] **T2** — `INSERT gpu_sessions (..., status='pending')` → OK
- [ ] **T2b** — Transition test: `UPDATE status='running'` → OK
- [ ] **T2c** — `UPDATE status='closing'` → `closed` → OK
- [ ] **T3** — `INSERT/UPDATE` với `status='closed'`, `settlement_status='settled'` → OK
- [ ] **T4** — `UPDATE status='running', settlement_status='settled'` → **CHECK fail** (expected)
- [ ] **T4b** — `UPDATE status='running', settlement_status='pending'` → **CHECK fail** (expected)
- [ ] **T5** — `INSERT` session without `duration_seconds`, without SCB fields → OK (NULLs)
- [ ] **T6** — Existing rows với `status='completed'` vẫn readable; no migration required
- [ ] **T7** — `INSERT machines (..., status='closing')` → OK
- [ ] **T8** — Partial index `idx_gpu_sessions_user_running` used for `status='running'` query (optional `EXPLAIN`)
- [ ] **T9** — Re-run `scb-schema.sql` → idempotent, no error
- [ ] **T10** — Application start/stop machine vẫn hoạt động (smoke test — no regression)

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `machines_status_check` fails on validate | Low | `NOT VALID` until ops audit statuses |
| Developers assume `completed` removed | Medium | Comments + this report; M3 updates code |
| Dual terminal `completed`/`closed` confusion | Medium | Documented; M3+ normalizes writes to `closed` |
| Settlement enum wider than SCB doc | Low | Superset is intentional for OSM §7; M6 uses needed subset |
| Schema applied without `scb-schema.sql` on old DB | Medium | Document apply order in checklist above |

---

## Ready For M2

| Prerequisite | Status |
|--------------|--------|
| `gpu_sessions` settlement + verify columns | Ready |
| Session status enum (`pending`…`closed`) | Ready |
| `machines.closing` + `closing_started_at` | Ready |
| Indexes for running session + settlement retry | Ready |
| Legacy billing columns preserved | Ready |
| No code depends on new columns yet | Ready — M2 `remaining-time.js` can read schema |

**Verdict: Ready for M2** — Remaining Time module có thể đọc `gpu_sessions` (settled sum, running session) và entitlement tables mà không cần thêm schema.

**Không triển khai M2 trong scope này.**

---

*GPUVietnam IMPLEMENTATION_REPORT_M1 — Architecture 2.0 — 2026-06-28*
