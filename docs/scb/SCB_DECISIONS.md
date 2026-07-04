# SCB_DECISIONS.md

Version: 2.0

---

# Mục tiêu

File này lưu các quyết định kiến trúc (Architecture Decision Records - ADR).

Một khi quyết định đã được ghi ở đây thì:

- Không thay đổi nếu không có lý do đặc biệt.
- Mọi code mới phải tuân theo.
- Nếu thay đổi thì phải thêm một Decision mới, không sửa lịch sử.

---

# Format

## DEC-XXX

### Title

Tên quyết định.

### Status

Accepted

Deprecated

Replaced

Rejected

### Context

Vấn đề cần giải quyết.

### Decision

Quyết định cuối cùng.

### Consequences

Ảnh hưởng.

---

# DEC-001

## SCB là nguồn sự thật duy nhất

Status

Accepted

Context

Logic Session và Billing trước đây bị phân tán nhiều nơi.

Decision

SCB là kiến trúc trung tâm.

Session, Billing, Destroy đều phải đi qua SCB.

Consequences

Không được tạo workflow song song.

---

# DEC-002

## Session Lifecycle bất biến

Status

Accepted

Decision

pending

↓

running

↓

closed

Không có chiều ngược.

Không được reopen.

---

# DEC-003

## started_at chỉ được ghi một lần

Status

Accepted

Decision

started_at được set duy nhất tại:

pending → running

Sau đó immutable.

Consequences

Billing luôn dựa vào started_at.

---

# DEC-004

## Billing chỉ bắt đầu sau Verify

Status

Accepted

Decision

Provider phải xác nhận RUNNING trước.

Không được tính tiền khi provider chưa verify.

---

# DEC-005

## Pending không tính phí

Status

Accepted

Decision

pending chỉ là trạng thái chuẩn bị.

Duration = 0.

Billing = 0.

---

# DEC-006

## Running luôn có started_at

Status

Accepted

Decision

Database CHECK:

running

↓

started_at NOT NULL

---

# DEC-007

## Closed luôn có started_at

Status

Accepted

Decision

Database CHECK:

closed

↓

started_at NOT NULL

---

# DEC-008

## Provider Verify là bắt buộc

Status

Accepted

Decision

Không dùng UI để xác nhận máy chạy.

Chỉ Provider Verify mới hợp lệ.

---

# DEC-009

## Database chỉ bảo vệ dữ liệu

Status

Accepted

Decision

Business logic ở application.

Database chỉ enforce invariant.

---

# DEC-010

## API phải idempotent

Status

Accepted

Decision

Gọi Start nhiều lần.

↓

Không tạo nhiều session.

---

# DEC-011

## Chỉ một Running Session

Status

Accepted

Decision

Một máy chỉ có tối đa một session running.

---

# DEC-012

## Destroy Pipeline thống nhất

Status

Accepted

Decision

Mọi đường Stop đều đi qua Unified Destroy Pipeline.

Không có shortcut.

---

# DEC-013

## Projection không phải Source of Truth

Status

Accepted

Decision

machines.gpu_session_id

chỉ là projection.

Source of Truth:

gpu_sessions

---

# DEC-014

## FK là quan hệ chuẩn

Status

Accepted

Decision

Nếu projection sai,

query theo FK.

---

# DEC-015

## Verify trước Billing

Status

Accepted

Decision

Verify

↓

Activate

↓

Billing

Không đảo thứ tự.

---

# DEC-016

## Session và Billing tách biệt

Status

Accepted

Decision

Session quản lifecycle.

Billing quản thời gian và thanh toán.

Không trộn logic.

---

# DEC-017

## Provider có thể thay thế

Status

Accepted

Decision

SCB không phụ thuộc Vast.ai.

Provider phải đi qua abstraction layer.

---

# DEC-018

## Không lưu Business Logic trong UI

Status

Accepted

Decision

Frontend chỉ hiển thị.

Không quyết định trạng thái.

---

# DEC-019

## Race Condition ưu tiên xử lý từ Server

Status

Accepted

Decision

Lock.

Transaction.

Idempotency.

Không xử lý bằng UI.

---

# DEC-020

## Rebuild sạch thay vì vá Legacy

Status

Accepted

Context

Legacy phát sinh nhiều drift sau nhiều lần sửa.

Decision

Giữ giao diện hiện tại.

Rebuild lại toàn bộ backend theo SCB.

Consequences

Code ít hơn.

Dễ bảo trì.

Ít technical debt.

---

# Quy tắc thêm Decision

Khi phát sinh thay đổi kiến trúc:

1. Thêm DEC mới.
2. Không sửa Decision cũ.
3. Nếu thay thế:
   - Đánh dấu Decision cũ là Replaced.
   - Tạo Decision mới.
4. Cập nhật SCB_CHANGELOG.md.
5. Nếu ảnh hưởng triển khai, cập nhật SCB_IMPLEMENTATION_ROADMAP.md.

---

# Mục tiêu cuối cùng

SCB_DECISIONS.md là "Hiến pháp" của dự án.

Nếu code mâu thuẫn với file này:

→ Code phải sửa.

Không sửa Decision để hợp thức hóa code.