# B1.4 — Runtime Port (contract)

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §1.4 |
| **Architecture** | [ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md) · [ADR-005](./ADR-005-control-plane-runtime-v2.md) |
| **Depends on** | [B1_2_DATA_MODEL.md](./B1_2_DATA_MODEL.md) · [B1_3_STORAGE_SPEC.md](./B1_3_STORAGE_SPEC.md) · [RuntimeImageSpec.md](./RuntimeImageSpec.md) |
| **Code** | `src/lib/cp-runtime/runtime-port.js` |
| **Next** | Comfy Adapter implements this Port (1.5) |

---

## Purpose

**Runtime Port** là interface ổn định duy nhất mà Control Plane dùng để nói chuyện với một Runtime Engine.

- CP **không** gọi ComfyUI HTTP/WS/`object_info`/đường dẫn FS trực tiếp.  
- Dialect Comfy bị cô lập trong **Comfy Adapter** (implement Port).  
- Provider Adapter (Vast/Clore/…) thuộc lớp hạ tầng — Port không lộ API marketplace.

**Xong khi (roadmap):** CP chỉ nói chuyện qua Port.

---

## Layering

```text
Control Plane (Job / Attempt / Registry / Assets)
        │
        │  RuntimePort only
        ▼
   Runtime Port          ← this document
        │
        ▼
   Runtime Adapter       ← ComfyAdapter (1.5); future engines = new adapters
        │
        ▼
   Runtime Engine        ← ComfyUI process (execute / queue / CUDA / VRAM)
        │
        ▼
   Provider Adapter      ← rent/destroy GPU (orchestration may call from create/destroy)
```

| Layer | Owns | Must not |
|-------|------|----------|
| Control Plane | Job/Attempt state, manifests, parity decision inputs | Import `ComfyClient`, hit `/prompt` |
| Runtime Port | Stable method contract + shared DTOs/errors | Comfy URL paths in signatures |
| Comfy Adapter | Map Port ↔ Comfy dialect | Own Session/Project/Billing SoT |
| Provider Adapter | Instance rent/destroy/status | Own workflow document SoT |

---

## Operations (normative)

Năm thao tác bắt buộc:

| Method | Intent | Typical Attempt status move |
|--------|--------|-----------------------------|
| `create` | Có Runtime sẵn sàng nhận việc (bind/provision endpoint) | `pending` → `provisioning` → ready Runtime |
| `submit` | Giao workflow + refs input đã parity | `submitting` → `running` |
| `monitor` | Đọc tiến độ / terminal state của execution | stay `running` or → terminal |
| `fetch` | Đưa output từ Runtime → kho bền (Plane B) | before marking `succeeded` |
| `destroy` | Hủy Runtime / giải phóng compute gắn Runtime | Registry → `stopping` / `destroyed` |

### Invariants

1. Mọi method nhận **CP ids** (`runtimeId`, `jobId`, `attemptId`, …) — không nhận raw Comfy `prompt` graph path conventions trong tên method.  
2. `submit` chỉ được gọi khi Image Spec parity đã `ok` (caller CP/orchestrator; Adapter có thể re-check).  
3. `fetch` ghi object lên R2 Plane B + cập nhật manifest refs; **không** lấy `/history` Comfy làm SoT sản phẩm.  
4. `destroy` **không** xóa `cp_assets` / Job history.  
5. GPU chết giữa `submit` và `fetch` → Attempt `failed`; Job tạo Attempt mới (không resume CUDA).  
6. Port methods là **async**; lỗi dùng `RuntimePortError` với `code` ổn định (xem dưới).

---

## Method contracts

### `create(params) → CreateRuntimeResult`

Đảm bảo có Runtime **ready** gắn Attempt (và thường gắn `runtime_registry` row).

```ts
params: {
  userId: string;
  attemptId: string;
  jobId: string;
  requiredImageSpecRef: string;   // e.g. gpuvietnam.comfy.v3@1.0
  gpuLine?: string;               // hint for provision (1.6)
  runtimeId?: string;             // reuse existing registry row if any
  policy?: { mode?: 'ephemeral' | 'warm' | 'standby' };  // Runtime Policy; default ephemeral
  metadata?: Record<string, unknown>;
}

result: {
  runtimeId: string;
  endpointUrl?: string | null;    // may be opaque / internal — CP should not scrape Comfy paths
  imageSpecRef: string;
  status: 'ready' | 'provisioning' | 'starting';
  machineId?: string | null;
  provider?: string | null;
}
```

- Có thể gọi Provider Adapter bên trong (1.6); **signature Port không** lộ Vast/Clore offer ids bắt buộc.  
- Nếu chưa ready: `status: 'provisioning' | 'starting'`; caller poll Registry hoặc gọi lại `create`/health theo orchestrator (chi tiết 1.6).

### `submit(params) → SubmitResult`

```ts
params: {
  runtimeId: string;
  jobId: string;
  attemptId: string;
  workflowSnapshot: Record<string, unknown>;  // CP-owned document
  inputManifest: object;   // cp.storage.manifest.v1 inputs (or subset)
  imageSpecRef: string;    // required; must match Runtime
  clientId?: string;       // opaque correlation; Adapter may map to Comfy client_id
  metadata?: Record<string, unknown>;
}

result: {
  externalExecutionId: string;  // opaque (Adapter may store Comfy prompt_id internally)
  status: 'queued' | 'running';
}
```

- Stage-in inputs (R2 → working dirs) là trách nhiệm Adapter trong `submit` (hoặc bước nội bộ trước khi engine nhận graph).  
- CP không truyền đường dẫn `/view?filename=…`.

### `monitor(params) → MonitorResult`

```ts
params: {
  runtimeId: string;
  attemptId: string;
  externalExecutionId: string;
}

result: {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'lost';
  progress?: Record<string, unknown>;  // optional percent / node hints — not SoT
  errorMessage?: string | null;
}
```

- `lost` = Runtime/endpoint unreachable hoặc process chết — CP đánh Attempt `failed`.  
- Không expose raw Comfy queue JSON.

### `fetch(params) → FetchResult`

```ts
params: {
  runtimeId: string;
  jobId: string;
  attemptId: string;
  userId: string;
  externalExecutionId: string;
  outputManifestHints?: object;  // optional expected filenames
}

result: {
  outputManifest: object;  // cp.storage.manifest.v1 outputs (+ optional sidecars)
  assetIds?: string[];     // cp_assets created/updated
}
```

- PUT R2 theo [B1_3_STORAGE_SPEC](./B1_3_STORAGE_SPEC.md); trả manifest cho CP ghi `job_attempts.result_manifest`.

### `destroy(params) → DestroyResult`

```ts
params: {
  runtimeId: string;
  attemptId?: string | null;
  reason?: string;
  /** When true, also release underlying GPU instance via Provider (default true for ephemeral). */
  releaseCompute?: boolean;
}

result: {
  runtimeId: string;
  status: 'stopping' | 'destroyed';
}
```

- Idempotent: destroy Runtime đã `destroyed` → success với `status: 'destroyed'`.  
- Không đụng Plane B objects.

---

## Error codes (`RuntimePortError.code`)

| Code | When |
|------|------|
| `NOT_IMPLEMENTED` | Stub / Adapter chưa hỗ trợ method |
| `INVALID_ARGUMENT` | Thiếu id / snapshot / spec ref |
| `UNKNOWN_RUNTIME` | `runtimeId` không tồn tại |
| `RUNTIME_NOT_READY` | create/submit khi endpoint chưa ready |
| `PARITY_FAILED` | Image Spec parity không đạt |
| `SUBMIT_REJECTED` | Engine từ chối graph (validation) |
| `EXECUTION_FAILED` | Job chạy xong nhưng failed |
| `EXECUTION_LOST` | Mất Runtime giữa chừng |
| `FETCH_FAILED` | Không lấy/ghi được output bền |
| `DESTROY_FAILED` | Không hủy được Runtime/compute |
| `TIMEOUT` | Deadline nội bộ |
| `UNAVAILABLE` | Lỗi tạm (retryable) |

`retryable: boolean` trên error giúp orchestrator.

---

## What must NOT appear on the Port

- Paths: `/prompt`, `/history`, `/queue`, `/upload/*`, `/view`, `/ws`  
- Types named `Comfy*` in Port public signatures (Adapter-internal OK)  
- Direct R2 secret handling in CP call sites (presign inside Adapter/CP storage helpers)  
- Billing settle / wallet debit (CP outside Port)

---

## Stub & conformance

| Artifact | Role |
|----------|------|
| `createUnimplementedRuntimePort()` | Default stub — mọi method ném `NOT_IMPLEMENTED` |
| `assertRuntimePort(port)` | Conformance: đủ 5 method |
| `createRecordingRuntimePort(handlers?)` | Test double |

Comfy Adapter (1.5) export `createComfyRuntimePort(deps) → RuntimePort`.

---

## Orchestration sketch (CP-side, not Port)

```text
parity(required, runtime) → ok?
create → runtimeId ready
submit → externalExecutionId
loop: monitor until terminal
  if lost/failed → destroy? → new Attempt (1.7)
  if succeeded → fetch → update manifests → destroy
```

Dual-run (B3): hai lần `create`/`submit` (hai Attempt); Port không biết “dual”.

---

## Acceptance checklist

- [x] `RuntimePort.md` contract (create / submit / monitor / fetch / destroy)  
- [x] Code interface + stub + tests  
- [ ] Comfy Adapter implement — **1.5**  
- [ ] Provider wiring inside `create`/`destroy` — **1.6**  

---

## Out of scope

- Comfy HTTP dialect (1.5)  
- Failover Attempt loop (1.7)  
- Dashboard (1.8)  
- Live `object_info` parity probe (B4 §4.2)
