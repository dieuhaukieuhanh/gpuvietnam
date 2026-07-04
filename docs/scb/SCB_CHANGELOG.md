# SCB_CHANGELOG.md

Version: 2.0

Status: Active

---

# Mục tiêu

Lưu toàn bộ thay đổi quan trọng của hệ thống theo thời gian.

Không thay thế Git history.

Không ghi các thay đổi nhỏ như:

- sửa CSS
- đổi tên biến
- format code
- comment
- refactor nhỏ

Chỉ ghi những thay đổi ảnh hưởng tới:

- Architecture
- Database
- Runtime
- API
- Session
- Billing
- Settlement
- Destroy Pipeline
- Provider
- Workflow

---

# Quy tắc

Mỗi thay đổi phải có:

- Ngày
- Version
- Module
- Lý do
- Nội dung thay đổi
- Ảnh hưởng
- Người thực hiện

---

# Format

## YYYY-MM-DD

### Version

vX.X.X

### Module

Ví dụ:

- Architecture
- Database
- Session
- Billing
- Settlement
- Provider
- API
- Frontend

### Reason

Tại sao cần thay đổi.

### Change

Đã thay đổi điều gì.

### Impact

Ảnh hưởng tới phần nào của hệ thống.

### Author

Developer

Cursor

ChatGPT

---

# CHANGELOG

---

## 2026-07-04

### Version

v3.0

### Module

Database

### Reason

SCB 3.0 rebuild — establish Database foundation as Single Source of Truth (M2).

### Change

M2 — Database Rebuild (additive, backward compatible):
- gpu_sessions canonical rewritten: status DEFAULT 'pending'; started_at nullable; machine_id folded into canonical (FK machines); SCB 3.0 invariants added (pending has no started_at; running requires started_at/machine_id/verified_running_at; closed requires started_at/ended_at/verified_destroyed_at/settlement_status); partial unique index gpu_sessions_one_running_per_user (DEC-011); duration_seconds marked DEPRECATED.
- machines canonical rewritten: gpu_session_id + billing_inventory_id folded into canonical; reverse FK to gpu_sessions added; billing_started_at + closing_started_at marked DEPRECATED (retained until M3/M6); status CHECK kept wide (closing retained for M2 compat).
- scb-schema.sql rewritten as single M2 migration: additive only, no DROP, no status CHECK narrowing; new constraints NOT VALID (skip existing rows, check future writes); folds scb-schema-started-at-nullable.sql; reverse FK NOT VALID.
- seed-gpu-sessions.sql rewritten: seeds use status='closed' + settlement_status='settled' + verified_destroyed_at (SCB 3.0 terminal).
- scb-schema-started-at-nullable.sql, scb-schema-apply-nodrop.sql, machines-billing.sql marked SUPERSEDED (retained for audit, not applied).

### Impact

Database foundation matches SCB 3.0 (Truth = gpu_sessions; Machine = projection). Runtime unaffected: legacy statuses (completed/interrupted/closing) still accepted by the wide CHECK until M3 narrows it. New additive constraints enforce SCB 3.0 invariants on all future writes (verified safe against current session-start.js / session-lifecycle.js / destroy-pipeline-run.js write paths).

### Author

Cursor

---

## 2026-07-04

### Version

v2.0

### Module

Architecture

### Reason

Legacy runtime phát sinh nhiều race condition và logic chồng chéo sau nhiều lần vá lỗi.

### Change

Quyết định dừng sửa hệ thống cũ.

Bắt đầu kế hoạch Rebuild toàn bộ Backend theo kiến trúc SCB.

Giữ nguyên UI.

### Impact

Toàn bộ Session Runtime sẽ được viết lại.

Billing chuyển sang Session-Centric.

### Author

Developer + ChatGPT

---

## 2026-07-04

### Version

v2.0

### Module

Database

### Reason

SCB yêu cầu pending session chưa có started_at.

### Change

started_at chuyển thành nullable.

Thêm CHECK:

running → started_at NOT NULL

closed → started_at NOT NULL

Không thêm CHECK:

pending → started_at NULL

để giữ khả năng mở rộng cho placeholder trong tương lai.

### Impact

Cho phép tạo Pending Session đúng kiến trúc SCB.

### Author

ChatGPT

---

## 2026-07-04

### Version

v2.0

### Module

Architecture

### Reason

Chuẩn hóa tài liệu dự án.

### Change

Tạo bộ tài liệu chuẩn:

README.md

SCB_ARCHITECTURE.md

SCB_IMPLEMENTATION_ROADMAP.md

SCB_WORKLOG.md

SCB_CHANGELOG.md

SCB_DECISIONS.md

SCB_TEST_PLAN.md

AI_WORKFLOW.md

### Impact

Toàn bộ AI Coding Agent sẽ sử dụng cùng một bộ tài liệu chuẩn.

### Author

ChatGPT

---

## 2026-07-04

### Version

v2.0

### Module

Roadmap

### Reason

Chuẩn hóa quá trình rebuild.

### Change

Dự án được chia thành các milestone:

M1 → M20

Mỗi milestone:

Build

↓

Test

↓

Verify

↓

Commit

### Impact

Không còn sửa nhiều module cùng lúc.

Dễ rollback.

Dễ review.

### Author

ChatGPT

---

# Future Entries

Ví dụ:

---

## 2026-07-20

### Version

v2.1

### Module

Provider

### Reason

Hỗ trợ nhiều nhà cung cấp GPU.

### Change

Thêm Provider Adapter cho RunPod.

### Impact

SCB hoạt động với nhiều Provider.

### Author

Developer

---

## 2026-08-02

### Version

v2.2

### Module

Billing

### Reason

Thêm Hour Wallet.

### Change

Billing Engine chuyển sang Wallet-based.

### Impact

Không ảnh hưởng Session Runtime.

### Author

Developer

---

## 2026-08-15

### Version

v2.3

### Module

API

### Reason

Tối ưu hiệu năng.

### Change

Status API chuyển sang aggregate mới.

### Impact

Frontend không thay đổi.

### Author

Developer

---

# Không ghi vào ChangeLog

Không ghi:

- Fix typo
- Đổi CSS
- Đổi icon
- Đổi tên biến
- Format code
- Refactor nhỏ
- Comment
- Logging tạm

Những thay đổi này để Git quản lý.

---

# Chỉ ghi

✓ Architecture

✓ Database Schema

✓ API Contract

✓ Session Lifecycle

✓ Billing Lifecycle

✓ Settlement

✓ Destroy Pipeline

✓ Authentication

✓ Provider Integration

✓ Workflow

✓ Breaking Change

---

# Quy tắc cập nhật

Sau mỗi milestone hoàn thành:

1. Cập nhật SCB_CHANGELOG.md.
2. Nếu thay đổi kiến trúc:
   - cập nhật SCB_DECISIONS.md.
3. Nếu thay đổi kế hoạch:
   - cập nhật SCB_IMPLEMENTATION_ROADMAP.md.
4. Nếu thay đổi trạng thái:
   - cập nhật SCB_WORKLOG.md.

---

# Mục tiêu cuối cùng

SCB_CHANGELOG.md là lịch sử chính thức của dự án.

Bất kỳ thay đổi nào ảnh hưởng đến kiến trúc hoặc hành vi của hệ thống đều phải được ghi lại tại đây trước khi phát hành.