# ADR-002 — Provider Abstraction Layer

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-05 |
| **Architecture** | SCB 2.1 Phase 3 |
| **Depends on** | ADR-001 (Read Path Detect Only), Phase 2.5 Queue Hardening |

---

## Context

GPUVietnam hiện gắn chặt với Vast.ai qua `VastProvider` / `VastClient`. Mục tiêu dài hạn là **GPU Orchestration Platform** hỗ trợ nhiều provider (Salad, TensorDock, InterData, GPUVietnam Internal) mà không thay đổi SCB lifecycle hay business logic.

Phase 3 **chỉ** xây abstraction layer — không multi-provider scheduling, failover, hay cost optimization.

---

## Decision

1. **`ProviderAdapter` interface** — orchestration contract thống nhất: `createMachine`, `destroyMachine`, `getMachine`, `listOffers`, `listRegions`, `health`, `verifyRunning`.
2. **Provider Registry** — đăng ký, lookup, capability, version per provider id.
3. **Capability Model** — mỗi provider khai báo `supportsSpot`, `gpuTypes`, `regions`, … Scheduler tương lai đọc capability, không hardcode.
4. **Vast Provider Adapter** — bọc `VastProvider` hiện tại; logic Vast **không đổi**, chỉ di chuyển entry point.
5. **Legacy bridge** — `GPUProvider` (existing) delegate sang `ProviderAdapter` để `GPUService` backward compatible.
6. **Stub adapters** — Salad, TensorDock, InterData, GPUVietnam Internal đăng ký capability; chưa implement runtime (Phase 4+).

---

## Frozen Boundaries (post Phase 2.5)

Không refactor sau ADR-002 mà không có ADR mới:

- SCB Core (destroy pipeline, settlement, lifecycle)
- Machine Operation Queue / Scheduler / Worker
- Detect / Repair business logic

Phase 3 **được phép** thêm layer mới dưới `GPUService` và trong `src/lib/gpu/provider-abstraction/`.

---

## Alternatives Considered

| Phương án | Lý do loại bỏ |
|-----------|---------------|
| Sửa trực tiếp `GPUProvider` interface | Breaking; trộn workflow Comfy với orchestration |
| Multi-provider routing ngay Phase 3 | Vi phạm scope; cần scheduler mở rộng (Phase 4) |
| Fork Vast logic vào adapter | Duplicate; tăng regression risk |

---

## Consequences

- `getGpuService()` resolve provider qua registry (default `vast`).
- Contract tests đảm bảo mọi adapter pass cùng bộ kiểm tra.
- Stub providers sẵn sàng cho Phase 4 scheduling.

---

## Future Phases (not in scope)

- Phase 4: Multi-provider scheduling, failover
- Phase 5: Projection-driven dashboard
- Region / cost optimization
