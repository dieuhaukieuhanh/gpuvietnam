# B1.3 — Persistent Storage Spec (kho bền)

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §1.3 |
| **Architecture** | [ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md) · [ADR-005](./ADR-005-control-plane-runtime-v2.md) |
| **Depends on** | [B1_2_DATA_MODEL.md](./B1_2_DATA_MODEL.md) |
| **Branch** | `feat/cp-runtime-b1` |
| **Code** | `src/lib/cp-runtime/storage-paths.js` · migration **0044** `cp_assets` |

---

## Purpose

Định nghĩa **kho bền ngoài ổ GPU** cho input / output / quy ước model, để:

- Hủy Runtime / máy **không mất** file cần cho Attempt sau  
- Control Plane giữ **catalog** (Assets) độc lập với ComfyUI process  
- Adapter chỉ stage-in / stage-out; CP không phụ thuộc `/history` hay disk Comfy

**Xong khi (roadmap):** Hủy máy không mất file cần cho Attempt sau.

---

## Hard rules (v2.0)

1. **GPU disk = ephemeral.** Mọi thứ chỉ nằm trên container/host GPU được coi là mất khi destroy.  
2. **Durable SoT = object storage + CP catalog.** Cloudflare R2 (S3 API) + bảng `cp_assets` (+ `result_manifest` trên Job/Attempt).  
3. **Session Restore ≠ Job Resume.** File bền giúp *chạy lại* Attempt; không resume CUDA/queue.  
4. **Model parity ≠ user file ownership.** Stock/shared models thuộc **Runtime Image Spec (1.3.5)**; file user upload thuộc kho user.  
5. **CP không gọi Comfy API trực tiếp** để “đọc ổ máy” làm SoT — chỉ qua Runtime Port / Adapter (1.4+).

---

## Two planes (không trộn)

| Plane | Vai trò | Prefix R2 (hiện tại / mới) | Index DB |
|-------|---------|----------------------------|----------|
| **A. Workspace backup** (đã có) | Backup máy đang chạy / stop-backup | `users/{userId}/(outputs\|workflows\|models\|settings)/…` | `storage_files` |
| **B. CP execution durable** (B1.3) | Input Job + output Attempt + asset catalog | `users/{userId}/cp/…` | `cp_assets` + manifests |
| **C. Stock / shared** (đã có) | Model dùng chung, read-only | `stock/models/…` | Image Spec (1.3.5), không tính quota user |

Plane A **không** thay Plane B. Backup workspace phục vụ “khách mở lại file trên dashboard”; Plane B phục vụ **Job/Attempt failover**.

---

## Object key layout (Plane B)

Canonical helpers: `src/lib/cp-runtime/storage-paths.js`.

```text
users/{userId}/cp/
  projects/{projectId}/
    assets/{assetId}/{filename}          # upload gắn Project (tái dùng nhiều Job)
  jobs/{jobId}/
    inputs/{filename}                    # input chốt lúc submit Job
    attempts/{attemptNumber}/
      outputs/{filename}                 # output sau fetch từ Runtime
      logs/{filename}                    # optional diagnostic
      sidecar/{filename}                 # optional (manifest phụ, preview)
```

**Stock (Plane C) — không đổi:**

```text
stock/models/{category}/{filename}
```

Ví dụ: `stock/models/checkpoints/sd_xl_base_1.0.safetensors`  
(xem [STOCK_MODELS_R2.md](../STOCK_MODELS_R2.md))

### Key rules

- Không `..`, không segment rỗng, charset `[a-zA-Z0-9._\-/]`.  
- `attemptNumber` = integer ≥ 1 (khớp `job_attempts.attempt_number`).  
- Relative name trong `inputs/` / `outputs/` không chứa `/` (một file / key leaf).  
- Full R2 key luôn bắt đầu `users/{userId}/cp/` hoặc `stock/`.

---

## Ownership

| Ai | Sở hữu gì |
|----|-----------|
| **User** | Quyền dữ liệu: Project assets, Job inputs, Attempt outputs (theo `user_id`) |
| **Control Plane** | Catalog `cp_assets`, `jobs.result_manifest`, `job_attempts.result_manifest` |
| **Runtime (Comfy)** | Bản **working copy** tạm trên disk GPU; không phải SoT |
| **Provider / machine** | Không sở hữu object key; destroy không cascade xóa R2 Plane B |

`cp_assets.user_id` bắt buộc. Liên kết tùy chọn: `project_id`, `job_id`, `attempt_id`.  
Destroy `runtime_registry` / `machines` **không** xóa `cp_assets`.

---

## Asset kinds (`cp_assets.kind`)

| kind | Ý nghĩa | Thường gắn |
|------|---------|------------|
| `input` | File đưa vào Job (ảnh, mask, …) | `job_id` |
| `output` | File lấy ra sau Attempt thành công | `attempt_id` (+ `job_id`) |
| `project_asset` | File Project tái dùng | `project_id` |
| `log` | Log/diagnostic Attempt | `attempt_id` |
| `model_ref` | Tham chiếu model **user** (không phải stock) | `project_id` / `job_id` |
| `sidecar` | Metadata phụ (preview, json) | `attempt_id` |

Stock models **không** bắt buộc insert `cp_assets` — ghi trong Image Spec / `image_spec_ref`.

---

## Lifecycle

```text
[Upload / chọn asset]
        │
        ▼
  cp_assets (pending|ready)  +  object trên R2
        │
        ▼
  Job submit → freeze input refs vào jobs.metadata / workflow_snapshot
        │
        ▼
  Attempt N: Adapter stage-in (R2 → Runtime working dirs)
        │
        ▼
  Execute on GPU (ephemeral)
        │
   ┌────┴────┐
   ▼         ▼
success    fail / GPU chết
   │         │
   ▼         ▼
stage-out  Attempt FAILED
R2 outputs  (giữ inputs; không phụ thuộc disk máy A)
cp_assets  → Attempt N+1 stage-in lại từ cùng input keys
ready
   │
   ▼
jobs / job_attempts.result_manifest cập nhật
```

### Stage-in (trước/trong submit Attempt)

1. CP/Adapter đọc input refs từ Job (+ Image Spec models từ Plane C).  
2. Tải object bền → thư mục làm việc Runtime (qua Port; chi tiết 1.4–1.5).  
3. Thiếu object hoặc checksum lệch → **không** chạy Attempt (`failed` / retry provision).

### Stage-out (sau Attempt success)

1. Adapter fetch output từ Runtime → PUT R2 theo key Attempt.  
2. Insert/update `cp_assets` (`kind=output`, `status=ready`).  
3. Ghi `job_attempts.result_manifest` (và có thể roll-up `jobs.result_manifest`).  
4. Chỉ sau đó mới an toàn destroy Runtime.

### Failover

| Còn trên kho bền | Mất khi hủy máy |
|------------------|-----------------|
| Job inputs (`…/cp/jobs/{id}/inputs/…`) | Working copy Comfy |
| Project assets | In-process queue / history Comfy |
| Outputs Attempt đã stage-out | Partial files chưa PUT R2 |
| Stock models (Plane C) | VRAM / tensors |

Attempt mới **đọc lại** cùng input keys + Image Spec; không resume từ giữa CUDA.

### Retention (policy — có thể tinh chỉnh sau)

| Class | Default (B1) |
|-------|----------------|
| Job inputs | Giữ ít nhất đến Job `succeeded` \| `failed` \| `cancelled` + grace (ops) |
| Attempt outputs (winner / final) | Giữ theo retention backup user / gói storage |
| Attempt outputs (failed / superseded dual-run) | Có thể GC sớm hơn; catalog đánh `deleted` |
| Workspace backup (Plane A) | Giữ theo cron backup-retention hiện có |
| Stock (Plane C) | Vòng đời image/ops, không GC theo user Job |

Chi tiết purge cron Plane B: **chưa** bắt buộc trong B1.3; spec cho phép GC sau khi có Adapter.

---

## `result_manifest` shape

Lưu trên `job_attempts.result_manifest` và/hoặc `jobs.result_manifest` (jsonb).

```json
{
  "schema": "cp.storage.manifest.v1",
  "inputs": [
    {
      "asset_id": "uuid",
      "r2_key": "users/{userId}/cp/jobs/{jobId}/inputs/photo.png",
      "filename": "photo.png",
      "content_type": "image/png",
      "bytes": 12345,
      "sha256": "optional"
    }
  ],
  "outputs": [
    {
      "asset_id": "uuid",
      "r2_key": "users/{userId}/cp/jobs/{jobId}/attempts/2/outputs/result_00001_.png",
      "filename": "result_00001_.png",
      "content_type": "image/png",
      "bytes": 999,
      "sha256": "optional"
    }
  ],
  "model_refs": [
    {
      "source": "stock",
      "r2_key": "stock/models/checkpoints/sd_xl_base_1.0.safetensors"
    }
  ]
}
```

`model_refs` với `source: "stock"` trỏ Image Spec / Plane C; không thay thế 1.3.5.

---

## Runtime working dirs (ephemeral — Adapter)

Quy ước **logical** (Comfy Adapter map sang path Comfy thật ở 1.5):

| Logical | Ý nghĩa |
|---------|---------|
| `work/inputs/` | Bản sao stage-in từ Plane B |
| `work/outputs/` | File sinh ra trước stage-out |
| `work/models/` | Cache local từ stock + user model_ref (parity 1.3.5) |

Không index Plane B từ các path này. Destroy Runtime = xóa working dirs.

---

## Auth & secrets

- R2 access key **chỉ** trên Control Plane / app server.  
- Runtime nhận **presigned URL** hoặc token scoped (pattern giống backup presign) — **không** nhúng `R2_SECRET_*` vào container (cùng nguyên tắc [BACKUP_RUNBOOK.md](../BACKUP_RUNBOOK.md)).  
- Plane B keys **không** đi qua allowlist backup `outputs|workflows|models|settings`; API CP riêng (implement khi 1.5+).

---

## Relationship to existing modules

| Module | Giữ nguyên | Ghi chú B1.3 |
|--------|------------|--------------|
| `r2-client.js` | Endpoint / client / generic presign GET | Thêm path builder CP; chưa bắt buộc đổi backup PUT |
| `machine-backup-token.js` | Plane A only | Không mở prefix `cp/` vào backup token |
| `storage_files` | Dashboard SSD/backup catalog | Không thay `cp_assets` |
| `stock-models` / STOCK_MODELS_R2 | Plane C | Image Spec 1.3.5 tham chiếu |

---

## Acceptance checklist

- [x] Spec đường dẫn / ownership / lifecycle  
- [x] Path helpers + unit test  
- [x] Catalog table `cp_assets` (migration **0044**)  
- [ ] Presign/API Plane B + Adapter stage-in/out — **1.4 / 1.5**  
- [ ] Apply migration lên môi trường — **ops khi sẵn sàng**

---

## Out of scope

- Runtime Port / Comfy Adapter (1.4–1.5)  
- Runtime Image Spec đầy đủ (1.3.5)  
- Dual-run winner GC policy chi tiết (B3)  
- Thay thế toàn bộ Plane A backup UX  

---

## Apply migration

```bash
node scripts/run-migrations.mjs
```

Manifest: id **0044**, file `supabase/cp-runtime-v2-storage-assets.sql`, depends on **0043**.
