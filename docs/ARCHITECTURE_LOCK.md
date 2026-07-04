# Architecture Lock

> **Architecture 2.0 — Final**  
> Session-Centric Billing (SCB) M1–M14 delivered.  
> Tài liệu này **khóa** kiến trúc. Mọi thay đổi Core Domain yêu cầu Architecture Review.

---

## Architecture Status

| | |
|---|---|
| **Architecture Version** | **2.0 Final** |
| **Status** | **FROZEN** |
| **Implementation** | **Session-Centric Billing M1–M14** |
| **Completion Date** | **2026-07-03** |

---

## Single Source of Truth

Các module sau là **Core Domain** — nguồn sự thật duy nhất cho logic nghiệp vụ tương ứng. API routes, React UI, view models, và admin panels **không** được duplicate hoặc thay thế logic này.

### Remaining

**Module:** `src/lib/gpu/remaining-time.js`  
**Vai trò:** Session-Centric Remaining — một công thức, mọi consumer (dashboard, auto-renew, admin).

### Session Lifecycle

**Module:** `src/lib/gpu/session-lifecycle.js`  
**Vai trò:** State machine phiên GPU (`pending` → `running` → `closing` → `closed` / `interrupted`) theo [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md).

### Provider Verify

**Module:** `src/lib/gpu/provider-verify.js`  
**Vai trò:** Xác minh provider RUNNING (session start) và DESTROYED (pre-settlement). Không ghi DB billing, không settlement.

### Settlement

**Module:** `src/lib/gpu/settlement.js` (+ RPC `settle_session_transaction` trong `supabase/settle-session-transaction.sql`)  
**Vai trò:** Orchestrator settlement — tính eligibility / billable seconds / allocation / breakdown trong JS, sau đó invoke server-side atomic transaction RPC thực hiện W2–W7 (claim → wallet debit → ledger insert → entitlement CAS → projection sync → finalize). RPC là sole entitlement/wallet writer; JS không ghi settlement ngoài RPC. SCB 3.4B — xem [`docs/scb/SCB_3_4B_COMPLETION_REPORT.md`](./scb/SCB_3_4B_COMPLETION_REPORT.md).

### Destroy

**Module:** `src/lib/destroy-pipeline-run.js`  
**Vai trò:** Unified Destroy Pipeline — orchestration verify → close → settlement → cleanup (M7).

### Infrastructure Reconciliation

**Module:** `src/lib/infrastructure/reconciliation.js`  
**Vai trò:** Scan drift provider vs DB; repair **delegate** M3/M4/M6/M7. Không tính Remaining, không settlement logic mới.

---

## Architecture Rules

### Core Domain protection

Các module Core Domain ở trên **không được thay đổi logic** trừ khi:

1. **Bug fix** — sửa hành vi sai so với Architecture 2.0 đã phê duyệt, có test chứng minh.
2. **Architecture Review** — quy trình nâng phiên bản kiến trúc (xem [Change Policy](#change-policy)).

### Không duplicate

| Domain | Cấm duplicate tại |
|--------|-------------------|
| Remaining | Frontend, API routes, admin panels, reconciliation |
| Settlement | Frontend, API routes, destroy pipeline ad-hoc, reconciliation |
| Provider Verify | Reconciliation (chỉ gọi contract), frontend |
| Destroy | API routes trực tiếp gọi provider destroy bỏ qua pipeline |
| Session Lifecycle | Frontend state inference, billing.js lifecycle |

### Presentation layer boundaries

**Không thêm business logic** vào:

- React components (`src/components/`)
- API route handlers (`src/pages/api/`) — chỉ orchestration + mapping
- View models (`scb-ui-view-model.js`, `scb-session-history-view-model.js`) — chỉ API → display
- Admin panels — chỉ scan/preview/repair **qua API**, không công thức billing

---

## Change Policy

### Feature mới

Feature mới phải **mở rộng** thông qua [Extension Points](./EXTENSION_POINTS.md) và [ARCHITECTURE_EXTENSION_GUIDE.md](./ARCHITECTURE_EXTENSION_GUIDE.md).

**Không** sửa trực tiếp Core Domain để “tiện” cho feature.

### Allowed without Architecture Review

- Bug fix trong Core Domain (có regression test)
- Wiring: cron, admin API, persistence (không đổi domain formulas)
- UI hiển thị field từ API (view model mapping only)
- Provider / payment **adapter** mới (implement port, không sửa settlement)

### Requires Architecture Review

- Thay đổi Remaining formula
- Thêm session transition hoặc settlement path mới
- Thay đổi destroy pipeline order
- Reconciliation tự settle / tự tính billable
- Schema thay đổi vai trò SoT billing
- Bất kỳ thay đổi nào override ADR trong [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md)

---

## Official Document Set

Architecture 2.0 Final — đọc theo thứ tự ưu tiên:

| Tài liệu | Vai trò |
|----------|---------|
| [ARCHITECTURE_VERSION.md](./ARCHITECTURE_VERSION.md) | Phiên bản và trạng thái |
| **ARCHITECTURE_LOCK.md** (tài liệu này) | Khóa kiến trúc post-SCB |
| [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md) | Nguyên tắc |
| [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md) | ADR |
| [CODING_RULES.md](./CODING_RULES.md) | Chuẩn code |
| [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) | SCB |
| [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md) | State machine |
| [EXTENSION_POINTS.md](./EXTENSION_POINTS.md) | Extension catalog |
| [ARCHITECTURE_EXTENSION_GUIDE.md](./ARCHITECTURE_EXTENSION_GUIDE.md) | Hướng dẫn mở rộng |
| [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) | Kế hoạch M1–M14 (historical) |
| IMPLEMENTATION_REPORT_M1.md … M14.md | Báo cáo triển khai |

Tài liệu draft/review/feasibility **không** override bộ chính thức trên.

---

## Implementation Completion

| Milestone | Deliverable |
|-----------|-------------|
| M1–M14 | Session-Centric Billing end-to-end |
| M14 | Production wiring, cleanup, architecture audit |
| SCB 3.4B | Settlement transaction atomicity — W2–W7 chuyển vào RPC server-side `settle_session_transaction` (pure executor, atomic rollback, idempotency + CAS giữ nguyên). Refactor atomicity trong Architecture 2.0 — không đổi Billing Model / state machine / SoT. Xem [`docs/scb/SCB_3_4B_COMPLETION_REPORT.md`](./scb/SCB_3_4B_COMPLETION_REPORT.md). |

**Verdict:** Architecture 2.0 implementation **complete**. System behavior frozen at completion date unless bug fix or Architecture Review. SCB 3.4B là refactor atomicity được phép trong Architecture 2.0 (refactor không đổi hành vi nghiệp vụ).
