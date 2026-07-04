# IMPLEMENTATION_PLAN_CHANGELOG

**Changelog — IMPLEMENTATION_PLAN_SCB.md**

| | |
|---|---|
| **Phiên bản plan** | 1.0 → **1.1** |
| **Ngày** | 2026-06-28 |
| **Trigger** | [IMPLEMENTATION_REPORT_M1_REVIEW.md](./IMPLEMENTATION_REPORT_M1_REVIEW.md) |

---

## v1.1 — Sau M1 Review

### Tóm tắt

Cập nhật kế hoạch triển khai để phản ánh schema M1 **sau review** — loại bỏ cột redundant, làm rõ Single SoT, bổ sung checklist M3 cho legacy status `completed`.

**Không thay đổi:** thứ tự milestone M1–M14, phụ thuộc milestone, phạm vi M2+.

---

### M1 — Database Schema SCB

| Thay đổi | Chi tiết |
|----------|----------|
| **Loại bỏ** `gpu_sessions.provider_instance_id` | Provider Instance SoT = `machines.instance_id`; session resolve qua `machine_id` |
| **Loại bỏ** `gpu_sessions.billable_seconds` | Billable Duration = derived `ended_at − started_at` — không persist |
| **Bổ sung** bảng “Không có trên gpu_sessions” | Ghi rõ SoT Provider Instance và Billable Duration |
| **Bổ sung** `machines.instance_id` trong M1 | Machine Domain SoT |
| **Cập nhật** `settlement_status` enum | Superset OSM §7 (thêm `not_applicable`, `awaiting_verify`, `in_progress`) |
| **Cập nhật** `settlement_breakdown` | JSONB audit — format trong schema comment |
| **Cập nhật** CHECK constraints | `closed` ⇒ `settlement_status IS NOT NULL` |
| **Cập nhật** `status` / `completed` | Legacy retained in CHECK; không tạo row mới (M3) |
| **Cập nhật** Breaking changes | Schema additive — không breaking runtime hiện tại |
| **Cập nhật** Test cases | T5: reject `closed` + NULL `settlement_status` |
| **Tham chiếu** | Link `IMPLEMENTATION_REPORT_M1_REVIEW.md` |

---

### M3 — Session Lifecycle Domain

| Thay đổi | Chi tiết |
|----------|----------|
| **Bổ sung Checklist** | Loại bỏ tạo session mới với `status='completed'`; chuyển sang SCB lifecycle |
| **Bổ sung checklist items** | Terminal session dùng `closed`; legacy `completed` không migrate bắt buộc |

---

### M4 — Provider Verification Module

| Thay đổi | Chi tiết |
|----------|----------|
| **Database thay đổi** | Bỏ ghi `provider_instance_id` trên session; resolve qua `machines.instance_id` |

*Chỉ sửa mô tả factual — phạm vi milestone không đổi.*

---

### M6 — Settlement Engine

| Thay đổi | Chi tiết |
|----------|----------|
| **Objective** | Billable duration derive từ timestamps — không persist column |
| **Database write** | Bỏ `billable_seconds` khỏi danh sách write |

*Chỉ sửa mô tả factual — phạm vi milestone không đổi.*

---

### Không thay đổi (v1.1)

| Milestone | Ghi chú |
|-----------|---------|
| M2 | Remaining Time — đã implicit dùng timestamps; không sửa plan |
| M5 | Loại bỏ per-minute billing |
| M7–M14 | Phạm vi giữ nguyên |
| API response `billableSeconds` (M9/M12) | Field **derived tại API** — không phải DB column; giữ nguyên |

---

### Lý do thay đổi (ADR / SCB)

| Quyết định | Căn cứ |
|------------|--------|
| Provider instance trên `machines` | OSM §5 Machine SoT; ADR-007, ADR-013 |
| Không persist `billable_seconds` | SCB §2.1, INV-9; ADR-013 Single SoT |
| `completed` legacy only | M1 Review — backward compat; M3 writes `closed` |
| CHECK `closed` + settlement | OSM §4 composite state |

---

### Tài liệu liên quan

- [IMPLEMENTATION_REPORT_M1.md](./IMPLEMENTATION_REPORT_M1.md) — M1 initial
- [IMPLEMENTATION_REPORT_M1_REVIEW.md](./IMPLEMENTATION_REPORT_M1_REVIEW.md) — M1 review chi tiết
- [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) — plan v1.1

---

*v1.1 — 2026-06-28*
