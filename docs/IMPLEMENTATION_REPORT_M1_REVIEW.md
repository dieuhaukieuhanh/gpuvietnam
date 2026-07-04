# IMPLEMENTATION_REPORT_M1_REVIEW

**Milestone:** M1 Review — Database Schema SCB  
**Architecture Version:** 2.0  
**Date:** 2026-06-28  
**Scope:** Schema refinement only — no business logic, API, UI, M2

---

## Review Summary

Rà soát schema M1 theo `SESSION_CENTRIC_BILLING_ARCHITECTURE.md`, `OPERATIONAL_STATE_MACHINE.md`, ADR-013 (Single SoT), và domain boundaries (Session vs Machine).

**Kết luận:** Schema M1 được **hoàn thiện** với 4 thay đổi chính (loại bỏ 2 cột redundant, thêm 1 CHECK, chuẩn hóa comments). Không thay đổi kiến trúc SCB. Không phát sinh technical debt mới — giảm debt bằng cách loại derived/denormalized columns không cần thiết.

**Verdict:** **Ready for M2** sau khi apply `scb-schema.sql` trên DB dev.

---

## Các điểm đã sửa

| # | Mục | Hành động |
|---|-----|-----------|
| 1 | `provider_instance_id` trên `gpu_sessions` | **Loại bỏ** — ownership thuộc Machine Domain |
| 2 | `billable_seconds` trên `gpu_sessions` | **Loại bỏ** — derived `ended_at − started_at`, không persist |
| 3 | `settlement_breakdown` | **Giữ** — chuẩn hóa comment format JSONB chính thức |
| 4 | CHECK `closed` + `settlement_status` | **Thêm** `gpu_sessions_closed_requires_settlement_status` |
| 5 | `completed` legacy | **Chuẩn hóa comment** — LEGACY STATUS, DO NOT CREATE NEW ROWS |
| 6 | `machines.instance_id` | **Bổ sung comment** — Machine Domain SoT cho provider instance |

---

## Các điểm giữ nguyên

| Mục | Lý do |
|-----|-------|
| `gpu_sessions.status` giữ giá trị `completed` trong CHECK | Legacy rows hiện có; không migrate data (M1 scope) |
| `DEFAULT 'completed'` trên `status` | Không đổi — tránh ảnh hưởng insert path code hiện tại (no business logic change) |
| `duration_seconds` column | Legacy display; commented deprecated — xóa deferred M5+ |
| `machines.billing_started_at` | Legacy tick billing vẫn chạy — M5 scope |
| `settlement_status` superset OSM §7 | Hỗ trợ `awaiting_verify`, `in_progress` — OSM §7 Settlement domain |
| `settlement_status IS NULL` cho `pending`/`running`/`completed` legacy | Hợp lệ — chưa vào terminal `closed` |
| Không CHECK `interrupted` bắt buộc `settlement_status` | OSM cho phép repair path; M3 session-lifecycle sẽ ghi `skipped`/`not_applicable` — enforce DB deferred nếu cần |
| Không validate JSON `settlement_breakdown` | Theo yêu cầu review — comment only |

---

## Lý do từng quyết định

### 1. `provider_instance_id` → Machine Domain

**Quyết định:** Loại khỏi `gpu_sessions`.

**Lý do:**
- `OPERATIONAL_STATE_MACHINE.md` §5 Machine: SoT provider link = `machines.instance_id`.
- `SESSION_CENTRIC_BILLING_ARCHITECTURE.md` §2.1: Provider instance **tồn tại** = live query qua Adapter — không denormalize lên session.
- `gpu_sessions.machine_id` đã có (từ `machines-billing.sql`) — session resolve instance qua join.
- Không có code/runtime sử dụng `provider_instance_id` (grep toàn repo — chỉ schema/docs).
- ADR-007: Adapter verify dùng `machines.instance_id` trong destroy path.

**Không giữ trên session** — tránh dual SoT và vi phạm ADR-013.

### 2. `billable_seconds` → Derived only

**Quyết định:** Loại khỏi schema.

**Lý do:**
- SCB §2.1: billable duration SoT = `ended_at − started_at` (derived).
- SCB INV-9: *"`ended_at − started_at` là nguồn billable duy nhất"*.
- ADR-013: không persist derived value khi không bắt buộc.
- IMPLEMENTATION_PLAN ghi "cache derived" — optional; M2 Remaining và M6 Settlement tính tại runtime.
- Không có runtime ghi/đọc column này.

**M2 impact:** `SettledSessionUsageHours` = `Σ ((ended_at − started_at) / 3600)` WHERE `settlement_status = settled` — không cần column.

### 3. `settlement_breakdown` — JSONB chuẩn hóa

**Quyết định:** Giữ; comment mô tả shape chính thức.

**Lý do:**
- SCB §10.2: audit allocation gift/combo/wallet — cần persist **kết quả** settlement (không phải derived từ timestamps).
- SoT commit vẫn là entitlement tables + `wallet_transactions`; JSONB là **audit snapshot** tại settlement (M6).
- Không JSON validate ở DB — domain layer validate M6.

### 4. CHECK `closed` requires `settlement_status`

**Quyết định:** Thêm constraint.

**Lý do:**
- OSM §4 composite: `closed` luôn đi kèm `settlement_status` (`pending`/`settled`/`skipped`/`failed`).
- OSM diagram: `closed` → settlement sub-state — NULL là invalid steady state.
- Exception: `completed` legacy **không** bị constraint này (chỉ áp `status = 'closed'`).
- `closing` vẫn có thể NULL hoặc `awaiting_verify` — pipeline chưa terminal.

### 5. `completed` — Legacy comment

**Quyết định:** Comment rõ LEGACY; không xóa khỏi CHECK.

**Lý do:**
- Seed + code hiện tại dùng `completed`; xóa enum = breaking data/code.
- M3 session-lifecycle chuyển writes sang `closed`.
- Default `'completed'` giữ nguyên — đổi default = behavior change ngoài scope review.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/gpu-sessions.sql` | Remove `billable_seconds`, `provider_instance_id`; add CHECK closed; update comments |
| `supabase/scb-schema.sql` | DROP removed columns; add CHECK; update comments; header M1 review note |
| `supabase/machines.sql` | Comment `instance_id` as Machine Domain SoT |

**Không thay đổi:** `src/**`, API, UI, `machines-billing.sql`, seed files.

---

## Migration Changed

File: `supabase/scb-schema.sql`

| Operation | Detail |
|-----------|--------|
| `DROP COLUMN IF EXISTS billable_seconds` | gpu_sessions |
| `DROP COLUMN IF EXISTS provider_instance_id` | gpu_sessions |
| `ADD CONSTRAINT gpu_sessions_closed_requires_settlement_status` | `closed` ⇒ `settlement_status IS NOT NULL` |
| Removed `ADD COLUMN` for dropped columns | Idempotent re-run safe |
| Updated all column comments | settlement_breakdown format, completed legacy, verify columns |

**Apply:** Re-run `scb-schema.sql` trên DB đã apply M1 v1.

---

## Schema Diff

### `gpu_sessions` — columns removed

```diff
- billable_seconds          numeric
- provider_instance_id      text
```

### `gpu_sessions` — constraints added

```diff
+ constraint gpu_sessions_closed_requires_settlement_status
+   check (status != 'closed' or settlement_status is not null)
```

### `gpu_sessions` — columns unchanged (SCB)

| Column | Status |
|--------|--------|
| `settlement_status` | Kept |
| `settlement_at` | Kept |
| `settlement_breakdown` | Kept — comment standardized |
| `destroy_reason` | Kept |
| `verified_running_at` | Kept |
| `verified_destroyed_at` | Kept |

### `machines` — no column change

```diff
+ COMMENT ON instance_id — Machine Domain SoT
```

### Billable duration (M2/M6 compute)

```sql
-- Derived at query/settlement time — not persisted
extract(epoch from (ended_at - started_at))::numeric
```

---

## ADR Compliance

| ADR | Review compliance |
|-----|-------------------|
| ADR-001 SCB | Session columns align; no tick schema |
| ADR-002 Single Remaining | Settled usage via `ended_at − started_at` — no duplicate column |
| ADR-003 Verify before settle | `verified_*_at` kept on session (verify event timestamps — session scope) |
| ADR-005 One session/machine | `machine_id` link; instance on machine |
| ADR-007 Provider Adapter | Instance SoT on `machines.instance_id` |
| ADR-008 Correctness | CHECK prevents invalid `closed` without settlement state |
| ADR-009 Session central | Session owns lifecycle + settlement; machine owns provider id |
| ADR-013 Single SoT | **Improved** — removed derived/denormalized columns |
| ADR-014 State machine | CHECK enforces OSM §4 closed composite |
| ADR-015 Docs as truth | Review doc records rationale; no architecture change |

**Không cần ADR mới** — refinements align Architecture 2.0.

---

## SCB Compliance

| SCB requirement | Status |
|-----------------|--------|
| §2.1 Billable time SoT = `started_at`/`ended_at` | Compliant — no `billable_seconds` persist |
| §2.1 Provider existence = Adapter live query | Compliant — no stale denormalize on session |
| §2.2 `duration_seconds` not SoT | Comment retained |
| §3 SettledSessionUsageHours | Compute from timestamps — documented for M2 |
| §4 Session lifecycle states | CHECK values unchanged |
| §6 Settlement fields | `settlement_status`, `settlement_at`, `settlement_breakdown` kept |
| §7 Provider verify timestamps on session | `verified_running_at`, `verified_destroyed_at` kept |
| INV-9 billable from timestamps only | **Enforced** by removing `billable_seconds` |
| §10.2 Audit breakdown JSONB | Standardized comment shape |

---

## Remaining Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| DB đã apply M1 v1 có columns dropped | Low | Re-run `scb-schema.sql` — `DROP IF EXISTS` |
| `IMPLEMENTATION_PLAN_SCB.md` vẫn liệt kê `billable_seconds`, `provider_instance_id` | Low | Plan doc frozen at M1 v1; M2+ implementers đọc review này + SCB §2 |
| `SESSION_CENTRIC_BILLING_ARCHITECTURE.md` §3.1 mentions `billable_seconds` in formula | Low | Formula intent = elapsed seconds; derive from timestamps in M2 |
| Default `status='completed'` on new inserts | Medium | Code vẫn insert `completed`/`running` — M3 normalizes to `closed` |
| Legacy `completed` rows có `settlement_status` NULL | Low | Expected; không phải SCB terminal state |
| `machines_status_check NOT VALID` | Low | Ops validate when ready (unchanged from M1) |
| `interrupted` có thể có `settlement_status` NULL tạm thời | Low | M3 lifecycle writes `skipped`/`not_applicable` |

---

## Ready for M2

| Prerequisite | Status |
|--------------|--------|
| Session lifecycle columns | Ready |
| Settlement columns (without derived cache) | Ready |
| Provider verify timestamps on session | Ready |
| Provider instance via `machines.instance_id` + `machine_id` | Ready |
| CHECK: `closed` requires settlement_status | Ready |
| CHECK: no settled while running | Ready |
| Indexes: running session, settlement retry | Ready |
| Single SoT for billable duration (timestamps) | Ready |
| No redundant columns blocking M2 reads | Ready |

**Verdict: Ready for M2**

M2 `remaining-time.js` có thể:
- Đọc `gpu_sessions` WHERE `settlement_status = 'settled'` và tính `Σ (ended_at − started_at)`.
- Đọc session `running` + `started_at` cho `CurrentSessionBillableElapsed`.
- Resolve provider instance qua `machine_id` → `machines.instance_id` khi cần verify gate (M4).

**Không triển khai M2 trong scope review này.**

---

*GPUVietnam IMPLEMENTATION_REPORT_M1_REVIEW — Architecture 2.0 — 2026-06-28*
