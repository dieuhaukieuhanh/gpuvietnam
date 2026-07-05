# ADR-001 — Read Path Detect Only

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-05 |
| **Architecture** | SCB 2.1 |
| **Supersedes** | Inline repair trong `syncSubscriptionWithMachineState` trên HTTP read path |
| **Related** | Phase 1 (Detect/Repair split), Phase 2 (Machine Operation Queue) |

---

## Context

GPUVietnam phục vụ dashboard và polling trạng thái máy qua các HTTP read endpoint:

- `GET /api/dashboard/me`
- `GET /api/machines/status`

Trước SCB 2.1, các endpoint này gọi `syncSubscriptionWithMachineState`, có thể **await** `destroyUserMachine` → `runDestroyPipeline`. Destroy pipeline bao gồm provider verify, backup, settlement — thường mất **5–30 giây**. User chờ HTTP response trong khi pipeline chạy.

SCB yêu cầu projection DB tiến dần về trạng thái thật, nhưng **read path không phải write path**. Reconciliation vẫn cần phát hiện drift (orphan, stale boot, dead instance, leaked machine) nhưng không được block UI/API.

SCB Core (`runDestroyPipeline`, verify-before-settlement, settlement/backup ordering, lifecycle invariants) đã **frozen** — chỉ thay đổi *nơi*, *ai*, và *khi nào* pipeline được await.

---

## Problem

1. **Latency:** Dashboard load và status poll bị chặn bởi destroy pipeline.
2. **Coupling:** Read path trộn detect, repair, provider I/O, và settlement trong một request.
3. **Serverless risk:** Fire-and-forget repair (Phase 1 stub) không đảm bảo durability khi function terminate sớm.
4. **Observability:** Khó trace một repair từ detect → destroy → projection update.

---

## Decision

### Read Path chỉ Detect + Enqueue

HTTP read endpoints **được phép**:

- Đọc DB projection
- Detect drift (cùng business rules hiện tại)
- Enqueue repair job vào Machine Operation Queue
- Trả response ngay với **projected state** từ detect

HTTP read endpoints **không được phép**:

- Await `runDestroyPipeline`
- Await backup, settlement, hoặc provider API dài
- Thực hiện bất kỳ write blocking nào thuộc SCB Core destroy flow

### Repair thuộc Write Path

Repair thực thi bởi:

- **Worker** (cron) lease job từ `machine_operations` và execute
- **Write endpoints** (`stop-machine`, `destroy`, …) vẫn có thể await pipeline trực tiếp hoặc enqueue tùy contract
- **Rollback path:** `SCB21_READ_PATH_DETECT_ONLY=0` → read path quay lại inline `syncSubscriptionWithMachineState` (await repair như legacy)

### Không thay đổi SCB Core

`runDestroyPipeline`, verify-before-settlement, settlement ordering, backup ordering, và lifecycle invariants **không sửa**. Worker gọi `destroyUserMachine` → pipeline y như trước.

---

## Alternatives Considered

| Phương án | Lý do loại bỏ |
|-----------|---------------|
| **Giữ inline sync trên read path** | Dashboard/status vẫn block 5–30s khi drift cần destroy |
| **Bỏ detect trên read path** | Mất reconciliation-aware UI; projection lệch lâu hơn |
| **Fire-and-forget trong cùng HTTP request (Phase 1 stub)** | Không durable trên serverless; không retry/lease/dedupe |
| **Poll Vast trực tiếp từ UI** | Vi phạm projection-driven dashboard; tăng provider load |
| **Sửa destroy pipeline để “nhanh hơn”** | Vi phạm SCB Core frozen; không giải quyết coupling read/write |

---

## Trade-offs

| Ưu điểm | Nhược điểm |
|---------|------------|
| Read path phản hồi nhanh (< DB + detect) | Eventual consistency ngắn giữa response và DB thật |
| Destroy/settlement chạy ngoài user-facing latency | Cần worker cron + queue table |
| Detect logic giữ nguyên — không mất reconciliation | UI dùng projection từ detect, không phải DB post-repair |
| SCB Core untouched | Thêm operational surface (queue monitoring) |
| Idempotent queue tránh duplicate destroy | Migration DB bắt buộc |

---

## Rollback Strategy

| Level | Cách rollback |
|-------|----------------|
| **L1 — Read path inline** | `SCB21_READ_PATH_DETECT_ONLY=0` → `dashboard/me` và `machines/status` await `syncSubscriptionWithMachineState` |
| **L2 — Queue bypass** | Worker cron tắt; jobs tích lũy trong `machine_operations` (không mất data) |
| **L3 — Schema** | Bảng `machine_operations` additive; không sửa SCB tables; có thể bỏ qua worker nếu L1 đủ |

Rollback **không** yêu cầu sửa SCB Core.

---

## Invariants

Các invariant sau **bất biến** sau ADR-001:

1. `runDestroyPipeline` ordering: verify → close → settle → destroyed (frozen)
2. Settlement chỉ sau provider verify destroy (frozen)
3. Backup ordering trước destroy khi applicable (frozen)
4. Session lifecycle state machine (frozen)
5. Read path **never** awaits destroy pipeline khi flag detect-only ON
6. Detect branches parity với legacy `syncSubscriptionWithMachineState`
7. M13 infrastructure reconciliation **không** thay đổi behavior
8. Public API response shape **không** breaking change

---

## Impact

### Code

| Area | Impact |
|------|--------|
| `src/lib/machines-drift.js` | Detect tách repair; enqueue thay inline execute |
| `src/pages/api/dashboard/me.js` | Detect + enqueue; projection overlay |
| `src/pages/api/machines/status.js` | Detect + enqueue; provision error → queue |
| `src/lib/machines.js` | `syncSubscriptionWithMachineState` = detect + await execute (write/rollback) |
| Phase 2+ | `machine_operations`, queue service, scheduler, worker cron |

### Operations

- Cron worker xử lý queue (Phase 2)
- `correlation_id` xuyên suốt detect → queue → worker → logs (Phase 2)
- Monitor `machine_operations` state = failed / retry_scheduled

### API / UI

- Response JSON shape giữ nguyên
- `server_status` / machine projection có thể lead DB vài giây
- Dashboard polling interval không cần tăng cho destroy wait

---

## Future Phases

| Phase | Nội dung | Trạng thái |
|-------|----------|------------|
| **Phase 1** | Detect/Repair separation; read path detect + enqueue stub | ✅ Approved |
| **Phase 2** | Machine Operation Queue thay fire-and-forget; scheduler + worker | ✅ Approved |
| **Phase 2.5** | Queue production hardening (retry policy, DLQ, metrics, admin) | ✅ Completed |
| **Phase 3** | Scheduler layer mở rộng (multi-provider routing, failover) | ⏸ Chờ review |
| **Phase 4** | Projection-driven dashboard (`requested`, `allocating`, …) | ⏸ Chờ review |
| **Phase 5** | Provider abstraction hoàn chỉnh | ⏸ Chờ review |

Phase 3+ **không** được implement cho đến khi Phase 2 được phê duyệt.

---

## References

- `docs/scb/SCB-ARCHITECTURE.md`
- `docs/scb/ADR-001-read-path-detect-only.md` (this document)
- `SCB Core is Frozen.md`
- Phase 1 implementation: `src/lib/machines-drift.js`, `src/lib/machines-drift-core.js`
- M13 reconciliation: `src/lib/infrastructure/reconciliation-core.js`
