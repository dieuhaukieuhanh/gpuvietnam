# SCB_TEST_PLAN.md

Version: 2.0

Status: Active

---

# Mục tiêu

Đảm bảo toàn bộ kiến trúc Session-Centric Billing (SCB) hoạt động đúng trước khi đưa vào Production.

Mọi milestone chỉ được coi là hoàn thành khi toàn bộ test liên quan đều PASS.

Không được bỏ qua bất kỳ bài kiểm thử quan trọng nào.

---

# Nguyên tắc kiểm thử

- Test theo đúng thứ tự Milestone.
- Không test tính năng chưa hoàn thành.
- Không sửa test để hợp thức hóa code.
- Nếu test FAIL → sửa code.
- Sau mỗi milestone phải chạy Regression Test.

---

# Quy trình kiểm thử

Mỗi test case phải có:

- ID
- Module
- Mục tiêu
- Điều kiện
- Các bước thực hiện
- Kết quả mong đợi
- Trạng thái

---

# Trạng thái

| Status | Ý nghĩa |
|---------|----------|
| PASS | Hoạt động đúng |
| FAIL | Có lỗi |
| BLOCKED | Chưa đủ điều kiện kiểm thử |
| SKIPPED | Không áp dụng |

---

# M1 — Database

## DB-001

Tên:

Create Pending Session

Kỳ vọng:

- Insert thành công
- status = pending
- started_at = NULL

PASS □

---

## DB-002

Tên:

Activate Running

Kỳ vọng:

pending

↓

running

started_at được ghi đúng một lần.

PASS □

---

## DB-003

Tên:

Reject Running Without started_at

Kỳ vọng:

Database từ chối.

PASS □

---

## DB-004

Tên:

Reject Closed Without started_at

Kỳ vọng:

Database từ chối.

PASS □

---

## DB-005

Tên:

Migration Idempotent

Kỳ vọng:

Chạy migration nhiều lần không lỗi.

PASS □

---

# M2 — Session Lifecycle

## SES-001

Create Pending Session

PASS □

---

## SES-002

Activate Running

PASS □

---

## SES-003

Interrupt Pending

PASS □

---

## SES-004

Close Running

PASS □

---

## SES-005

Không được Activate hai lần.

PASS □

---

## SES-006

started_at phải Immutable.

PASS □

---

## SES-007

Không tạo hai Running Session.

PASS □

---

# M3 — Billing

## BILL-001

Billing chỉ bắt đầu sau Verify.

PASS □

---

## BILL-002

Pending không tính giờ.

PASS □

---

## BILL-003

Duration chính xác.

PASS □

---

## BILL-004

Settlement chạy đúng.

PASS □

---

## BILL-005

Không Settlement hai lần.

PASS □

---

## BILL-006

Billing Anchor đúng Session.

PASS □

---

# M4 — Provider

## PROV-001

Start Machine

PASS □

---

## PROV-002

Verify Running

PASS □

---

## PROV-003

Health Check

PASS □

---

## PROV-004

Destroy Machine

PASS □

---

## PROV-005

Verify Destroyed

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

Idempotency

PASS □

---

## API-005

Retry Safety

PASS □

---

# M6 — Destroy Pipeline

## DEST-001

Destroy bình thường.

PASS □

---

## DEST-002

Destroy khi Provider timeout.

PASS □

---

## DEST-003

Retry Destroy.

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

## DEST-006

Projection cập nhật đúng.

PASS □

---

# M7 — Race Condition

## RACE-001

Spam Start

PASS □

---

## RACE-002

Spam Stop

PASS □

---

## RACE-003

Start + Stop đồng thời.

PASS □

---

## RACE-004

Refresh Browser liên tục.

PASS □

---

## RACE-005

Hai Status Request đồng thời.

PASS □

---

## RACE-006

Retry Request.

PASS □

---

# M8 — Recovery

## REC-001

Restart Server

PASS □

---

## REC-002

Crash giữa Activate

PASS □

---

## REC-003

Crash giữa Destroy

PASS □

---

## REC-004

Reconnect

PASS □

---

## REC-005

Projection Rebuild

PASS □

---

# M9 — Frontend

## UI-001

Loading Screen

PASS □

---

## UI-002

Running Screen

PASS □

---

## UI-003

Stopping Screen

PASS □

---

## UI-004

Destroyed Screen

PASS □

---

## UI-005

Refresh vẫn đúng trạng thái.

PASS □

---

# Regression Checklist

Sau mỗi milestone phải chạy lại:

□ Start Machine

□ Verify Running

□ Billing Start

□ Billing Stop

□ Status API

□ Refresh Browser

□ Reconnect

□ Stop Machine

□ Destroy Machine

□ Settlement

Nếu có bất kỳ FAIL:

→ Không Merge.

---

# Production Checklist

Trước khi Release:

□ Toàn bộ Test PASS

□ Không còn TODO

□ Không còn FIXME

□ Không còn Console Error

□ Không còn Legacy Billing

□ Không còn Race Condition đã biết

□ Database Migration sạch

□ API Contract ổn định

□ Documentation cập nhật

□ ChangeLog cập nhật

□ WorkLog cập nhật

□ Decisions cập nhật

---

# Quy tắc bổ sung Test

Khi có tính năng mới:

1. Thêm Test Case.
2. Không xóa Test cũ.
3. Nếu sửa hành vi hệ thống:
   - cập nhật Test.
4. Nếu thay đổi kiến trúc:
   - cập nhật SCB_DECISIONS.md.

---

# Definition of Done

Một milestone chỉ được đánh dấu hoàn thành khi:

✓ Code Compile PASS

✓ Unit Test PASS

✓ Integration Test PASS

✓ Regression PASS

✓ Không TODO

✓ Không FIXME

✓ Không Dead Code

✓ Không Legacy Logic

✓ Tuân thủ SCB Architecture

---

# Mục tiêu cuối cùng

Khi toàn bộ checklist đều PASS:

SCB được coi là Production Ready.

Mọi thay đổi sau này phải đi theo quy trình:

Architecture
↓

Decision
↓

Roadmap
↓

Development
↓

Testing
↓

ChangeLog
↓

Release