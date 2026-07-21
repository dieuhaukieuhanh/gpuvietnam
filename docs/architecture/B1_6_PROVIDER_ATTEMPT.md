# B1.6 — Provider gắn Attempt

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §1.6 |
| **Port / Adapter** | [RuntimePort.md](./RuntimePort.md) · [B1_5_COMFY_ADAPTER.md](./B1_5_COMFY_ADAPTER.md) |
| **Code** | `src/lib/cp-runtime/provider-runtime-bind.js` · `runtime-registry-store.js` |

---

## Purpose

Nối **Provider Adapter** (thuê/hủy GPU) vào Runtime Port:

```text
Attempt
  → provision (Provider.createInstance)
  → Runtime Registry (metadata + endpoint)
  → Port.submit (Comfy Adapter)
  → Attempt status = running
```

**Xong khi:** Một Attempt = một Runtime/GPU.

---

## Invariant

| Rule | Meaning |
|------|---------|
| 1:1:1 | `job_attempt` ↔ `runtime_registry` ↔ provider `instanceId` |
| No CP→Comfy | CP vẫn chỉ gọi Port |
| Destroy | `Port.destroy` → `Provider.destroyInstance`; không xóa Plane B |
| Fail provision | Registry `error`, Attempt `failed`; orphan instance best-effort cancel |

---

## Factory

```js
import {
  createProviderBackedComfyRuntimePort,
  runProviderBackedJobAttempt,
} from '@/lib/cp-runtime/provider-runtime-bind';

const { port, registryStore } = createProviderBackedComfyRuntimePort({
  provider,          // Vast/Clore/… GPUProvider-like
  waitTimeoutMs: 120_000,
  pollMs: 2_000,
  putObject,         // R2 Plane B
});

await runProviderBackedJobAttempt({ port, registryStore }, {
  userId,
  jobId,
  attemptId,
  requiredImageSpecRef: 'gpuvietnam.comfy.v3@1.0',
  gpuLine: 'rtx4090_1x',
  workflowSnapshot,
});
```

### Status flow (Attempt)

`pending → provisioning → submitting → running → succeeded|failed`

### Status flow (Runtime Registry)

`provisioning → starting → ready → busy → stopping → destroyed`

---

## Mapping

| Step | Provider / Port |
|------|-----------------|
| Thuê máy | `provider.createInstance({ gpuLine, image })` |
| Chờ endpoint | `waitForProviderEndpoint` → `getInstanceStatus` |
| Ghi Registry | `runtime_registry` fields (in-memory store; DB later) |
| Ready + parity | Adapter `create` health + Image Spec |
| Submit | Port `submit` → Attempt `running`, Runtime `busy` |
| Xong | `fetch` + `destroy` → `destroyInstance` |

Image Docker: `resolveGpuImage(gpuLine)` · Spec: `resolveImageSpecRefForGpuLine(gpuLine)`.

---

## Tests

```bash
node --test src/lib/cp-runtime/provider-runtime-bind.test.mjs
```

Fake Provider (endpoint publish trễ) + fake Comfy → full Job; assert đúng 1 `instanceId` bị destroy.

---

## Out of scope

- Failover Attempt 2 → [B1_7_FAILOVER.md](./B1_7_FAILOVER.md)  
- Persist Supabase `runtime_registry` / `job_attempts` từ store (ops/wire tiếp)  
- Marketplace offer walk / bad-host (đã nằm trong Provider; binder gọi `createInstance` như black box)  
- Dashboard (**1.8**)
