# GPUVietnam Official Image — Source of Truth

**Version:** Image v1.0 (MVP)  
**Lockfile:** [`image/official-nodes.lock`](../image/official-nodes.lock)  
**Tags:** `dieuhaukieuhanh/gpuvietnam-comfyui:v3` · `dieuhaukieuhanh/gpuvietnam-comfyui:v4`

Mọi thay đổi Official Node Pack = **versioned change**: cập nhật lockfile → rebuild → smoke test → phát hành.

---

## Image v3 (RTX 3090 / RTX 4090)

CUDA ~12.0 · PyTorch cu118 · supply host rộng.

### Core

- ComfyUI
- ComfyUI Manager
- GPUVietnam Branding
- GPUVietnam Backup

### Official Node Pack

- ComfyUI-Impact-Pack
- Impact Subpack
- ComfyUI-KJNodes
- ComfyUI-Essentials
- ComfyUI_IPAdapter_Plus
- comfyui_controlnet_aux
- Ultimate SD Upscale
- ComfyUI-Florence2
- ComfyUI-RMBG (`1038lab/ComfyUI-RMBG`)
- ComfyUI-Custom-Scripts

**IPAdapter FaceID / insightface:** **không** bake trong v1.0 (IPAdapter basic vẫn có). FaceID = Image v1.1+ nếu nhu cầu thực tế đủ lớn.

**SAM2 (facebookresearch):** đã tích hợp từ source local `vendor/sam2` (commit `2b90b9f5ceec907a1c18123530e92e794ad901a4`).  
- Dockerfile: `COPY vendor/sam2` → `RUN SAM2_BUILD_CUDA=0 pip install --no-cache-dir --no-build-isolation /app/vendor/sam2` (sau PyTorch; tắt CUDA compile; tái dùng torch đã cài — tránh tải torch lần 2).  
- Không dùng `git+https` lúc build (Impact Pack vẫn strip dòng sam2 VCS).  
- Model weights SAM2 **không** bake (tải vào `models/sams` khi cần).

---

## Image v4 (RTX 5090)

Toàn bộ v3 +

- AnimateDiff Evolved
- Video Helper Suite
- ffmpeg (apt)

CUDA 12.8 · PyTorch cu128.

Hai image chỉ khác: CUDA / PyTorch / driver target / node phục vụ Video AI (v4).

---

## Không bake vào image

Model / weights tải từ R2 stock hoặc nguồn chính thức khi cần:

- IPAdapter · ControlNet · Florence2 · AnimateDiff motion · RMBG · SAM

---

## Quy tắc build

1. Pin **commit SHA** trong `image/official-nodes.lock` — không clone `main` trần.
2. Không bake model weights.
3. Cài node qua `scripts/install-official-nodes.sh` (`PROFILE=v3|v4`).
4. Sau build: chạy **smoke test** bên dưới; chỉ ship khi pass.

```bash
# v3
docker build -f Dockerfile.v3 -t dieuhaukieuhanh/gpuvietnam-comfyui:v3 .
# v4
docker build -f Dockerfile -t dieuhaukieuhanh/gpuvietnam-comfyui:v4 .
```

---

## Smoke test bắt buộc

Checklist node pack tối thiểu (dưới đây). E2E Dashboard + backup/restore: [`docs/SMOKE_TEST_CHECKLIST.md`](./SMOKE_TEST_CHECKLIST.md).

### v3

- [ ] Face Detailer (Impact)
- [ ] IPAdapter cơ bản
- [ ] ControlNet (1 preprocessor)
- [ ] Ultimate SD Upscale
- [ ] Florence2
- [ ] RMBG

### v4

Toàn bộ v3, thêm:

- [ ] AnimateDiff Evolved
- [ ] Video Helper Suite

---

## Nguyên tắc cập nhật node

Không bổ sung theo cảm tính. Chỉ đưa vào Official Pack khi:

- Nhiều khách dùng trong thực tế
- Xuất hiện trong nhiều workflow phổ biến
- Ổn định, ít xung đột
- Giá trị rõ ràng cho đa số

### Lộ trình

| Version | Nội dung |
|---------|----------|
| **v1.0 (MVP)** | Khóa pack trên; không thêm node |
| **v1.1** | Điều chỉnh theo thống kê 3–6 tháng |
| **v2.0** | Restore custom nodes do user tự cài (manifest + fail-soft) |

---

## UX / support

- Image đã gồm Official Node Pack — khách thường **không cần** cài thêm.
- Node tự cài qua Manager **có thể mất** khi mở phiên mới (đến Image v2.0 / Workspace restore nodes).
- Resolve runtime: `resolveGpuImage(gpuLine)` — Starter/Pro → `:v3`, Studio → `:v4`.
