# Architecture Freeze — Control Plane / Runtime v2.0

| | |
|---|---|
| **Status** | **Frozen** |
| **Effective** | 2026-07-21 |
| **Name** | GPUVietnam Architecture v2.0 (Control Plane / Runtime) |
| **Companion ADR** | [ADR-005-control-plane-runtime-v2.md](./ADR-005-control-plane-runtime-v2.md) |
| **Code checkpoint** | Git tag `checkpoint/pre-cp-runtime-split` |
| **Evidence base** | ComfyUI investigation tickets #001–#006 (HTTP, WebSocket, assets, filesystem, boundary, ephemeral runtime) |

---

## Executive Summary

Kể từ thời điểm này, kiến trúc **Control Plane ↔ Runtime Port ↔ Runtime Adapter ↔ ComfyUI Runtime ↔ Provider Adapter** của GPUVietnam được xem là **Frozen**.

**Nguyên tắc gốc:** GPU không còn là nơi lưu trạng thái làm việc. GPU chỉ là **Compute Resource**. Mọi trạng thái lâu dài của người dùng nằm ngoài GPU / ngoài process ComfyUI.

**Trọng tâm tiếp theo:** triển khai theo v2.0 (bắt đầu Phase B1 — tách mỏng Job/Attempt + Runtime Adapter), **không** mở lại tranh luận kiến trúc trừ khi có bằng chứng kỹ thuật và ADR mới được phê duyệt.

Freeze này **không thay thế** [SCB Architecture Freeze](../scb/ARCHITECTURE-FREEZE-v2.md) (billing/session hours). Hai trục bổ sung nhau:

| Freeze | Phạm vi |
|--------|---------|
| SCB | Billing, hours, machine operation queue (phiên GPU thương mại) |
| **v2.0 CP/Runtime (tài liệu này)** | Session/Project/Workflow/Job/Attempt vs ComfyUI/GPU compute |

---

## Change Policy

Mọi quyết định triển khai sau freeze phải trả lời:

> **Quyết định này có vi phạm các nguyên tắc Architecture v2.0 không?**

| Loại | Được phép khi |
|------|----------------|
| **A. Bug fix** | Sửa lệch so với nguyên tắc/spec đã freeze; diff tối thiểu |
| **B. Feature / implementation** | Không vi phạm 10 nguyên tắc; mở rộng qua Runtime Port, Adapter, Policy |
| **C. Architecture change** | Chỉ khi có **ADR mới** trong `docs/architecture/ADR-*.md` được phê duyệt, kèm evidence kỹ thuật (không chỉnh theo cảm tính) |

---

## Ten Frozen Principles

### 1. Control Plane is the Single Source of Truth

Control Plane lưu và sở hữu:

- User  
- Session  
- Project  
- Workflow  
- Assets (catalog / durable references)  
- Billing  
- Runtime Registry / Runtime Metadata  
- Job  
- Attempt  

**Control Plane không phụ thuộc vào bất kỳ GPU cụ thể nào để giữ dữ liệu người dùng.**

### 2. ComfyUI is only a Runtime Engine

ComfyUI chịu trách nhiệm:

- Execute workflow  
- In-process queue  
- CUDA / device context  
- VRAM / model loading  

ComfyUI **không** sở hữu dữ liệu lâu dài (Session, Project, product History, Billing).

### 3. GPU is only a Compute Resource

GPU có thể: tạo, hủy, thay thế, đổi provider — **mà không làm mất Project / Session / Workflow** đã lưu trên Control Plane.

### 4. Runtime Adapter is the firewall to ComfyUI

- Toàn bộ dialect ComfyUI (HTTP/WS/`object_info`/paths…) được cô lập trong **Comfy Adapter** (implement của Runtime Port).  
- **Control Plane không gọi API ComfyUI trực tiếp.**

### 5. Provider Adapter isolates GPU infrastructure

Có thể thay Vast / Clore / Salad / RunPod / Local GPU qua Provider Adapter.

*Ghi chú vận hành:* routing, pricing, billing rules có thể cần cấu hình khi thêm provider; **không** được phá ranh giới 4 lớp hay đưa SoT dữ liệu user xuống GPU.

### 6. Job and Session are different concepts

**Session path (làm việc / ngữ cảnh):**

```text
User → Session → Project → Workflow
```

**Job path (thực thi):**

```text
Generate → Job → Attempt(s)
```

Khi GPU chết:

```text
Attempt 1 → FAIL → Attempt 2
```

- Không resume CUDA.  
- Không resume queue ComfyUI trong process đã chết.

### 7. Session Restore ≠ Job Resume

Sau failover:

| Restore (✔) | Không restore (✘) |
|-------------|-------------------|
| Session | CUDA context |
| Workflow | In-process queue |
| Assets (durable) | Tensors / VRAM |
| Project | Job đang chạy giữa chừng |

Người dùng **tiếp tục làm việc trên Project/Session**; job đang chạy phải **Attempt mới** (hoặc dual-run policy).

### 8. Runtime Policy is independent of architecture

Các chế độ sau là **policy**, không đổi 4 lớp:

- Warm  
- Standby  
- Ephemeral  
- Dual-run  

### 9. Image / Node / Model parity is mandatory

Một Runtime chỉ được nhận Attempt khi đủ:

- đúng image  
- đúng custom nodes  
- đúng models / LoRA  
- đúng extensions cần thiết  

**Chỉ có GPU là chưa đủ.**

### 10. Dual-run is an execution policy, not a new architecture

```text
Job
 ├── Attempt A → GPU A / Runtime A
 └── Attempt B → GPU B / Runtime B
```

Hai Attempt độc lập; không share một process ComfyUI.

---

## Frozen Layer Diagram

```text
User
  │
  ▼
Control Plane
  ├── User / Session / Project / Workflow
  ├── Assets / Billing
  ├── Runtime Registry (metadata)
  ├── Job
  └── Attempt
        │
        ▼
  Runtime Port          ← stable interface for Control Plane
        │
   ┌────┴────┐
   ▼         ▼
Comfy     (Future adapters…)
Adapter
   │
   ▼
ComfyUI Runtime         ← execute / queue / CUDA / VRAM / load
   │
   ▼
Provider Adapter
   │
 ┌─┼──────────┐
 ▼ ▼          ▼
Vast Clore  Salad/RunPod/…
   │
   ▼
GPU Compute
```

---

## Recommended Implementation Order (post-freeze)

Không mở lại kiến trúc; thứ tự triển khai gợi ý:

1. **B1** — Job/Attempt + Runtime Port + Comfy Adapter; submit/monitor/fetch; failover = Attempt mới; durable input/output.  
2. **B2** — Session/Project continuity trên UI khi đổi Runtime.  
3. **B3** — Dual-run policy (render an toàn).  
4. Cứng hóa — health, auto-replace, Warm/Ephemeral policy, đo CUDA thật.

---

## Evidence Anchors (do not re-litigate without new data)

| Chủ đề | Kết luận đã verify |
|--------|-------------------|
| Middleware/CP không thay execution Python/CUDA | Ticket #005 — PARTIAL as engine behind CP |
| History/queue Comfy ephemeral | Ticket #004 / #006 |
| Ephemeral create→exec→destroy→recreate | Ticket #006 (CPU core workflow) |
| object_info / extensions / FS coupling | Ticket #003 / #004 |
| WS `client_id` / `feature_flags` | Ticket #002 |
| Code snapshot trước triển khai tách | Tag `checkpoint/pre-cp-runtime-split` |

---

## Related Documents

- [ADR-005 — Control Plane / Runtime v2.0](./ADR-005-control-plane-runtime-v2.md)  
- [GPUVietnam_TinhNang_RenderAnToan.md](../GPUVietnam_TinhNang_RenderAnToan.md) (product note; dual-run = policy)  
- [COMFY_PROXY.md](../COMFY_PROXY.md) (brand proxy; rebind upstream under Adapter/CP rules)  
- SCB freeze: [ARCHITECTURE-FREEZE-v2.md](../scb/ARCHITECTURE-FREEZE-v2.md)
