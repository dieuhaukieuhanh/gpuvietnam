# SCB Architecture Frozen

| | |
|---|---|
| **Effective** | 2026-07-05 (post Phase 2.5 approval) |
| **Status** | Active |

---

## Frozen Components

Từ thời điểm này, **không refactor** các thành phần sau mà không có ADR mới được phê duyệt:

| Component | Path / scope |
|-----------|----------------|
| SCB Core | `runDestroyPipeline`, verify-before-settlement, settlement/backup ordering |
| Session lifecycle | `session-lifecycle.js` state machine invariants |
| Machine Operation Queue | `machine-operation-queue.js`, `machine_operations` schema semantics |
| Scheduler | `machine-operation-scheduler.js` |
| Worker | `machine-operation-worker.js` |
| Detect / Repair | `machines-drift.js`, `syncSubscriptionWithMachineState` business branches |
| Retry / DLQ / Priority policies | `machine-operation-policies.js` (change via ADR only) |

---

## Allowed Without ADR

- Bug fixes với diff tối thiểu, không đổi semantics
- Observability/logging metadata (additive)
- Documentation

---

## Required For Changes

Mọi thay đổi kiến trúc SCB sau Phase 2.5 **phải** có ADR trong `docs/scb/ADR-*.md`.

---

## Phase 3 Exception (Provider Abstraction)

Phase 3 **chỉ thêm** layer mới:

- `src/lib/gpu/provider-abstraction/**`
- `src/lib/gpu/providers/*/ *-provider-adapter.js`
- Wiring `getGpuService()` → registry → legacy bridge

Không sửa Queue, Worker, Scheduler, Destroy Pipeline, Detect/Repair.
