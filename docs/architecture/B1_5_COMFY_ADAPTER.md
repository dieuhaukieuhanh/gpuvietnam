# B1.5 — Comfy Adapter

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §1.5 |
| **Port** | [RuntimePort.md](./RuntimePort.md) |
| **Code** | `src/lib/cp-runtime/comfy-adapter.js` |
| **Smoke workflow** | `src/lib/cp-runtime/comfy-smoke-workflow.js` (EmptyImage → PreviewImage) |

---

## Purpose

Implement **Runtime Port** cho ComfyUI Runtime Engine.

- Control Plane chỉ gọi `create` / `submit` / `monitor` / `fetch` / `destroy`.  
- Mọi `/prompt`, `/history`, `/queue`, `/view`, `/system_stats` nằm **trong** Adapter.  
- Dialect Comfy thay đổi → sửa Adapter, không phá CP.

**Xong khi:** Một Job end-to-end qua Adapter; CP không gọi Comfy trực tiếp.

---

## Factory

```js
import { createComfyRuntimePort, runJobAttemptViaRuntimePort } from '@/lib/cp-runtime/comfy-adapter';
```

| Dep | Role |
|-----|------|
| `createComfyClient` | Default `ComfyClient`; inject for tests |
| `provisionRuntime` | Optional — thuê máy / gắn endpoint (**1.6**) |
| `releaseCompute` | Optional — hủy GPU khi `destroy` (**1.6**) |
| `putObject` | Ghi output Plane B (R2); smoke dùng Map in-memory |
| `downloadView` | Override tải `/view` |

### B1.5 `create` without Provider

Truyền `metadata.endpointUrl` (+ `imageSpecRef` hoặc suy ra từ `gpuLine` / docker image).  
Chưa có endpoint và chưa inject `provisionRuntime` → `INVALID_ARGUMENT`.

---

## Smoke

Automated (CI / local):

```bash
node --test src/lib/cp-runtime/comfy-adapter.test.mjs
```

Test dựng **fake Comfy HTTP**, chạy `runJobAttemptViaRuntimePort` (chỉ Port):

`create → submit → monitor → fetch → destroy`

Output land vào key Plane B `users/{userId}/cp/jobs/.../attempts/1/outputs/...`.

Live GPU (tuỳ chọn, ops): trỏ `metadata.endpointUrl` tới Comfy thật + `putObject` R2 — cùng orchestrator.

---

## Mapping (Adapter-internal)

| Port | Comfy |
|------|--------|
| create (ready) | `GET /system_stats` |
| submit | `POST /prompt` → `externalExecutionId` = `prompt_id` |
| monitor | `GET /queue` + `GET /history/{id}` → Port status |
| fetch | `listOutputs` + `GET /view` → `putObject` Plane B |
| destroy | Đánh dấu destroyed; optional `releaseCompute` |

---

## Out of scope

- Provider rent/walk offers (**1.6**)  
- Failover Attempt 2 (**1.7**)  
- Persist `runtime_registry` rows (orchestrator/CP DB wiring)  
- Live `object_info` parity (B4)
