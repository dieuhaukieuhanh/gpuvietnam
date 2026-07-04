# Architecture Release

| | |
|---|---|
| **Architecture Version** | **2.0** |
| **Status** | **Frozen** |
| **Current Phase** | **Implementation** |
| **Approved Architecture Date** | **2026-06-28** |
| **Approved By** | **Architecture Review** |

Tài liệu này xác nhận **phiên bản kiến trúc đang có hiệu lực** tại GPUVietnam. Không mô tả chi tiết kiến trúc — tham chiếu các tài liệu chính thức bên dưới.

---

## Official Architecture Documents

Các tài liệu sau thuộc **Architecture 2.0** và có hiệu lực cùng phiên bản này:

| Tài liệu | Vai trò |
|----------|---------|
| [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md) | Triết lý và nguyên tắc kiến trúc |
| [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md) | Architecture Decision Records (ADR) |
| [CODING_RULES.md](./CODING_RULES.md) | Coding Standard — nguyên tắc lập trình |
| [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) | Kiến trúc billing chính thức (SCB) |
| [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md) | State machine vận hành |
| [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) | Kế hoạch triển khai SCB |
| [TECH_DEBT.md](./TECH_DEBT.md) | Technical Debt Register |
| [EXTENSION_POINTS.md](./EXTENSION_POINTS.md) | Extension Points |

Tài liệu **không** thuộc bộ chính thức trên (draft, review, feasibility) chỉ mang tính tham khảo — không override Architecture 2.0 trừ khi được nâng cấp qua quy trình phiên bản mới.

---

## Official Architectural Decisions

Tóm tắt quyết định đang có hiệu lực (chi tiết: [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md)):

| Quyết định | ADR |
|------------|-----|
| Session-Centric Billing | ADR-001 |
| Single Remaining Formula | ADR-002 |
| Restart-only Workspace | ADR-004 |
| Verify Before Settlement | ADR-003 |
| Provider Adapter | ADR-007 |
| Monolith Architecture | ADR-006 |
| Single Operator | ADR-011 |
| Correctness over Performance | ADR-008 |

---

## Architecture Freeze Rules

Sau khi **Architecture 2.0** được phát hành:

- Không thay đổi kiến trúc khi chưa có **ADR mới** (Accepted).
- Không sửa trực tiếp [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md) — thay đổi triết lý qua ADR + cập nhật Principles có version.
- Không sửa nội dung ADR đã **Accepted** — supersede bằng ADR mới.
- Không thay đổi [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md) nếu chưa có ADR.
- Không thay đổi Billing Model nếu chưa có ADR.
- Mọi thay đổi lớn phải cập nhật **Architecture Version** (xem Exit Criteria).

---

## Allowed Changes During Version 2.x

### Cho phép

- Bug fix
- Performance optimization (không đổi correctness guarantees — ADR-008)
- Refactor không đổi hành vi nghiệp vụ
- Thêm GPU Provider mới (Adapter Layer)
- Thêm Payment Gateway
- Thêm Notification Provider
- Thêm Workspace Catalog

### Không được (trong 2.x)

- Đổi Billing Model
- Đổi State Machine
- Đổi Remaining Formula
- Đổi Session Lifecycle
- Đổi Destroy Pipeline

Vi phạm các mục “Không được” yêu cầu **Architecture 3.0** và ADR tương ứng.

---

## Exit Criteria For Architecture 3.0

Chỉ xem xét **Architecture 3.0** khi có **ít nhất một** trong các điều kiện:

- Multi-region deployment
- Multi-tenant enterprise
- Microservices thật sự cần thiết
- Nhiều operator / admin
- Thay đổi Billing Model
- Thay đổi Session Model
- Thay đổi Provider Architecture

Khi điều kiện đạt: tạo ADR mới, cập nhật bộ tài liệu chính thức, phát hành `ARCHITECTURE_VERSION.md` mới (3.0).

---

## Release Notes

**Architecture 2.0** là phiên bản kiến trúc chính thức **đầu tiên** được đóng băng (Frozen) tại GPUVietnam.

Điểm mốc chính của phiên bản này:

- Chuyển billing sang **Session-Centric Billing (SCB)**.
- Bộ tài liệu kiến trúc, ADR, Coding Rules, State Machine, và Implementation Plan SCB được phê duyệt cùng ngày **2026-06-28**.
- Giai đoạn hiện tại: **Implementation** — triển khai theo [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md).

Toàn bộ hoạt động triển khai từ thời điểm này phải tuân thủ các tài liệu kiến trúc đã được phê duyệt.

---

*GPUVietnam Architecture Release 2.0 — Frozen — 2026-06-28*
