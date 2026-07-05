# Architecture Freeze — SCB v2.1

| | |
|---|---|
| **Status** | Superseded by [ARCHITECTURE-FREEZE-v2.md](./ARCHITECTURE-FREEZE-v2.md) |
| **Effective** | 2026-07-05 |
| **Architecture** | SCB 2.1 (Session-Centric Billing) |
| **Milestone** | Phase 3 — Provider Abstraction Layer complete |
| **Authoritative companion** | [SCB-ARCHITECTURE.md](./SCB-ARCHITECTURE.md) |

---

## Executive Summary

Kể từ thời điểm này, kiến trúc SCB của GPUVietnam được xem là **Frozen**.

SCB 2.1 đã hoàn thành:

- Detect / Repair tách khỏi read path (ADR-001)
- Machine Operation Queue + Scheduler + Worker (Phase 2 / 2.5)
- Provider Abstraction Layer + Registry (ADR-002, Phase 3)

**Trọng tâm phát triển tiếp theo** chuyển sang product layer: UI/UX, Dashboard, Workspace, Provisioning, Provider Integration, Billing Experience, Customer Features, Performance, Reliability.

**Không tiếp tục tối ưu kiến trúc SCB** trừ khi có yêu cầu rõ ràng và ADR mới được phê duyệt.

---

## Change Policy

Mọi thay đổi sau Architecture Freeze phải thuộc **một trong ba loại**:

### A. Bug Fix

- Sửa lỗi hành vi sai so với spec/invariant hiện tại.
- Diff tối thiểu.
- **Không** thay đổi kiến trúc, ordering, hay semantics frozen.

### B. Feature

- Thêm tính năng mới (UI, API, integration, customer-facing).
- **Không** thay đổi invariant SCB.
- **Mặc định:** tái sử dụng Queue, Scheduler, Provider Interface, Projection — không tạo pipeline song song, không duplicate lifecycle.

### C. Architecture Change

- Chỉ được thực hiện khi có **ADR mới** trong `docs/scb/ADR-*.md` được phê duyệt.
- ADR bắt buộc mô tả: **Problem**, **Alternatives**, **Decision**, **Trade-offs**, **Rollback**.

---

## Default Assumptions for New Work

Khi phát triển tính năng mới:

1. Kiến trúc hiện tại **được coi là đúng**.
2. **Không** đề xuất refactor nếu không thật sự cần thiết.
3. Chỉ sửa **tối thiểu** để hỗ trợ tính năng.
4. Ưu tiên extension points (xem bên dưới) thay vì tạo flow mới.

---

## Frozen Components

Các thành phần sau **không được refactor** nếu không có ADR mới được phê duyệt:

| Component | Scope / Path | Notes |
|-----------|--------------|-------|
| **SCB Core** | `runDestroyPipeline`, verify-before-settlement, backup/settlement ordering | Single destroy orchestrator |
| **Destroy Pipeline** | `src/lib/destroy-pipeline-run.js`, `destroy-pipeline.js`, `destroy-pipeline-core.js` | Ordering: verify → close → settle → destroyed |
| **Session Lifecycle** | `src/lib/gpu/session-lifecycle.js`, session activate/close/orphan flows | Explicit state machine only |
| **Billing Lifecycle** | `src/lib/gpu/settlement.js`, `settlement-core.js`, `settlement-transaction-rpc.js`, `billing.js` | Session-centric; RPC atomicity (SCB 3.4B) |
| **Machine Operation Queue** | `src/lib/infrastructure/machine-operation-queue.js`, `machine_operations` schema | Durability, lease, dedupe semantics |
| **Scheduler** | `src/lib/infrastructure/machine-operation-scheduler.js` | Enqueue only — no direct provider/destroy calls |
| **Worker** | `src/lib/infrastructure/machine-operation-worker.js` | Executes queued ops → `destroyUserMachine` → pipeline |
| **Queue Policies** | `machine-operation-policies.js`, DLQ, retry, priority registry | Phase 2.5 hardening |
| **Detect / Repair** | `src/lib/machines-drift.js`, `machines-drift-core.js` | Business branches parity with legacy |
| **Provider Abstraction** | `src/lib/gpu/provider-abstraction/**` | Interface, registry, bridge, contract tests |
| **Provider Interface** | `provider-interface.js` — `ProviderAdapter` contract | 7 orchestration methods + capabilities |
| **Provider Registry** | `provider-registry.js`, `bootstrapProviderRegistry()` | Register, lookup, default provider |
| **Projection Model** | Truth = `gpu_sessions`; projection = `machines`, subscription cache, inventory | Disposable, rebuildable; never SoT for billing |

### Related Frozen Infrastructure (Phase 2.5)

| Component | Path |
|-----------|------|
| Self-heal | `machine-operation-self-heal.js` |
| Observability / metrics | `machine-operation-observability.js`, `machine-operation-metrics.js` |
| Admin API surface | `machine-operation-admin.js`, `GET /api/admin/machine-operations` |
| Correlation | `src/lib/scb-correlation.js` |

### Explicitly Not Frozen (product layer)

- React UI / components / pages
- Dashboard UX
- Workspace features
- Customer-facing API shape (additive)
- Provider stub → full implementation (via new adapter, contract tests)
- Performance tuning (non-semantic)
- Observability dashboards (additive metadata)

---

## Frozen Invariants

Các invariant sau **bất biến** sau Architecture Freeze:

### Truth & Projection

1. **Single Source of Truth for billing:** `gpu_sessions` — không dùng `machines.billing_started_at` để tính billing.
2. **Projection is disposable:** `machines`, subscription cache, `user_plan_inventory` có thể rebuild; không sửa Truth để khớp Projection.
3. **Immutable after Running:** Session ID, User ID, Machine ID, `started_at` không được sửa sau khi session Running.

### Lifecycle

4. **One Session Lifecycle:** Không tồn tại legacy / parallel / background session flow.
5. **One Destroy Orchestrator:** Mọi destroy đi qua `runDestroyPipeline` (Worker, write path, reconciliation).
6. **Verify before billing:** Billing anchor chỉ sau provider verify PASS.
7. **Destroy ordering:** verify → close session → settle → mark destroyed (frozen).

### Read / Write Path (ADR-001)

8. **Read path never awaits destroy pipeline** khi `SCB21_READ_PATH_DETECT_ONLY=1` (default post Phase 1).
9. **Detect branches parity:** Drift detection giữ nguyên business rules; chỉ thay execute → enqueue trên read path.
10. **Repair durability:** Repair trên read path qua Queue + Worker, không fire-and-forget trong HTTP request.

### Queue (Phase 2 / 2.5)

11. **Scheduler enqueues only** — không gọi Provider hay `runDestroyPipeline` trực tiếp.
12. **Worker executes** — Destroy ops → `destroyUserMachine` → SCB Core unchanged.
13. **Retry / DLQ / Priority** — semantics frozen trong `machine-operation-policies.js`.

### Provider (ADR-002)

14. **Provider is adapter only** — Create, Verify, Destroy, Offers; không biết Billing, Settlement, Queue, Scheduler.
15. **Default provider:** `GPU_PROVIDER` env, fallback `vast`; production behavior unchanged khi `vast`.
16. **Contract tests required** — mọi provider adapter mới phải pass `provider-contract.test.mjs`.

### Settlement (SCB 3.4B)

17. **Atomic settlement RPC:** W2–W7 trong một transaction `settle_session_transaction`; JS giữ business math, RPC là executor.
18. **Idempotency:** `settlement_status` claim guard + wallet idempotency key.

---

## Extension Points

Dùng các điểm mở rộng sau thay vì tạo pipeline song song:

| Extension Point | How to Use | Do Not |
|-----------------|------------|--------|
| **Machine Operation Queue** | Enqueue repair/provision/destroy/probe via Scheduler | Inline await destroy on read path |
| **Scheduler** | `scheduleMachineOperation()` với operation type + priority | Call provider directly from API |
| **Worker** | New operation handlers (additive) nếu cần — **requires ADR** nếu đổi semantics | Bypass queue for durability-critical work |
| **Provider Registry** | `registerProviderAdapter()` + capability declaration | Hardcode provider in GPUService |
| **Provider Interface** | Implement `ProviderAdapter`; pass contract tests | Fork Vast logic into duplicate paths |
| **Legacy Bridge** | `createLegacyGpuProviderBridge()` for GPUService compat | Break existing GPUService callers |
| **Detect overlay** | Read path projection overlay từ detect result | Poll provider directly from UI |
| **Write APIs** | `stop-machine`, `start-machine`, admin endpoints | New destroy entry point bypassing pipeline |
| **UI / Dashboard** | Consume projection + API; additive fields | Derive billing from machine projection |
| **Billing UX** | Surface settlement status, wallet, entitlements | Change settlement ordering or RPC steps |

---

## Approved ADRs

| ADR | Title | Status | Scope |
|-----|-------|--------|-------|
| [ADR-001](./ADR-001-read-path-detect-only.md) | Read Path Detect Only | Accepted | Detect/Repair split; read path enqueue; rollback `SCB21_READ_PATH_DETECT_ONLY=0` |
| [ADR-002](./ADR-002-provider-abstraction-layer.md) | Provider Abstraction Layer | Accepted | ProviderAdapter, Registry, Capabilities, Vast adapter, contract tests |

**Next ADR required for:**

- Multi-provider scheduling / routing (Phase 4)
- Provider failover
- Projection state machine expansion (`requested`, `allocating`, …)
- Queue semantics change (retry policy, priority, DLQ behavior)
- Destroy pipeline ordering change
- Billing lifecycle / settlement RPC change
- Refactor of any Frozen Component listed above

---

## Allowed Changes

### Without ADR

| Category | Examples |
|----------|----------|
| **Bug fix** | Fix incorrect drift branch, fix settlement edge case, fix adapter mapping — minimal diff, same semantics |
| **Documentation** | Runbooks, API docs, architecture diagrams |
| **Observability (additive)** | Logs, metrics, correlation fields, admin read endpoints |
| **UI/UX** | Dashboard layout, workspace, customer features |
| **Provider integration** | New `*-provider-adapter.js` implementing frozen interface + contract tests |
| **Performance** | Caching, query optimization, profiling — no semantic change |
| **Reliability** | Alerting, monitoring, smoke tests |
| **Provisioning UX** | Start flow UI, error messages, progress states (presentation only) |
| **Billing experience** | Invoice display, wallet UI, usage charts — read-only over frozen billing |

### With ADR Only

| Category | Examples |
|----------|----------|
| **Architecture change** | New orchestrator, parallel lifecycle, queue redesign, provider routing |
| **Invariant change** | Alter destroy ordering, settlement steps, session state machine |
| **Frozen component refactor** | Restructure destroy pipeline, merge queue/worker, change detect logic |

---

## Forbidden Changes

| Forbidden | Reason |
|-----------|--------|
| Refactor SCB Core without ADR | Frozen orchestration |
| Change Destroy Pipeline ordering | Billing / verify invariant |
| Modify Queue / Scheduler / Worker semantics without ADR | Durability contract |
| Change Detect/Repair business branches without ADR | Reconciliation parity |
| Refactor Provider Abstraction / Registry / Interface without ADR | Phase 3 contract |
| Create parallel destroy or billing pipeline | One lifecycle principle |
| Duplicate session lifecycle | Single flow principle |
| Use Projection as billing SoT | Truth = `gpu_sessions` |
| Poll provider directly from UI for authoritative state | Projection-driven dashboard |
| Multi-provider scheduling without ADR-003+ | Out of Phase 3 scope |
| Provider failover / region optimization without ADR | Out of Phase 3 scope |
| "Quick refactor while we're here" on frozen paths | Architecture Freeze policy |
| Skip contract tests for new provider | Provider quality gate |

---

## Architecture Map (Frozen Layer)

```
┌─────────────────────────────────────────────────────────────┐
│  Product Layer (NOT frozen)                                 │
│  UI · Dashboard · Workspace · Customer Features · Billing UX│
└───────────────────────────┬─────────────────────────────────┘
                            │ API
┌───────────────────────────▼─────────────────────────────────┐
│  Read Path (ADR-001)          │  Write Path                   │
│  Detect + Enqueue             │  start/stop · Worker execute  │
│  Projection overlay           │  await pipeline where needed  │
└───────────────┬───────────────┴───────────────┬───────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────┐
│  Queue · Scheduler        │   │  SCB Core (Frozen)            │
│  Worker · Policies · DLQ  │──▶│  runDestroyPipeline           │
└───────────────────────────┘   │  Session Lifecycle · Settlement│
                                └───────────────┬───────────────┘
                                                │
                                ┌───────────────▼───────────────┐
                                │  Provider Abstraction (Frozen) │
                                │  Interface · Registry · Bridge │
                                └───────────────┬───────────────┘
                                                │
                                ┌───────────────▼───────────────┐
                                │  Provider Adapters             │
                                │  vast (prod) · stubs (future)  │
                                └───────────────────────────────┘
```

---

## Future Roadmap

Architecture Freeze đánh dấu **kết thúc giai đoạn kiến trúc SCB 2.1**. Roadmap tiếp theo ưu tiên **product & integration**, không tối ưu kiến trúc trừ khi có ADR.

### Immediate Focus (no architecture change)

| Area | Direction |
|------|-----------|
| **UI/UX** | Polish flows, error states, loading, accessibility |
| **Dashboard** | Session-centric view, drift-aware status, remaining time |
| **Workspace** | ComfyUI integration, file management, session tools |
| **Provisioning** | Start-machine UX, plan selection, region display |
| **Provider Integration** | Implement Salad / TensorDock / InterData adapters (contract tests) |
| **Billing Experience** | Wallet, usage, settlement visibility, plan inventory |
| **Customer Features** | Auto-renew UX, notifications, plan management |
| **Performance** | API latency, dashboard load, query optimization |
| **Reliability** | Alerting, SLOs, runbooks, queue monitoring |

### Deferred (requires ADR before start)

| Phase | Topic | Prerequisite |
|-------|-------|--------------|
| **Phase 4** | Multi-provider scheduling, provider routing | ADR-003+ |
| **Phase 4** | Provider failover | ADR |
| **Phase 5** | Projection state machine (`requested`, `allocating`, …) | ADR |
| **Future** | Region / cost optimization | ADR |
| **Future** | Queue semantic changes | ADR |

---

## Rollback References

| Component | Rollback |
|-----------|----------|
| Read path detect-only | `SCB21_READ_PATH_DETECT_ONLY=0` |
| Provider abstraction | Revert `getGpuService()` to direct `VastProvider` (1-line) |
| Queue worker | Disable cron; jobs accumulate (no data loss) |
| ADR-001 full rollback | Flag off + optional worker disable |

Chi tiết: [ADR-001 Rollback Strategy](./ADR-001-read-path-detect-only.md#rollback-strategy), [Phase 3 Review](./PHASE3-PROVIDER-ABSTRACTION-REVIEW.md#10-migration-plan).

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [SCB-ARCHITECTURE.md](./SCB-ARCHITECTURE.md) | Authoritative architecture spec |
| [SCB-ARCHITECTURE-FROZEN.md](./SCB-ARCHITECTURE-FROZEN.md) | Pre-freeze snapshot (Phase 2.5) — superseded by this document |
| [PHASE3-PROVIDER-ABSTRACTION-REVIEW.md](./PHASE3-PROVIDER-ABSTRACTION-REVIEW.md) | Phase 3 completion review |
| [SCB_3_4_SPECIFICATION_FREEZE.md](./SCB_3_4_SPECIFICATION_FREEZE.md) | Settlement RPC freeze |
| [SCB_IMPLEMENTATION_ROADMAP.md](./SCB_IMPLEMENTATION_ROADMAP.md) | Historical phase plan |

---

## Milestone Declaration

**2026-07-05 — Architecture Freeze is the official project milestone for SCB v2.1.**

From this date:

- Frozen components require ADR for architectural change.
- New work defaults to Bug Fix or Feature on the product layer.
- AI agents and contributors must assume current architecture is correct and minimize scope.

---

*Document owner: GPUVietnam Engineering · Last updated: 2026-07-05*
