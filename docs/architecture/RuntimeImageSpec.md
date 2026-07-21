# B1.3.5 — Runtime Image Spec (parity)

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §1.3.5 |
| **Architecture** | Principle 9 — Image / Node / Model parity ([ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md)) |
| **Build SoT (nodes)** | [`image/official-nodes.lock`](../../image/official-nodes.lock) · [COMFYUI_IMAGE.md](../COMFYUI_IMAGE.md) |
| **Storage** | Stock models = Plane C ([B1_3_STORAGE_SPEC.md](./B1_3_STORAGE_SPEC.md)) |
| **Code** | `src/lib/cp-runtime/runtime-image-spec.js` |
| **DB attach** | `runtime_registry.image_spec_ref` · `job_attempts.image_spec_ref` · `jobs.required_image_spec_ref` (**0045**) |

---

## Purpose

Trước khi submit Attempt, Control Plane phải biết Runtime **đủ môi trường** hay không:

- đúng Docker image / profile  
- đúng custom nodes (pin commit)  
- đúng extensions GPUVietnam  
- đúng models / LoRA bắt buộc (stock hoặc user asset)

**Chỉ có GPU là chưa đủ** (Freeze §9).

**Xong khi (roadmap):** Trước submit biết Runtime “đủ môi trường” hay không.

---

## Hard rules

1. Attempt **chỉ** chạy khi `evaluateImageSpecParity` → `ok: true`.  
2. `image_spec_ref` trên Runtime Registry = môi trường **máy đang mang**.  
3. `jobs.required_image_spec_ref` = môi trường Job **đòi hỏi** (chốt lúc submit).  
4. `job_attempts.image_spec_ref` = copy của Runtime (hoặc required) lúc Attempt chạy — audit.  
5. Node pack build vẫn pin SHA trong `official-nodes.lock`; CP catalog **đọc lockfile** + metadata Docker/stock.  
6. Model weights **không** bake vào image (trừ khi Image note khác); stock lấy từ R2 Plane C.  
7. Chi tiết probe `object_info` live trên Runtime = B4 (4.2); B1.3.5 = **spec + gate theo declared ref**.

---

## Spec identity

Format:

```text
gpuvietnam.comfy.{profile}@{pack_version}
```

| `spec_id` | Profile | Docker tag (default) | GPU lines (default) |
|-----------|---------|----------------------|---------------------|
| `gpuvietnam.comfy.v3@1.0` | `v3` | `dieuhaukieuhanh/gpuvietnam-comfyui:v3` | 3090 / 4090 |
| `gpuvietnam.comfy.v4@1.0` | `v4` | `dieuhaukieuhanh/gpuvietnam-comfyui:v4` | 5090 |

`pack_version` `1.0` = Official Image v1.0 (MVP) trong `COMFYUI_IMAGE.md`.

**Compatibility:** profile `v4` **satisfies** requirement `v3` (node pack ⊇). Ngược lại thì không.

---

## Document shape (`RuntimeImageSpec`)

```json
{
  "spec_id": "gpuvietnam.comfy.v3@1.0",
  "runtime_kind": "comfy",
  "pack_version": "1.0",
  "profile": "v3",
  "docker": {
    "repository": "dieuhaukieuhanh/gpuvietnam-comfyui",
    "tag": "v3",
    "image": "dieuhaukieuhanh/gpuvietnam-comfyui:v3"
  },
  "cuda": { "target": "12.0" },
  "custom_nodes": [
    { "dir": "ComfyUI-Impact-Pack", "git_url": "…", "commit": "…" }
  ],
  "extensions": ["gpuvietnam_branding", "gpuvietnam_backup"],
  "stock_models": [
    { "relative": "checkpoints/sd_xl_base_1.0.safetensors", "required": true }
  ],
  "loras": [],
  "satisfies_spec_ids": ["gpuvietnam.comfy.v3@1.0"]
}
```

| Field | Ý nghĩa |
|-------|---------|
| `custom_nodes` | Từ `official-nodes.lock` (`common` + profile) |
| `extensions` | Custom nodes GPUVietnam bake trong image (không nằm lockfile git) |
| `stock_models` | Relative dưới `stock/models/` — stage-in được từ Plane C |
| `loras` | LoRA **stock** bắt buộc (nếu có); LoRA user = `cp_assets` / Job inputs |
| `satisfies_spec_ids` | Các `required` mà Runtime này được phép nhận |

---

## Attachment (Registry / Job / Attempt)

```text
Job.required_image_spec_ref  ──parity──►  Runtime.image_spec_ref
                                              │
                                              ▼
                                     Attempt.image_spec_ref
                                     (copy lúc bind Runtime)
```

| Column | Table | Meaning |
|--------|-------|---------|
| `required_image_spec_ref` | `jobs` | Spec Job đòi (migration **0045**) |
| `image_spec_ref` | `runtime_registry` | Spec Runtime mang sau provision |
| `image_spec_ref` | `job_attempts` | Spec dùng cho Attempt đó |

Provision (1.6): `resolveImageSpecRefForGpuLine(gpuLine)` → ghi `runtime_registry.image_spec_ref` + `image` Docker.  
Submit Attempt (1.5+): gọi `evaluateImageSpecParity` — fail sớm nếu không khớp.

---

## Parity evaluation (B1 gate)

```text
evaluateImageSpecParity({
  requiredSpecId,
  runtimeSpecId,
  requiredNodes?,    // optional extras from workflow (later)
  requiredModels?,   // stock relative keys or filenames
  requiredLoras?,
})
→ { ok, code, missing: { nodes[], models[], loras[], reason? } }
```

Rules:

1. Resolve cả hai id từ catalog; thiếu id → `ok: false`, `code: unknown_spec`.  
2. `runtime.satisfies_spec_ids` phải chứa `requiredSpecId` (hoặc bằng nhau).  
3. Mỗi `requiredNodes` ⊆ `runtime.custom_nodes.dir` ∪ `extensions`.  
4. Mỗi `requiredModels` phải có trong `runtime.stock_models` **hoặc** được đánh dấu đã có trên kho bền user (Adapter/1.5 truyền `availableUserModels`).  
5. Tương tự `requiredLoras`.

**Không** gọi Comfy `/object_info` trong B1.3.5 — đó là automated parity B4 §4.2.

---

## Default stock models (MVP)

Đồng bộ tối thiểu với `scripts/download-models.sh` / [STOCK_MODELS_R2.md](../STOCK_MODELS_R2.md):

- `checkpoints/sd_xl_base_1.0.safetensors`  
- `checkpoints/RealVisXL_V6.0_B1.safetensors`  
- `upscale_models/RealESRGAN_x4plus.pth`  

Weights khác (IPAdapter, ControlNet, …) = optional / tải khi workflow cần — chưa cứng vào `required: true` trừ khi Job khai báo.

---

## Relationship to Official Image docs

| Concern | SoT |
|---------|-----|
| Pin commit node khi **build** Docker | `image/official-nodes.lock` |
| Mô tả nhân image / smoke | `docs/COMFYUI_IMAGE.md` |
| Resolve Docker tag theo GPU line (provision) | `src/lib/gpu/gpu-config.js` → `resolveGpuImage` |
| Parity gate CP trước Attempt | `src/lib/cp-runtime/runtime-image-spec.js` |

Đổi Official Pack: cập nhật lockfile → rebuild image → bump `pack_version` / `spec_id` nếu breaking → cập nhật catalog.

---

## Acceptance checklist

- [x] `RuntimeImageSpec.md`  
- [x] Catalog + parity evaluator + tests  
- [x] Gắn cột Job + dùng lại `image_spec_ref` Registry/Attempt  
- [ ] Live probe Runtime `object_info` — **B4 / 4.2**  
- [ ] Wire vào Adapter submit path — **1.5–1.6**  

---

## Out of scope

- Runtime Port → [RuntimePort.md](./RuntimePort.md); Comfy Adapter (1.5)  
- Failover orchestration (1.7)  
- Warm pool image pre-pull policy (B4)  
- User-installed custom nodes restore (Image v2.0 product note)
