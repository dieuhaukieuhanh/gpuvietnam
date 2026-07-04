# SCB_IMPLEMENTATION_ROADMAP.md

Version: 1.0

Status: Active

Architecture:
SCB Architecture 2.0

---

# Purpose

Tài liệu này mô tả trình tự triển khai SCB Architecture.

Mọi thay đổi phải tuân thủ đúng thứ tự các Phase.

Không được bỏ qua hoặc đảo thứ tự nếu chưa có quyết định kiến trúc mới.

---

# Overall Strategy

Đây là một **rebuild có kiểm soát**, không phải vá lỗi (patch).

## Giữ lại

- UI
- Authentication
- Vast integration
- Inventory
- Subscription
- Database schema (SCB)
- API contract

## Loại bỏ

- Legacy lifecycle
- Legacy billing flow
- Legacy recovery
- Legacy synchronization
- Hotfix
- Temporary workaround

---

# Architecture Goal

```
UI
        │
        ▼
API
        │
        ▼
Orchestrator
        │
        ▼
Domain
        │
        ▼
Repository
        │
        ▼
Supabase
        │
        ▼
Provider
```

Business logic chỉ tồn tại trong Domain + Orchestrator.

---

# Phase Overview

| Phase | Name | Status |
|--------|------|--------|
| 0 | Freeze | ☐ |
| 1 | Database | ☐ |
| 2 | Session Domain | ☐ |
| 3 | Billing Domain | ☐ |
| 4 | Provider Verify | ☐ |
| 5 | Session Start | ☐ |
| 6 | Session Stop | ☐ |
| 7 | API Simplification | ☐ |
| 8 | Projection | ☐ |
| 9 | Recovery | ☐ |
|10 | Cleanup | ☐ |
|11 | Testing | ☐ |
|12 | Production Hardening | ☐ |

---

# Phase 0 — Freeze

## Goal

Đóng băng codebase trước khi rebuild.

## Tasks

- Backup repository
- Tag current commit
- Không thêm feature mới
- Không sửa UI

## Deliverable

Điểm rollback an toàn.

---

# Phase 1 — Database

## Goal

Database tuân thủ SCB.

## Checklist

- [ ] started_at nullable
- [ ] running requires started_at
- [ ] closed requires started_at
- [ ] settlement constraints
- [ ] status constraints
- [ ] FK verification
- [ ] indexes verification
- [ ] RLS verification

## Deliverable

Database trở thành nền tảng ổn định.

---

# Phase 2 — Session Domain

## Goal

Xây dựng state machine thuần.

## Files

session-lifecycle.js

## Responsibilities

- Pending
- Running
- Closing
- Closed
- Interrupt
- Destroy

## Forbidden

- Supabase
- API
- Provider
- HTTP
- Billing

## Deliverable

Pure deterministic state machine.

---

# Phase 3 — Billing Domain

## Goal

Tách billing khỏi lifecycle.

## Files

billing.js

## Responsibilities

- Resolve billing anchor
- Plan ordering
- Settlement helper
- Projection helper

## Forbidden

- Provider API
- HTTP
- Session lifecycle

## Deliverable

Billing độc lập.

---

# Phase 4 — Provider Verify

## Goal

Một gateway duy nhất xác nhận trạng thái Provider.

## Files

provider-verify.js

## Responsibilities

- verifyRunning()
- verifyStopped()
- healthCheck()
- verifyPort()

## Forbidden

- Billing
- Session mutation
- Projection

## Deliverable

Provider abstraction.

---

# Phase 5 — Session Start

## Goal

Một orchestration duy nhất để bắt đầu session.

## Files

session-start.js

## Flow

Verify

↓

Create Pending

↓

Activate Running

↓

Projection Update

↓

Return

## Forbidden

- Legacy fallback chain
- Duplicate insert
- Duplicate activation
- Manual recovery

## Deliverable

Một happy path duy nhất.

---

# Phase 6 — Session Stop

## Goal

Pipeline destroy chuẩn.

## Files

destroy-pipeline.js

## Flow

Resolve

↓

Backup

↓

Close Session

↓

Destroy Provider

↓

Settlement

↓

Projection Cleanup

↓

Finish

## Deliverable

Destroy pipeline thống nhất.

---

# Phase 7 — API Simplification

## Goal

API chỉ là controller.

## Files

app/api/**

## Responsibilities

- Validate request
- Call orchestrator
- Return JSON

## Forbidden

- Billing logic
- Session logic
- Provider logic

## Deliverable

Thin API.

---

# Phase 8 — Projection

## Goal

Projection chỉ phản ánh trạng thái.

## Tables

machines

subscriptions

## Projection Fields

- gpu_session_id
- billing_started_at
- remaining_hours
- status

Không được xem là source of truth.

---

# Phase 9 — Recovery

## Goal

Recovery tối thiểu.

## Responsibilities

- Projection drift
- Pending recovery
- Interrupted destroy

## Forbidden

- Sửa truth
- Billing recalculation
- Session rewrite

---

# Phase 10 — Cleanup

## Goal

Xóa toàn bộ legacy.

## Remove

- Legacy lifecycle
- Legacy billing
- Legacy sync
- Hotfix
- Deprecated code
- Dead code
- Duplicate flow

## Deliverable

Codebase sạch.

---

# Phase 11 — Testing

## Unit Tests

- Session lifecycle
- Billing
- Provider verify
- Destroy

## Integration Tests

- Start
- Running
- Stop
- Destroy

## Regression Tests

- Browser refresh
- Server restart
- Double click Start
- Duplicate request
- Projection drift
- BUG1
- BUG2

## Deliverable

Không còn regression.

---

# Phase 12 — Production Hardening

## Logging

- Structured logging
- Correlation ID

## Monitoring

- Health endpoint
- Metrics
- Alert

## Retry

- Provider retry
- Timeout policy

## Deliverable

Production ready.

---

# Build Rules

## Always

- Một lifecycle
- Một billing flow
- Một projection flow

## Never

- Duplicate logic
- Hidden side effect
- Circular dependency
- Business logic trong API

---

# Definition of Done

Một Phase chỉ được đánh dấu hoàn thành khi:

- Checklist hoàn thành
- Regression test pass
- Không tạo technical debt mới
- Không vi phạm SCB Architecture

---

# Final Success Criteria

- Không còn legacy lifecycle.
- Billing có một nguồn sự thật.
- Session có một state machine.
- Projection có thể rebuild.
- API mỏng.
- UI giữ nguyên.
- Khởi động lại server an toàn.
- Refresh trình duyệt không tạo session mới.
- Double-click Start không tạo session trùng.
- Destroy luôn idempotent.
- Hệ thống sẵn sàng triển khai production.