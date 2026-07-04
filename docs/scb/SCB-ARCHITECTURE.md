# SCB_ARCHITECTURE.md

Version: 3.0

Status: Authoritative (Single Source of Truth)

Project: GPUVietnam

Last Updated: 2026-07

Authoritative Level: Architecture

---

# 1. Introduction

## 1.1 Purpose

SCB (Session-Centric Billing) là kiến trúc trung tâm của toàn bộ hệ thống GPUVietnam.

Mọi hành vi của hệ thống phải được thiết kế xoay quanh **GPU Session**.

Session là đối tượng phản ánh sự thật (Truth).

Machine, Subscription, Billing Projection hay UI chỉ phản ánh (Projection) trạng thái của Session.

SCB được xây dựng nhằm:

- loại bỏ duplicate logic
- loại bỏ nhiều nguồn sự thật
- đảm bảo Billing chính xác
- dễ recovery
- dễ audit
- dễ mở rộng Provider
- dễ mở rộng Business Model
- giảm coupling giữa các module

SCB không phải là implementation.

SCB là kiến trúc.

Mọi implementation đều phải tuân thủ kiến trúc này.

---

## 1.2 Scope

SCB quản lý:

- Session Lifecycle
- Billing Lifecycle
- Machine Lifecycle
- Destroy Lifecycle
- Provider Verification
- Projection Synchronization
- Recovery
- Settlement

SCB không quản lý:

- React UI
- CSS
- Authentication
- Payment Gateway
- Marketing Logic
- Analytics

---

## 1.3 Design Goals

Hệ thống phải đạt được các mục tiêu sau:

### Predictable

Một hành động luôn tạo ra cùng một kết quả.

Không tồn tại hidden behavior.

---

### Recoverable

Mọi projection đều có thể rebuild.

Không cần restore database để sửa projection.

---

### Observable

Mọi thay đổi phải có log.

Mọi transition đều trace được.

---

### Provider Independent

Không phụ thuộc Vast.

Không phụ thuộc RunPod.

Không phụ thuộc Lambda.

Provider chỉ là implementation.

---

### Stateless API

API không giữ trạng thái.

State nằm trong Domain.

---

### Single Business Flow

Không tồn tại:

Start Flow A

Start Flow B

Start Flow Legacy

Chỉ có một flow duy nhất.

---

## 1.4 SCB 3.4B — Settlement Transaction RPC

Kiến trúc SCB (Architecture 2.0) mô tả Settlement ở mức domain (§6,
[SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md)).
Từ milestone **SCB 3.4B**, transaction boundary settlement được đóng băng chi tiết:

- **W2–W7** (claim → wallet debit → ledger insert → entitlement CAS →
  projection sync → finalize) là **một transaction atomic server-side duy nhất**
  trong RPC `settle_session_transaction(payload json)` (PL/pgSQL, PostgREST).
- **W1** và **W8–W11** nằm ngoài transaction.
- JS (`settlement.js`) giữ toàn bộ business math (eligibility, allocation,
  billable seconds, breakdown) và orchestrate; RPC là pure transaction executor.
- Replay boundary = một RPC call. Idempotency: `settlement_status` claim guard
  (primary) + `wallet_transactions.idempotency_key` partial unique index
  (defence-in-depth). CAS entitlement giữ nguyên, thực hiện trong RPC.
- Projection sync (`user_plan_inventory`) thực hiện trong RPC (W6), inside T.

Tài liệu frozen:
- [`docs/scb/SCB_3_4_SPECIFICATION_FREEZE.md`](./scb/SCB_3_4_SPECIFICATION_FREEZE.md)
- [`docs/scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md`](./scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md)
- [`docs/scb/SCB_3_4B_COMPLETION_REPORT.md`](./scb/SCB_3_4B_COMPLETION_REPORT.md)

SCB 3.4B là refactor atomicity trong Architecture 2.0 (không đổi Billing Model,
không đổi state machine, không đổi SoT) — nằm trong nhóm "Allowed Changes"
của [ARCHITECTURE_VERSION.md](./ARCHITECTURE_VERSION.md).

---

# 2. Design Philosophy

## 2.1 Session-Centric

Triết lý quan trọng nhất của SCB:

> Billing tồn tại vì Session.

Không phải:

Billing tồn tại vì Machine.

Không phải:

Billing tồn tại vì Subscription.

Không phải:

Billing tồn tại vì Timer.

Machine có thể bị destroy.

Subscription có thể đổi.

Projection có thể rebuild.

Nhưng Session vẫn là lịch sử bất biến.

---

## 2.2 Truth vs Projection

SCB phân biệt rất rõ:

Truth

và

Projection.

Truth:

Là dữ liệu gốc.

Projection:

Là dữ liệu được suy ra từ Truth.

Projection có thể sai.

Projection có thể rebuild.

Truth không được phép sửa để khớp Projection.

Luôn làm ngược lại.

---

## 2.3 Immutable First

Sau khi một Session bước vào Running:

Các thuộc tính sau không được thay đổi:

- Session ID
- User ID
- Machine ID
- started_at

Bất kỳ đoạn code nào sửa các giá trị trên đều là bug.

---

## 2.4 Explicit State Machine

SCB không sử dụng implicit state.

Không có:

```
if (...)
```

để đoán trạng thái.

Trạng thái luôn được khai báo rõ ràng.

Ví dụ:

Pending

↓

Running

↓

Closing

↓

Closed

Không tồn tại transition ngoài sơ đồ.

---

## 2.5 Business Logic Lives In Domain

Business Rule chỉ được tồn tại trong Domain.

Không được đặt tại:

API

Repository

Provider

React

Hook

Component

Middleware

---

# 3. Core Principles

## Principle 1

Single Source of Truth

Truth duy nhất:

gpu_sessions

Không được phép sử dụng:

machines.billing_started_at

để tính Billing.

---

## Principle 2

Projection Is Disposable

Projection có thể xóa.

Projection có thể rebuild.

Projection không bao giờ là Truth.

Projection gồm:

- machines
- subscription cache
- billing_started_at
- gpu_session_id
- remaining_hours

---

## Principle 3

Verification Before Billing

Billing chỉ được phép bắt đầu sau khi Provider Verify PASS.

Không tồn tại Billing trước Verify.

---

## Principle 4

One Lifecycle

Chỉ tồn tại một Session Lifecycle.

Không tồn tại:

Legacy Session

Temporary Session

Fast Session

Background Session

---

## Principle 5

One Orchestrator

Mỗi Business Flow chỉ có một Orchestrator.

Ví dụ:

Start Session

↓

Session Start Orchestrator

Destroy

↓

Destroy Pipeline

Không được gọi chéo nhiều nơi.

---

## Principle 6

Provider Is Replaceable

Provider chỉ biết:

Create

Verify

Destroy

Không biết:

Billing

Settlement

Projection

Subscription

---

## Principle 7

Database Enforces Invariants

Business Rule được enforce hai lớp.

Layer 1:

Domain

Layer 2:

Database Constraint

Không phụ thuộc duy nhất vào code.

---

# 4. High-Level System Overview

```
                 +----------------------+
                 |      React UI        |
                 +----------+-----------+
                            |
                            v
                 +----------------------+
                 |        API           |
                 +----------+-----------+
                            |
                            v
                 +----------------------+
                 |    Orchestrator      |
                 +----------+-----------+
                            |
            +---------------+----------------+
            |                                |
            v                                v
   +----------------+              +------------------+
   | Session Domain |              | Billing Domain   |
   +----------------+              +------------------+
            |                                |
            +---------------+----------------+
                            |
                            v
                 +----------------------+
                 |    Repository        |
                 +----------+-----------+
                            |
                            v
                 +----------------------+
                 |      Supabase        |
                 +----------+-----------+
                            |
                            v
                 +----------------------+
                 | Provider Verify Port |
                 +----------+-----------+
                            |
                            v
              +-------------------------------+
              | Vast / RunPod / Lambda / ... |
              +-------------------------------+
```

---

## Layer Responsibilities

### UI

Hiển thị.

Không chứa Business Logic.

---

### API

Validate Request.

Gọi Orchestrator.

Trả JSON.

---

### Orchestrator

Điều phối Business Flow.

Không chứa Persistence Logic.

---

### Domain

Chứa toàn bộ Business Rule.

Là nơi duy nhất quyết định:

- Session State
- Billing State
- Settlement State

---

### Repository

Đọc.

Ghi.

Update.

Không chứa Business Rule.

---

### Database

Lưu Truth.

Enforce Constraint.

---

### Provider

Tạo máy.

Destroy máy.

Verify máy.

Không tham gia Billing.

---

> **Kết thúc Phần 1 (Sections 1–4).**
>
> Phần tiếp theo sẽ bắt đầu với **5. Domain Model**, **6. State Machines**, **7. Session Lifecycle**, **8. Machine Lifecycle** và **9. Billing Lifecycle**.
# SCB_CHANGELOG.md

Version: 2.0

---

# Mục tiêu

Lưu toàn bộ thay đổi quan trọng của hệ thống theo thời gian.

Không ghi commit Git.

Không ghi sửa CSS.

Không ghi refactor nhỏ.

Chỉ ghi những thay đổi ảnh hưởng tới kiến trúc, database, workflow hoặc business logic.

---

# Quy tắc

Mỗi thay đổi phải ghi:

- Ngày
- Version
- Module
- Lý do
- Thay đổi
- Ảnh hưởng
- Người thực hiện

---

# FORMAT

## yyyy-mm-dd

### Version

vX.X

### Module

Ví dụ:

Session

Billing

Destroy Pipeline

Provider

Database

API

Frontend

### Reason

Tại sao phải thay đổi.

### Change

Mô tả ngắn gọn.

### Impact

Ảnh hưởng tới hệ thống.

### Author

Cursor

ChatGPT

Developer

---

# CHANGELOG

---

## 2026-07-04

### Version

v2.0

### Module

Database

### Reason

SCB yêu cầu pending session chưa có started_at.

### Change

started_at được chuyển thành nullable.

Thêm CHECK:

running -> started_at NOT NULL

closed -> started_at NOT NULL

### Impact

Cho phép tạo pending session đúng lifecycle.

### Author

ChatGPT

---

## 2026-07-04

### Version

v2.0

### Module

Architecture

### Reason

Logic cũ phát sinh quá nhiều race condition.

### Change

Quyết định rebuild toàn bộ Session/Billing theo SCB.

### Impact

Loại bỏ toàn bộ legacy workflow.

### Author

Developer + ChatGPT

---

## 2026-07-04

### Version

v2.0

### Module

Roadmap

### Reason

Dự án chuyển sang chiến lược Clean Rebuild.

### Change

Chia dự án thành các milestone:

M1

M2

...

M10

### Impact

Dễ review.

Rollback đơn giản.

### Author

ChatGPT

---

# Future Entries

Ví dụ:

## 2026-07-15

Version:

v2.1

Module:

Billing

Reason:

Thêm Hour Wallet.

Change:

Billing engine chuyển sang wallet-based.

Impact:

Không ảnh hưởng Session.

Author:

Cursor

---

## 2026-08-01

Version:

v2.2

Module:

Provider

Reason:

Hỗ trợ Runpod.

Change:

Provider abstraction.

Impact:

Không ảnh hưởng Billing.

---

# Không ghi vào changelog

Không ghi:

Fix typo

Đổi tên biến

Refactor nhỏ

Đổi CSS

Đổi icon

Format code

Comment

Những thay đổi này để Git quản lý.

---

# Chỉ ghi

✓ Database

✓ API contract

✓ Workflow

✓ Session lifecycle

✓ Billing lifecycle

✓ Destroy pipeline

✓ Authentication

✓ Provider integration

✓ Kiến trúc
# SCB_TEST_PLAN.md

Version: 2.0

---

# Mục tiêu

Đảm bảo toàn bộ kiến trúc SCB hoạt động đúng trước khi triển khai production.

Mọi milestone chỉ được coi là hoàn thành khi toàn bộ test liên quan PASS.

---

# Quy tắc kiểm thử

Mỗi test phải có:

- ID
- Module
- Điều kiện
- Các bước
- Kết quả mong đợi
- PASS / FAIL
- Ghi chú

---

# Trạng thái

| Status | Ý nghĩa |
|---------|----------|
| PASS | Hoạt động đúng |
| FAIL | Có lỗi |
| BLOCKED | Chưa thể kiểm thử |
| SKIPPED | Không áp dụng |

---

# M1 — Database

## DB-001

Mục tiêu:

Tạo pending session.

Kỳ vọng:

Insert thành công.

started_at = NULL

status = pending

PASS □

---

## DB-002

Activate session.

Kỳ vọng:

status

pending

↓

running

started_at được ghi đúng 1 lần.

PASS □

---

## DB-003

Không cho phép:

running

started_at NULL

Database phải reject.

PASS □

---

## DB-004

Không cho phép:

closed

started_at NULL

PASS □

---

# M2 — Session Lifecycle

## SES-001

Create pending.

PASS □

---

## SES-002

Activate running.

PASS □

---

## SES-003

Interrupt pending.

PASS □

---

## SES-004

Close running.

PASS □

---

## SES-005

Không được activate hai lần.

PASS □

---

## SES-006

started_at immutable.

PASS □

---

# M3 — Billing

## BILL-001

Billing chỉ bắt đầu sau verify.

PASS □

---

## BILL-002

Không tính tiền khi pending.

PASS □

---

## BILL-003

Close session.

Duration đúng.

PASS □

---

## BILL-004

Settlement chạy đúng.

PASS □

---

## BILL-005

Double settlement bị chặn.

PASS □

---

# M4 — Provider

## PROV-001

Start machine.

PASS □

---

## PROV-002

Verify running.

PASS □

---

## PROV-003

Health check.

PASS □

---

## PROV-004

Destroy machine.

PASS □

---

## PROV-005

Verify destroyed.

PASS □

---

# M5 — API

## API-001

POST /start

PASS □

---

## API-002

POST /stop

PASS □

---

## API-003

GET /status

PASS □

---

## API-004

Idempotency.

PASS □

---

# M6 — Destroy Pipeline

## DEST-001

Destroy bình thường.

PASS □

---

## DEST-002

Destroy khi provider timeout.

PASS □

---

## DEST-003

Destroy retry.

PASS □

---

## DEST-004

Billing đóng đúng.

PASS □

---

## DEST-005

Session đóng đúng.

PASS □

---

# M7 — Race Condition

## RACE-001

Spam Start.

PASS □

---

## RACE-002

Spam Stop.

PASS □

---

## RACE-003

Start + Stop đồng thời.

PASS □

---

## RACE-004

Refresh browser liên tục.

PASS □

---

## RACE-005

Hai request status đồng thời.

PASS □

---

# M8 — Recovery

## REC-001

Restart server.

PASS □

---

## REC-002

Crash giữa activate.

PASS □

---

## REC-003

Crash giữa destroy.

PASS □

---

## REC-004

Reconnect.

PASS □

---

# M9 — UI

## UI-001

Loading.

PASS □

---

## UI-002

Running.

PASS □

---

## UI-003

Stopping.

PASS □

---

## UI-004

Destroyed.

PASS □

---

# Regression Checklist

Sau mỗi milestone phải chạy lại:

□ Start machine

□ Verify running

□ Billing start

□ Status API

□ Stop machine

□ Destroy

□ Settlement

□ Billing stop

□ Refresh browser

□ Reconnect

Nếu bất kỳ mục nào FAIL:

→ Không merge.

---

# Release Checklist

Trước Production:

□ Toàn bộ test PASS

□ Không còn TODO quan trọng

□ Không còn FIXME

□ Không còn console.error

□ Không còn race condition đã biết

□ Migration chạy sạch

□ Database schema đúng

□ API contract ổn định

□ Tài liệu cập nhật

□ Changelog cập nhật

□ Worklog cập nhật

---

# Mục tiêu cuối cùng

Khi toàn bộ checklist đều PASS:

SCB được coi là sẵn sàng Production.

Mọi thay đổi sau đó phải thông qua:

Architecture → Roadmap → Development → Test → Changelog → Release.