# GPUVietnam — Tiến độ dự án

> File này giúp chat / dev mới nắm context nhanh. Cập nhật khi hoàn thành milestone lớn.

## Stack

- **Framework:** Next.js 14 Pages Router (`src/pages/`, `src/components/pages/`)
- **Auth & DB:** Supabase Auth + Postgres + Storage (`@supabase/supabase-js`)
- **OTP SMS:** Speedsms.vn (dev: thiếu token → OTP hiện trên `/verify-otp`)
- **ComfyUI (GPU):** prod image `:v3.7` (Starter/Pro) + `:v4.4` (Studio); port **8080**; providers Vast + Clore + Salad; **P0-A VPS: Vast-only**; code default attempt `salad→vast→clore` nếu không set flag
- **Control Plane:** Vercel (`gpuvietnam.com`) · **Lifecycle worker:** VPS systemd `gpuvietnam-lifecycle-worker`
- **Sau MVP (park):** MakeStudio (Train/Preview/Final) · LoRA train API — scaffold giữ, không ưu tiên trước Go-Live

## Thay đổi gần đây (2026-08)

| Hạng mục | Trạng thái |
|----------|------------|
| **Host Intelligence System** | ✅ **2026-08-06** + **vá/Clore 2026-08-08**. **Scheduler:** systemd `gpuvietnam-host-intel.timer` (25 phút) → `scripts/host-intelligence-cron.mjs`. **Không** trong `vercel.json`. Sổ `vast-host:*` / `clore-host:*`. Vast: 3090/4090/5090. Clore cycle **đã wire** (Discover/Recheck/BadRetry + Admin card); default `providers.clore=false` — bật qua Admin. Available = known-good ∩ chợ. Fair deficit slots. Debt: passRate-on-fail. |
| **gpu-test HOST=0.0.0.0** | ✅ **2026-08-08** — Bake `HOST=0.0.0.0` trong `docker/test-gpu`; Hub `gpu-test:v1` digest `sha256:fd74e09b…`. ComfyUI/MakeStudio dùng `COMFYUI_LISTEN` (không đổi bake). |
| **MakeStudio (Train / Preview / Final)** | ⏸️ **Sau MVP** — Scaffold UI + API + SQL `0053` + Docker có sẵn (`/dashboard/makestudio`). **Không** ưu tiên trước Go-Live / Staging RC6. Còn bug snake↔camel, chưa nav, chưa billing/E2E. |
| **SePay (CK tự động)** | ✅ **2026-08-08 chốt xong** — VietQR + webhook HMAC + match nạp ví/gói/tái tục; mã CK `NVxxxx` (6 ký tự, số); SQL `0054`; cron reconcile daily Hobby; env/webhook prod đã cấu hình; **test nạp ví thật OK**. Tick “đã CK” chỉ đóng UI — không cộng tiền. Ops: [`SEPAY_SETUP.md`](operations/SEPAY_SETUP.md). |
| **P0-B T11 billing proof** | ✅ **2026-08-08** — Full prod PASS (`tmp/p0b-t11-1786206245215.json`). Vast `v3.7`, `started_at` set, hold 120s, settle + no double charge. Harness + [`P0B_T11_BILLING_PROOF.md`](operations/P0B_T11_BILLING_PROOF.md). |
| **SaladCloud GPU Provider** | ✅ **2026-08-05** — SaladClient + adapter + gate. **Ops VPS:** Vast-only. **Code default** (không flag): attempt `salad→vast→clore`; `PROVIDER_ROUTING.sequence` = `vast→clore→salad`. Salad: 35 GB image max, AMD64, no SSH; cold start 15–25 phút. |
| **Image IPv6 dual-stack (unified)** | ✅ **2026-08-05** — ComfyUI `COMFYUI_LISTEN` (default `::`, Vast+Clore override `0.0.0.0`); 1 image dùng chung 3 provider. **gpu-test** (2026-08-08) dùng `HOST` riêng, bake `0.0.0.0` cho Vast |
| **Image bake SDXL thử nghiệm** | ❌ **2026-08-05** — Bake SDXL 7 GB vào image → Salad chậm hơn 3 phút (33 GB extract lâu trên consumer node); đã revert về v3.7/v4.4 (20 GB) |
| **Auth Hardening — Phase 1 (P0)** | ✅ **13/13** — Rate limit, JWT middleware, Secure cookie, security headers, anti-enumeration, fix phone_verified reset, OTP lock + cooldown + single-use |
| **Auth Hardening — Phase 2 (P1)** | ✅ **4/5** — Password strength (client + server), confirm password, session invalidation on password change, pending_password TTL 1h |
| **Auth Hardening — Phase 3 (P2)** | ✅ **2/4** — Audit log (`auth_audit_log`), sign-out all devices |
| **Storage Plans — Phân biệt theo gói GPU** | ✅ SSD: Starter 30GB / Pro 50GB / Studio 100GB — Backup: Starter 50GB / Pro 100GB / Studio 200GB |
| **P0-A Acceptance Smoke (Phase F.2)** | ✅ **7/7 PASS** — Start → Comfy → Runtime Boot Events |
| **Session Continuity (Backup → Destroy → Start → Restore)** | ✅ E2E verified; workspace auto-restore không giới hạn 200MB; transparent ComfyUI reconnect trên auto-replace |
| **Vast-only routing** | ✅ VPS worker chốt `GPU_VAST_ONLY=true` + `GPU_ALLOW_VAST=true`; fix `isCloreOnlyMode` chặn Vast |
| **R2 Backup/Restore** | ✅ Đã cấu hình R2 trên VPS; backup token luôn được issue (không còn gated behind auto-backup) |
| **GPUVIETNAM_PUBLIC_API_URL fallback** | ✅ Fallback cứng `https://gpuvietnam.com` nếu env không set |
| **Gate timeout** | ✅ `comfyColdStartExtraMs` 90s → 300s cho host Vast chậm pull image |
| **Server-side boot events** | ✅ Worker ghi thẳng `runtime_boot_events` (không phụ thuộc container outbound network) |
| **Editor khi đang boot** | ✅ "🚀 Vào phòng làm việc" thành nút chính trong lúc GPU khởi động |
| **Token auto-refresh** | ✅ Tự refresh session trước stop/cancel/start — không còn silent fail khi token hết hạn |
| **ComfyUI transparent reconnect** | ✅ Update upstream_url giữ nguyên workUrl khi auto-replace — tab không cần F5 |
| **Image v3.7 (Starter/Pro)** | ✅ IPv6 dual-stack + `COMFYUI_LISTEN` env var; ffmpeg + filmmaker scripts + frame-quality-check; 20 GB compressed; VPS active |
| **Image v4.4 (Studio/5090)** | ✅ IPv6 dual-stack + `COMFYUI_LISTEN` env var; đầy đủ tính năng; 24 GB compressed; code default đã là v4.4 |
| **Staging Environment Audit** | 🟡 **2026-08-05** — Đã audit toàn bộ trạng thái: 4-layer gate PASS, Vast readiness `PASS_HTTP_READY`, Scenario 1 FAIL (Clore provider — không phải RC6), 2-5 BLOCKED. Đã tạo `.env.staging` + `.env.production` + script `scripts/switch-env.ps1`. `.env.local` đã khôi phục về Production. |
| **LoRA Training** | ⏸️ **Sau MVP** (đi cùng MakeStudio) — lib + Docker + SQL có; API chưa wire `startLoraTraining`; SQL chưa manifest. |
| **Environment Switching** | ✅ **2026-08-05** — `.env.staging` / `.env.production` + `scripts/switch-env.ps1` |
| **Auth Refactor — Email First** | ✅ **2026-08-08** — Email chính, SĐT phụ (Dashboard). Disposable blocklist 150+. Rollback upsert → không orphan Auth user. |
| **Google OAuth** | ✅ **2026-08-08** — OAuth trực tiếp (consent `gpuvietnam.com`), callback + code exchange. |
| **Zalo ZNS OTP** | ✅ **2026-08-08** — ZNS trước, Speedsms fallback. SĐT verify trong Dashboard mở khóa KM. |
| **Docs sync codebase** | ✅ **2026-08-08** — SePay chốt; MakeStudio/LoRA **park sau MVP**; Host Intel; roadmap §21 |

## Thay đổi gần đây (2026-07)

| Hạng mục | Trạng thái |
|----------|------------|
| **Architecture v2.0 CP / Runtime** | ✅ Freeze + ADR-005; Continuity A→B (Clore) đã chứng minh — Gate2 *PASS WITH CONSTRAINTS* |
| **P0-A Durable start (lifecycle worker)** | ✅ Đã đóng acceptance smoke — Start → Comfy → `completed` PASS |
| **VPS lifecycle worker** | ✅ Host `gv-lifecycle-worker-*`; unit `gpuvietnam-lifecycle-worker`; **chốt Vast-only** (2026-08-01) |
| **Clore provider + bad-host / orphan / gate** | ✅ Adapter + reconcile; Continuity prod E2E trước đó PASS |
| **Go-Live order** | 🟡 P0-A ✅ → P0-B billing T11 → P0-C alerts → P0-D E2E khách; Dual Run / warm pool **sau** |
| **Auto-stop theo gói đang dùng** | ✅ Remaining/out-of-credit chỉ tính Starter/Pro/Studio đang chạy; hết giờ gói đó → tắt dù còn giờ gói khác |
| **Cảnh báo 30 phút trước tắt (hết giờ)** | ✅ `credit_warning_sent` + notification `credit_warning`; UI `lowCreditWarning` = 30 phút |
| **SCB 4.0 đóng băng** | ✅ Tag `scb-4.0` (commit `bbed8da`); ADR-004 ghi nhận 3 ngoại lệ product-layer |
| **Server-authoritative remaining hours** | ✅ `POST /api/machines/destroy` nhận `clientRemainingHours`; CAS-guarded override projection; Truth `gpu_sessions` không đổi |
| **`/api/machines/status` infra-only** | ✅ Bỏ `billingView`/billing fields khỏi response; billing từ `/api/dashboard/me` |
| **Dashboard optimistic UX** | ✅ Optimistic start/stop, boot progress bar, stop confirmation modal, giờ 2 decimal |
| **Wallet tab merge** | ✅ Gộp Ví + Gia hạn tự động + modal nâng cấp bộ nhớ vào `/dashboard/wallet` |
| Image prod ComfyUI | ✅ `:v3.4` (Starter/Pro) + `:v4.1` (Studio); `:v3.5` đang build với filmmaker scripts; không overwrite tag cũ |
| Wire `start-machine` → enqueue + worker | ✅ API trả `operationId`; không còn `void completeUserStartProvision` trên serverless |

> **Go-Live / P0-A (cập nhật 2026-07-24):** VPS worker **active** + `GPU_CLORE_ONLY=true` đã verify trong `/proc/.../environ`. Smoke đêm 23–24/07: Start durable OK; lỗi chính = (1) CLORE_ONLY chưa vào process sớm → Vast+Clore song song / Vast disk-only; (2) candidate walk hủy host Clore khi HTTP **502** lúc pull image → đổi máy liên tục rồi hết order. **Tạm dừng** sau khi chốt Clore-only trên VPS — lần Start sạch tiếp theo = tiếp tục P0-A acceptance.
>
> **Docs ops:** [`docs/operations/LIFECYCLE_WORKER.md`](operations/LIFECYCLE_WORKER.md) · [`docs/operations/GO_LIVE_READINESS_AUDIT.md`](operations/GO_LIVE_READINESS_AUDIT.md)  
> **SCB:** ADR-001..004 closed. **CP/Runtime:** ADR-005 frozen. Xem [`docs/scb/SCB-MAINTENANCE-MODE.md`](scb/SCB-MAINTENANCE-MODE.md).

## Bước tiếp theo

> **Go-Live ngay:** P0-B T11 ✅ → P0-C alerts → P0-D E2E khách.  
> **Đã xong nền:** P0-A ✅, session continuity, auto-replace (không F5), editor khi boot, filmmaker, Host Intel Vast, Auth email-first/Google/Zalo.  
> **Staging RC6:** Scenario 1 trên Vast → 2–5 → VERIFIED → promote.  
> **SePay:** ✅ **chốt xong** (code + ops + test nạp ví thật; mã `NVxxxx`).  
> **MakeStudio / LoRA:** ⏸️ **sau MVP** — scaffold giữ, không làm tiếp trước Go-Live.  
> **Host Intelligence:** Debt passRate-on-fail; đánh giá bật Clore (`providers.clore`); ổn định pool known-good available.  
> **Không làm ngay:** Dual Run, warm pool, MakeStudio/LoRA.  
> **Tech debt:** Vast disk-only lọt filter → harden post-rent gate.  
> **Roadmap dễ hiểu:** xem [`PROJECT_CONTEXT.md` §21](PROJECT_CONTEXT.md#21-roadmap--đang-ở-đâu-còn-làm-gì).

## MakeStudio ⏸️ Sau MVP

Sản phẩm tạo video có mặt (Train LoRA face → Preview 5s → Final). Route: `/dashboard/makestudio`.

| Thành phần | Path | Trạng thái |
|------------|------|------------|
| UI | `src/components/makestudio/*`, `useMakestudio.ts` | ✅ scaffold — chưa sidebar |
| API | `/api/makestudio/jobs`, `[id]`, `upload-images`, `callback`, `train-callback` | ✅ scaffold — bug snake↔camel create |
| SQL | `supabase/makestudio-jobs.sql` (`0053`) | ✅ manifest |
| Docker | `docker/makestudio-preview/`, `makestudio-final/`, train từ `docker/lora-train/` | ✅ scaffold |
| Provision | Train/Final → Vast; Preview → RunPod Serverless | ⏸️ park |

**Park sau MVP:** fix mapping create job · gắn nav · billing/quota · E2E 3 path · wire LoRA `startLoraTraining`. Không ưu tiên trước P0-B..D / Staging RC6.

## SePay (CK tự động) ✅ chốt xong

| Thành phần | Path | Trạng thái |
|------------|------|------------|
| Lib + tests | `src/lib/sepay.js`, `transfer-code.js`, `sepay.test.mjs` | ✅ |
| QR / Webhook | `/api/payment/sepay-qr`, `sepay-webhook` | ✅ |
| Cron reconcile | `/api/cron/sepay-reconcile` + `vercel.json` daily `25 3 * * *` (Hobby) | ✅ |
| SQL | `supabase/sepay-transactions.sql` (`0054`) | ✅ |
| Mã CK | `NVxxxx` (6 ký tự, 4 số) — unique theo pending; nội dung CK = chỉ mã | ✅ |
| Match | Nạp ví · gói GPU · tái tục (`transfer_note` / description có NV) | ✅ |
| UI | Wallet / PlanCheckout / PaymentSection — “tự động duyệt”; tick “đã CK” = đóng UI | ✅ |
| Ops prod | Env `SEPAY_*` + HMAC webhook + cấu trúc mã SePay `NV`+4 số + test nạp ví thật | ✅ |

**Runbook:** [`docs/operations/SEPAY_SETUP.md`](operations/SEPAY_SETUP.md). Admin duyệt tay vẫn dự phòng. (Sau) storage upgrade auto-match nếu cần.

## Filmmaker Mode ✅

Dành cho KH làm phim (render 5000+ frame, 10-24 tiếng):

| Step | File | Chức năng |
|------|------|-----------|
| **1** | `comfyui-extensions/gpuvietnam_cp_sync/nodes.py` | `GpuvietnamFrameSaver` — save ảnh + upload R2 từng frame. `GpuvietnamFrameSkip` — check frame đã có trên R2 → skip |
| **2** | `scripts/filmmaker-resume.py` | Auto-skip frame đã render, resume từ checkpoint, **realtime quality check + auto-repair** |
| **3** | `scripts/start.sh` | Auto-detect job dang dở khi container boot → tự chạy filmmaker-resume |
| **4** | `scripts/frame-quality-check.py` | 3 tầng soi lỗi: MediaPipe Face+Hands + InsightFace Identity + SSIM temporal. Chạy trên GPU hoặc VPS CPU |

**Kiến trúc C — Realtime quality check trên GPU:**
```
for frame 1..5000:
  1. Render frame (ComfyUI, 20s)
  2. Quality check (GPU, 0.3s): MediaPipe + InsightFace
  3. PASS → upload R2 → next frame
     FAIL → seed+1 → render lại (max 3 lần)
```
→ **0 frame lỗi lên R2. KH render 24h, sáng dậy 5000 frame sạch.**

## Docker Image (ComfyUI) ✅

Môi trường AI Art sẵn sàng cho GPUVietnam — chạy ComfyUI trên GPU NVIDIA qua **Vast.ai**.

**Hạ tầng GPU (Vast.ai):**
- Thuê instance **theo giờ thực tế** khi máy KH bật — **không chịu chi phí idle** như pool GPU cố định.
- Image triển khai: **`dieuhaukieuhanh/gpuvietnam-comfyui:v3.4`** (Starter/Pro) + **`:v4.1`** (Studio/5090) trên **Docker Hub**.
- Admin tab **Hạ tầng** (`infrastructure-providers.js`) — bảng giá/market mock cho Admin; **provisioning runtime** đi qua `src/lib/gpu/` (GPUService), không gọi Vast trực tiếp từ UI/API KH.

**Cột mốc Docker (hoàn thành / đang làm lại):**

| Cột mốc | Trạng thái |
|---------|------------|
| Build Docker Image | ✅ `:v3.5` + `:v4.2` đã build & push |
| Chạy ComfyUI local (`http://localhost:8080`) | ✅ |
| Push GHCR (legacy) | ✅ (đã chuyển sang Docker Hub) |
| Push **Docker Hub** | ✅ `:v3.5` (Starter/Pro) + `:v4.2` (Studio/5090) |
| Đặt Public trên registry | ✅ (Docker Hub) |

**Thay đổi Dockerfile mới (2026-06):**

| Thay đổi | Mục đích |
|----------|----------|
| Registry **Docker Hub** thay GHCR | Pull/deploy đơn giản hơn trên Vast |
| `--default-timeout=300 --retries 5` (PyTorch) | Tránh timeout khi tải wheel ~900MB |
| `git clone … \|\| git clone …` (ComfyUI) | Retry khi mạng git lỗi |
| `comfyui-frontend-package==1.45.20` | Tránh lỗi tương thích Python 3.10 |
| `requirements.txt \|\| … --no-deps` | Build không dừng khi xung đột dependency |
| `setup-workstation.sh` + `workflows-stock/` | Lọc workflow theo môi trường (`character-art` / `commerce-product` / `video-ai`) |
| `start.sh` → setup + `download-models.sh` | Nạp workflow + model lúc boot container |

**Tương thích GPU dev (Windows + Docker Desktop):**

| Thành phần | Phiên bản |
|------------|-----------|
| NVIDIA driver | **526.56** (CUDA **12.0** max) |
| Base image | `nvidia/cuda:12.0.0-runtime-ubuntu22.04` |
| PyTorch | `--index-url https://download.pytorch.org/whl/cu118` |

> Image cũ dùng **CUDA 12.1** → lỗi `cuda>=12.1, please update your driver` khi `docker compose up`. Phải **build lại** sau khi đổi Dockerfile (xóa tag `latest`/`v1` cũ nếu cần).

| File | Mục đích |
|------|----------|
| `Dockerfile.v3` | Image v3.x **CUDA 12.0** + PyTorch cu118 (Starter/Pro: 3090/4090) |
| `Dockerfile` | Image v4.x **CUDA 12.8** + PyTorch cu128 + ffmpeg (Studio: 5090) |
| `docker-compose.yml` | Chạy local với GPU |
| `.dockerignore` | Loại trừ `node_modules`, `.next`, `.env`, Supabase, docs |
| `scripts/start.sh` | `setup-workstation.sh` → `download-models.sh` → ComfyUI `:8080` |
| `scripts/setup-workstation.sh` | Copy workflow từ `workflows-stock/` theo `GPUVIETNAM_WORKSTATION` |
| `scripts/download-models.sh` | Tải checkpoint / upscaler (HuggingFace, CivitAI) |
| `workflows/*.json` | 5 workflow stock (lọc theo môi trường khi boot) |

**Đã làm:**
- [x] Dockerfile + healthcheck port 8080
- [x] docker-compose với NVIDIA GPU reservation
- [x] Volumes: `comfyui_models`, `comfyui_output`, mount `./workflows`
- [x] Script tải models: SDXL Base 1.0, RealVisXL V6 (CivitAI), Real-ESRGAN 4x
- [x] 5 workflow mẫu trong `workflows/` (copy vào image + mount compose)
- [x] **Hạ CUDA 12.1 → 12.0** + PyTorch **cu121 → cu118** (tương thích driver 526.56)
- [x] Build image CUDA 12.0 trên máy dev (~15GB)
- [x] `docker compose up -d` — UI **http://localhost:8080** OK
- [x] **Push GHCR** (legacy) — đã chuyển sang Docker Hub
- [x] **`setup-workstation.sh`** — 3 môi trường ComfyUI với bộ workflow riêng
- [x] Dockerfile: PyTorch timeout/retry, pin `comfyui-frontend-package`, retry git clone
- [x] **Push Docker Hub** `dieuhaukieuhanh/gpuvietnam-comfyui:v3.5` + `:v4.2`
- [x] **ffmpeg** tích hợp vào v3.5 cho video support
- [x] **Filmmaker scripts** — filmmaker-resume.py, frame-quality-check.py
- [x] **Frame Saver + Frame Skip custom nodes** (ComfyUI extension)

**Docker Hub:**

```bash
# Tag & push (sau khi build xong)
docker push dieuhaukieuhanh/gpuvietnam-comfyui:v3.5
docker push dieuhaukieuhanh/gpuvietnam-comfyui:v4.2

# Pull trên Vast / máy khác
docker pull dieuhaukieuhanh/gpuvietnam-comfyui:v3.5
docker run --gpus all -p 8080:8080 \
  -e GPUVIETNAM_WORKSTATION=commerce-product \
  dieuhaukieuhanh/gpuvietnam-comfyui:v3.4
```

> GHCR (`ghcr.io/dieuhaukieuhanh/gpuvietnam-comfyui`) — **legacy**, không dùng cho deploy mới.
> Tag mới nhất: `:v3.5` (Starter/Pro), `:v4.2` (Studio/5090). Đầy đủ ffmpeg + filmmaker scripts.

**Còn lại (tích hợp Docker):**
- [x] Hoàn tất build + push Docker Hub (`:v3.5`, `:v4.2`)
- [x] Build `:v3.5` + `:v4.2` với filmmaker scripts
- [ ] Test workflow từng môi trường sau push (Character / Commerce / Video AI)
- [ ] Chạy `download-models.sh` trên instance Vast (SDXL, RealVisXL, Real-ESRGAN)

**Workflow mẫu:**

| File | Mô tả |
|------|--------|
| `tao-anh-san-pham.json` | Tạo ảnh sản phẩm chuyên nghiệp |
| `doi-background.json` | Đổi background tự động |
| `avatar-ghibli.json` | Avatar phong cách Ghibli |
| `upscale-anh-cu.json` | Upscale Real-ESRGAN 4x |
| `sinh-anh-co-ban.json` | Text-to-image cơ bản (SDXL) |

**Build & test:**

```bash
# (Khuyến nghị) Tải base image trước — tránh EOF khi build trên Docker Desktop
docker pull nvidia/cuda:12.0.0-runtime-ubuntu22.04

# Xóa image CUDA 12.1 cũ (nếu đã build trước khi đổi Dockerfile)
docker compose down
docker rmi gpuvietnam-comfyui:latest gpuvietnam-comfyui:v1

# Build image (sạch sau khi đổi CUDA)
docker build --no-cache -t gpuvietnam-comfyui:v1 -t gpuvietnam-comfyui:latest .

# Chạy (cần NVIDIA Container Toolkit + Docker Desktop GPU)
docker compose up -d

# Tải models vào volume (trong container đang chạy)
docker compose exec comfyui /app/download-models.sh
# RealVisXL từ CivitAI: export CIVITAI_API_TOKEN=... trước khi chạy

# Logs
docker compose logs -f

# UI: http://localhost:8080

# Dừng
docker compose down
```

**Lỗi thường gặp (Docker Desktop Windows):**

| Lỗi | Nguyên nhân | Cách xử lý |
|-----|-------------|------------|
| `cuda>=12.1, please update your driver` | Container/image còn **CUDA 12.1** | Build lại với Dockerfile 12.0; xóa tag `latest`/`v1` cũ |
| `error reading from server: EOF` khi build | Docker Desktop ngắt khi pull layer ~1.2GB | Restart Docker Desktop → `docker pull nvidia/cuda:12.0.0-runtime-ubuntu22.04` → build lại |
| `pull access denied for gpuvietnam-comfyui` | Chưa build local | `docker compose build` hoặc `docker build -t gpuvietnam-comfyui:latest .` |

**Yêu cầu Docker Desktop:** RAM ≥ 8GB, disk trống ≥ 30GB cho image + layers.

**Còn lại (backlog Docker):**
- [ ] Chạy `download-models.sh` + test workflow trên http://localhost:8080
- [ ] LoRA Việt hóa trong `download-models.sh`
- [ ] QR / pre-bake models vào image CI (hiện tải qua script, image lớn nếu bake)
- [ ] Tích hợp ComfyUI API với Dashboard (nút Chạy workflow) — qua **`getGpuService()`**
- [x] Wire **`POST /api/user/start-machine`** → `GPUService.createInstance()` + billing + đổi môi trường

## Tầng GPU Service (kiến trúc) ✅

Chuẩn bị multi-provider sau này; **hiện chỉ Vast.ai**. Không đổi UI / DB / business logic / API frontend.

```
WebApp (API routes — start-machine ✅, workflow run chưa wire)
        ↓
   getGpuService()          ← singleton, inject VastProvider
        ↓
     GPUService              ← logging, retry (×2), map exception
        ↓
   GPUProvider (interface)
        ↓
    VastProvider             ← parse Vast/Comfy → domain models
        ↓
  VastClient + ComfyClient   ← HTTP transport only (không business logic)
```

**Quy tắc:** Dashboard, Billing, Workflow, Queue **không** gọi Vast API trực tiếp — chỉ `getGpuService()`.

**Domain models (`src/lib/gpu/domain/`):**

| Model | Mục đích |
|-------|----------|
| `GPUInstance` | Instance đã spawn (id, gpuLine, endpointUrl, status…) |
| `GPUJob` | Workflow job trên ComfyUI |
| `GPUStatus` | Trạng thái health / lifecycle |
| `GPUProviderInfo` | Metadata provider (`vast`) |

**GPUProvider interface** (`providers/gpu-provider.interface.ts`):

- `createInstance()` · `destroyInstance()` · `getInstanceStatus()`
- `submitWorkflow()` · `getJobStatus()` · `downloadOutputs()` · `uploadWorkflow()`
- `healthCheck()`

**GPULine:** `rtx3090` (Starter) · `rtx4090_1x` (Pro) · `rtx5090_1x` (Studio)

**File chính:**

| Path | Vai trò |
|------|---------|
| `src/lib/gpu/index.js` | `getGpuService()`, export errors |
| `src/lib/gpu/gpu-service.js` | Facade — retry, logging, delegate |
| `src/lib/gpu/gpu-errors.js` | `GPUError`, `GPUProviderError`, `mapProviderError` |
| `src/lib/gpu/providers/vast/vast-provider.js` | Implementation Vast.ai |
| `src/lib/gpu/providers/vast/vast-client.js` | Vast REST API |
| `src/lib/gpu/providers/vast/comfy-client.js` | ComfyUI REST trên instance `:8080` |
| `src/lib/gpu/providers/vast/vast-mapper.js` | Vast/Comfy → domain |

**Cách dùng (backend):**

```javascript
import { getGpuService } from '@/lib/gpu';

const gpu = getGpuService();
const instance = await gpu.createInstance({ gpuLine: 'rtx4090_1x', region: 'Singapore' });
await gpu.healthCheck(instance.id);
```

**Đã làm:**
- [x] Refactor tầng GPU — interface + VastProvider + GPUService + domain models
- [x] Build pass (`npm run build`)

**Còn lại (tích hợp runtime GPUService):**
- [x] Wire **`POST /api/user/start-machine`** → `getGpuService().createInstance()` + multi-offer retry
- [x] `server_status`: `provisioning` → `online` sau ComfyUI healthy (`machines/status`)
- [x] Đổi môi trường → workflow riêng (`change-environment` + SSH / `setup-workstation.sh`)
- [x] Billing: chỉ trừ giờ khi ComfyUI running; đóng session mồ côi
- [x] Test end-to-end trên Vast (Phase F.2 7/7 PASS)
- [ ] Thêm provider khác: implement `GPUProvider` mới (chưa làm RunPod/multi-cloud)

**Hardcode Vast còn lại (chấp nhận được):**

| Vị trí | Ghi chú |
|--------|---------|
| `getGpuService()` | Singleton chỉ wire `VastProvider` |
| `infrastructure-providers.js` | `fetchVastAiOffers` + `fetchCloreAiOffers` live (data thật); `fetchRunPodOffers`/`fetchTensorDockOffers` còn TODO — chưa qua GPUService |
| `infrastructure-shared.ts` | `INFRA_PROVIDERS` = Vast.ai / Clore.ai / RunPod / TensorDock (RunPod, TensorDock vẫn là mock filter) |
| `start-machine.js` | ✅ Gọi GPUService + `buildWorkstationContainerEnv()` |

## Biến môi trường (`.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=https://rhtqiecieeyqjlctcvag.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SPEEDSMS_ACCESS_TOKEN=          # để trống = dev mode (OTP on-screen)
SPEEDSMS_SENDER=GPUVietnam
ADMIN_SECRET=gpuvietnam-admin-2026   # dự phòng đăng nhập /admin
ADMIN_EMAILS=admin@gpuvietnam.com    # fallback gán admin khi DB chưa sync role
NEXT_PUBLIC_SITE_URL=http://localhost:3000   # redirect reset password (prod: https://gpuvietnam.com)

# GPU / Vast.ai (provisioning — GPUService)
VAST_AI_KEY=                      # bắt buộc khi spawn instance Vast
GPUVIETNAM_COMFYUI_IMAGE=dieuhaukieuhanh/gpuvietnam-comfyui:v1
COMFYUI_PORT=8080

# SSH vào máy Vast (đổi workflow runtime khi máy đang chạy)
VAST_SSH_PRIVATE_KEY_PATH=C:/Users/Lenovo/.ssh/id_rsa
# Hoặc: VAST_SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----..."
```

## SQL trên Supabase (chạy theo thứ tự nếu DB mới)

| File | Mục đích |
|------|----------|
| `supabase/schema.sql` | Bảng `users`, `otp_verifications` |
| `supabase/fix-trigger.sql` | **DROP** trigger `on_auth_user_created` |
| `supabase/subscriptions.sql` | Bảng `subscriptions` |
| `supabase/add-user-role.sql` | Cột `users.role` (`user` / `admin`) |
| `supabase/models.sql` | Bảng `models` (Checkpoint & LoRA) |
| `supabase/seed-models.sql` | 6 model hệ thống mẫu |
| `supabase/storage-models.sql` | Bucket `user-models` cho upload KH |
| `supabase/workflows.sql` | Bảng `workflows` + RLS |
| `supabase/seed-workflows.sql` | 4 workflow hệ thống mẫu |
| `supabase/storage.sql` | Bảng `storage_files` (SSD & Backup) + RLS |
| `supabase/seed-storage.sql` | Dữ liệu bộ nhớ mẫu (~8GB SSD, ~3GB Backup) |
| `supabase/storage-upgrades.sql` | Bảng `storage_upgrades` + cột `users.ssd_plan_gb`, `backup_plan_gb`, `wallet_balance` |
| `supabase/user-settings.sql` | `user_settings`, `user_notification_settings`, `wallet_transactions`, `users.full_name`, auto-renew & auto-topup |
| `supabase/wallet-deposit-status.sql` | Mở rộng `wallet_transactions`: type `deposit`, status `pending_deposit` / `rejected`, `updated_at` |
| `supabase/user-plan-inventory.sql` | Bảng `user_plan_inventory` — kho gói/giờ của KH (active, renew, grant) |
| `supabase/storage-pricing.sql` | Bảng `storage_pricing` — giá SSD/Backup (admin chỉnh) |
| `supabase/gpu-pricing-config.sql` | Bảng `gpu_pricing_config` — toàn bộ bảng giá GPU (câu chữ + giá) |
| `supabase/set-admin-role.sql` | Gán `role = admin` theo email + đồng bộ `auth.users.id` |
| `supabase/gpu-sessions.sql` | Bảng `gpu_sessions` — lịch sử phiên GPU |
| `supabase/seed-gpu-sessions.sql` | 7 phiên mẫu cho user đầu tiên |
| `supabase/support-sessions.sql` | Bảng `support_sessions` — phiên hỗ trợ từ xa Admin xem màn hình KH |
| `supabase/auth-audit-log.sql` | Bảng `auth_audit_log` — sự kiện xác thực |
| `supabase/makestudio-jobs.sql` | **0053** MakeStudio jobs (Train/Preview/Final) |
| `supabase/sepay-transactions.sql` | **0054** SePay webhook dedup + audit |
| `supabase/lora-train-jobs.sql` | LoRA jobs — file có, **chưa** trong manifest |
| `supabase/admin-approve-payment.sql` | Mẫu SQL duyệt CK thủ công |

**Gán admin:** chạy `supabase/set-admin-role.sql` (email `admin@gpuvietnam.com`) hoặc `update public.users set role = 'admin' where email = '...';`

**Redirect admin:** Tài khoản `role = admin` sau đăng nhập → `/admin` (API login trả `redirect`). Menu header Admin riêng (không Dashboard/Cài đặt/Bộ nhớ KH). Lib: `post-login-redirect.ts`, `user-role.js` (`syncUserRoleOnLogin`, `ADMIN_EMAILS`), `GET /api/auth/me`.

## Luồng Auth ✅ (Refactored 2026-08-08)

```
/register → POST /api/register → email verify → login → /dashboard
                  └─ Google OAuth → /auth/google-callback → /dashboard (1 click)
/login → POST /api/auth/login → redirect /admin hoặc /dashboard
/quen-mat-khau → POST /api/auth/forgot-password → email reset
/dat-lai-mat-khau → đặt mật khẩu mới (link từ email)

SĐT: Dashboard Cài đặt → Thêm SĐT → OTP Zalo/SMS → mở khóa khuyến mại
```

### Hardening (2026-08-02)

| Lớp bảo vệ | Cơ chế |
|------------|--------|
| **Rate limit** | Register: 5/IP/15min · Login: 10/IP/15min · OTP send: 3/phone/5min + 10/IP/hr + 60s cooldown · OTP verify: 5/phone/5min + lock 15 phút sau 5 lần sai |
| **Middleware JWT** | Verify HS256 signature bằng Web Crypto API với `SUPABASE_JWT_SECRET` — không còn chỉ check cookie `gpuvietnam-auth=1` |
| **Cookie** | `Secure` flag khi HTTPS; cookie `gpuvietnam-token` chứa access_token để middleware verify |
| **Security headers** | HSTS, CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy |
| **Anti-enumeration** | Login trả về cùng error message cho mọi trường hợp sai credentials |
| **OTP protection** | Lock sau 5 lần sai (15 phút) · Single-use (query `verified=false`) · Cooldown resend 60s · TTL 5 phút |
| **Password** | Strength validation (min 8, uppercase + digit) cả client + server · Confirm password · TTL 1h cho auto-generated password · Invalidate sessions khi đổi password |
| **Audit log** | Bảng `auth_audit_log` ghi register, login success/fail, OTP verify/send, password change, signout all |
| **Sign-out all** | `POST /api/auth/signout-all` — `signOut(userId, 'global')` + nút trong UserMenu |

- **UI Login / Register:** layout 2 cột full-viewport (`AuthPageShell.tsx`) — hero trái (desktop), form trắng phải; mobile chỉ form, không scroll trừ màn h `<500px` cao
- `AuthContext` + cookie `gpuvietnam-auth` + `gpuvietnam-token`
- Middleware bảo vệ `/dashboard`, `/dashboard/*` — verify JWT thật (không chỉ check cookie)
- Reset password: cấu hình Supabase **Redirect URL** `.../dat-lai-mat-khau`; email gửi từ **`GPUVietnam <notify@gpuvietnam.com>`** qua **Resend Custom SMTP** (Supabase → Authentication → Email Templates).
- Email nền tảng: `cskh@gpuvietnam.com` (hiển thị website) · `notify@gpuvietnam.com` (transactional: auth, thông báo thanh toán) · Resend API key server-side (`RESEND_API_KEY`), không lộ client.
- API route `/api/notify/payment` server-side gửi thông báo thanh toán cho admin qua Resend; utility `src/lib/resend.js`.

**File chính:** `AuthPageShell.tsx`, `auth-pages.styles.ts`, `LoginPage.tsx`, `RegisterPage.tsx`, `AuthContext.tsx`, `src/middleware.ts`, `src/pages/api/register.js`, `src/pages/api/otp/*`, `src/pages/api/auth/*`, `src/lib/rate-limit.js`, `src/lib/audit-log.js`, `supabase/auth-audit-log.sql`

## Luồng Checkout & Thanh toán ✅

**Luồng trang chủ / chọn môi trường (`/checkout-plan`, `/checkout/2`):**

```
/checkout-plan → chọn gói + BillingToggleBar → CheckoutAuthGate
  ├─ Chưa login → "Đăng nhập để tiếp tục" → /login?redirect=...
  └─ Đã login → PaymentSection (QR CK) → POST /api/payment/confirm → pending_payment
/checkout/2 → chọn môi trường → CheckoutActionButton (tương tự auth-aware)
Trial 3h → POST /api/trial/activate (không cần Admin)
Admin duyệt CK → active + server_status provisioning
```

**Luồng có gói active (`subscription.status === 'active'`):** KH đã login + gói active → bỏ qua checkout/bảng giá, redirect `/dashboard` (có thể `?activated=1`). Lib: `useActivePlanGate.ts`, `active-plan-gate.ts`. Áp dụng: chọn môi trường trang chủ, `HomePricingSection`, `CheckoutActionButton`, `/checkout-plan`, `/checkout/2`, `/bang-gia/thanh-toan`.

**Luồng Bảng giá độc lập (`/bang-gia` → `/bang-gia/thanh-toan`):**

```
/bang-gia → HomePricingSection (variant standalone, giống #pricing trang chủ)
  ├─ Đã có gói active → banner "Bạn đã có gói [tên] đang hoạt động" + Vào Dashboard
  ├─ Starter + eligibleForTrial → modal dùng thử 3h
  ├─ Chưa login → /login?redirect=/bang-gia/thanh-toan?plan=&billing=
  └─ Đã login → /bang-gia/thanh-toan
/bang-gia/thanh-toan → PlanCheckoutPage
  ├─ Ví → POST /api/payment/pay-wallet → kích hoạt gói ngay (active)
  └─ CK → POST /api/payment/confirm → pending_payment → Admin duyệt
```

**File chính checkout:** `CheckoutActionButton.tsx`, `CheckoutAuthGate.tsx`, `PaymentSection.tsx`, `PlanCheckoutPage.tsx`, `HomePricingSection.tsx`, `BillingToggleBar.tsx`, `src/lib/checkout-auth.ts`, `src/lib/gpu-subscription-purchase.js`, `useCheckoutSession.ts`, `usePricingContext.ts`, `useTrialWorkstationModal.tsx`

## Admin duyệt yêu cầu ✅

**UI:** `/admin` → tab **📋 Duyệt yêu cầu** (gộp gói GPU + nâng cấp bộ nhớ)

| Cách vào | Mô tả |
|----------|--------|
| Ưu tiên | Login + `users.role = 'admin'` → tự vào |
| Dự phòng | Nhập `ADMIN_SECRET` |

- Một tab duyệt: subscription `pending_payment` + `storage_upgrades` pending (CK) + **nạp Ví** (`wallet_transactions` type `deposit`, status `pending_deposit`)
- Filter: Tất cả / Gói GPU / Bộ nhớ / **Nạp Ví**; badge số pending poll 30s
- Duyệt / từ chối qua API riêng theo loại; phần **Đã xử lý gần đây** thu gọn

**File chính:** `AdminPendingRequestsPanel.tsx`, `AdminAuthGate.tsx`, `src/lib/admin-pending-requests.js`, `src/lib/admin-auth.js`, `src/lib/admin-session.ts`

**API duyệt:** `GET /api/admin/pending-requests`, `GET /api/admin/pending-requests/count`, `POST /api/admin/subscriptions/approve|reject`, `POST /api/admin/storage/approve|reject`, `POST /api/admin/wallet-deposits/approve|reject`

## Admin giá bộ nhớ ✅

**UI:** `/admin` → tab **📊 Giá bộ nhớ**

- Bảng giá SSD / Backup: sửa giá inline, toggle active/inactive
- Khách hàng chỉ thấy mức `is_active = true` trên modal nâng cấp

**API:** `GET /api/admin/storage-pricing` (public), `PUT` (admin) — `price_monthly` hoặc `is_active`

**File:** `AdminStoragePricingPanel.tsx`, `supabase/storage-pricing.sql`, `src/lib/storage-plans.js` (`getStoragePrice`, `getStoragePricingMaps`)

## Admin Edit giá GPU ✅

**UI:** `/admin` → tab **💳 Edit giá**

- Giao diện giống bảng giá công khai: tiêu đề section, nhãn Combo/hourly, 3 card Starter/Pro/Studio
- Sửa mọi câu chữ, thông số GPU, giá theo giờ/Combo1/Combo2, danh sách tính năng & trust
- Thanh hành động cố định: **Cập nhật** / **Hoàn tác** / **Hủy**
- Lưu vào bảng `gpu_pricing_config` — trang chủ, `/bang-gia`, checkout, auto-renew đọc giá từ DB

**API:** `GET /api/gpu-pricing` (public), `GET|PUT /api/admin/gpu-pricing` (admin)

**File:** `AdminGpuPricingPanel.tsx`, `src/lib/gpu-pricing-config.js`, `src/lib/gpu-pricing-defaults.js`, `supabase/gpu-pricing-config.sql`, `useGpuPricingConfig.ts`

**Fallback:** Nếu chưa chạy SQL hoặc DB trống → dùng giá mặc định trong `gpu-pricing-defaults.js`

## Admin tab Hạ tầng GPU ✅

**UI:** `/admin/infrastructure` — sidebar **🏗️ Hạ tầng**

- Nguồn tham chiếu: `Ha tang GPU.html`
- Bảng theo **Provider + Dòng GPU + Region** (Châu Á); mock 11 dòng, 3 dòng GPU (3090, 4090 1x, 4090 2x)
- Cột: NCC, GPU, Region, Số lượng, Uptime 7D, Giá TB 10 rẻ nhất ($/h), Giá VNĐ, Trạng thái (Ổn định / Ít hàng / Khan hiếm / Không khả dụng)
- Filter: provider, gpuLine, region, status + Reset + Hiển thị X/Y
- Auto-refresh **3 giờ** + nút **🔄 Cập nhật ngay**; `lastUpdated` định dạng `HH:MM - DD/MM/YYYY`
- Banner cảnh báo khi có dòng khan hiếm / không khả dụng

**API:** `GET /api/admin/infrastructure` — query filter; `verifyAdmin`

**File:** `AdminInfrastructurePanel.tsx`, `AdminInfrastructurePage.tsx`, `src/lib/infrastructure-providers.js`, `src/lib/infrastructure-shared.ts`, `src/lib/currency.js` (`USD_TO_VND`, `formatVndPerHour`)

**Env (provisioning):** `VAST_AI_KEY` — qua `GPUService` → `VastProvider` (3090 / 4090 1x / 4090 2x). Admin mock hạ tầng: `infrastructure-providers.js` (chưa wire GPUService cho bảng giá market).

**Nguồn data bảng giá market (`infrastructure-providers.js`):** `fetchVastAiOffers` (cần `VAST_AI_KEY`, POST `console.vast.ai/api/v0/bundles/`) và `fetchCloreAiOffers` (public GET `api.clore.ai/v1/marketplace`, không cần key) đều đã live — data thật, filter theo region Châu Á (`resolveAsiaRegionLabel`) + `UPTIME_THRESHOLD`. `fetchRunPodOffers`/`fetchTensorDockOffers` còn TODO (chưa có endpoint marketplace phù hợp). `fetchInfrastructureData()` dùng mock toàn bộ chỉ khi **tất cả** provider live trả về `null`.

## Admin tab Khách hàng ✅

**UI:** `/admin/customers` — sidebar **👥 Khách hàng** (route mới; legacy `/admin/khach-hang` → `QuanTriKHPage.tsx` giữ nguyên)

- Nguồn tham chiếu: `Quan tri KH.html`
- **Stats:** 4 card (Tổng KH, Đang sử dụng, Còn giờ, Doanh thu TB/KH) + 3 card (Retention, Giờ cao điểm, GPU ưa chuộng)
- **Banner cảnh báo hành vi bất thường** — chip theo loại, hover tooltip danh sách tên KH, bấm lọc nhanh
- **Bảng compact 6 cột** (vừa màn hình, không scroll ngang desktop):
  - KH (avatar + tên rút gọn + email ellipsis) · Gói · Giờ còn · Online · Cảnh báo · 👁
- **Accordion mở rộng** (1 dòng tại một thời điểm; giữ trạng thái mở khi filter/sort):
  - Trái: Email, SĐT, Region, Workflow, Model, Lần cuối
  - Phải: Hành trình, Doanh thu, TB giờ/ngày, Phiên/tuần, Tái tục, Lịch sử gói
  - Dưới: chi tiết cảnh báo + nút Khóa TK / Gửi email / Xem phiên (demo) / **👁 Hỗ trợ từ xa**
- **Mobile:** 4 cột (ẩn Giờ còn + Cảnh báo); panel mở rộng 1 cột
- Filter: trạng thái (Tất cả / Đang online / Đang sử dụng / Còn giờ / Hết giờ), gói, template, region, **cảnh báo**, tìm kiếm
- Sort cột; poll trạng thái online **30 giây**; badge **● LIVE** khi online
- **📥 Xuất Excel** — 2 sheet (Khách hàng + Thống kê), lib `xlsx`

**Trạng thái Online (realtime):**

| Hiển thị | Điều kiện |
|----------|-----------|
| 🟢 Online · XhYp | `machines.status = running` (fallback: `gpu_sessions` running / `server_status = online`) |
| 🟡 Có gói | Còn giờ, chưa bật máy |
| ⚫ Offline / Hết giờ | Không online / `hours_remaining = 0` |

**Cảnh báo hành vi bất thường** (`src/lib/customer-anomalies.ts`):

| Rule | Mức | Điều kiện |
|------|-----|-----------|
| Nhiều máy cùng lúc | 🔴 | `machinesRunning ≥ 3` |
| Không có output | 🔴 | Online ≥ 3h + `outputCount = 0` |
| Hết giờ vẫn chạy | 🔴 | Online + hết giờ |
| Phiên quá dài | 🔴 | Online ≥ 8h |
| Dùng quá nhiều | 🔴 | TB ≥ 6h/ngày |
| Nhiều phiên/tuần | 🟡 | ≥ 8 phiên/tuần |
| Rủi ro rời bỏ | 🟡 | Churn risk cao |
| Sắp hết giờ nhanh | ⚪ | < 5% giờ + dùng tích cực (thông tin) |
| Có giờ không dùng | ⚪ | ≥ 20h + 0 phiên + > 14 ngày không vào |

**Churn risk:** `hoursLeft=0` +40, không vào >7d +30, >14d +30, `sessionsPerWeek=0` +30 → ≥70 Cao / 40–69 Trung / <40 Thấp

**Dữ liệu:** Supabase `users`, `subscriptions`, `gpu_sessions`, `wallet_transactions`, `machines` (nếu có); fallback **12 KH mock** từ HTML khi DB trống

**API:**

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/admin/customers` | Danh sách KH + filter/sort + `anomalySummary`, `onlineCount`, `fetchedAt` |
| GET | `/api/admin/customer-stats` | Stats 7 card phía trên |

Query params customers: `status`, `plan`, `template`, `region`, `alert`, `search`, `sort`, `order`

**File chính:** `AdminCustomersPanel.tsx`, `AdminCustomersPage.tsx`, `src/lib/admin-customers.js`, `src/lib/admin-customers-shared.ts`, `src/lib/customer-anomalies.ts`, `src/lib/export-customers-excel.ts`, `src/styles/pages/admin-customers.styles.ts`

**Admin shell:** `AdminPanelPage.tsx` + `admin-nav.ts` — tab sidebar sau Hạ tầng; header menu **Khách hàng**

## Hỗ trợ từ xa (Admin xem màn hình KH) ✅

Luồng **một chiều**: Admin gửi yêu cầu → KH phản hồi qua chuông 🔔 — **KH không tự gửi yêu cầu** (tránh lạm dụng liên hệ Admin).

```
Admin → POST /api/admin/support/request → support_sessions (pending)
  → Thông báo 🔔 tới KH (type support_request)
KH mở chuông → ✅ Đồng ý / Từ chối
  ├─ POST /api/support/approve → active (started_at, tự hết sau 30 phút)
  └─ POST /api/support/reject → ended
Admin / KH → POST /api/support/end → ended
```

**Luồng trạng thái:** `pending` → (KH đồng ý) → `active` (30 phút) → `ended`  
WebRTC thật **chưa tích hợp** — hiện ghi nhận phiên + UI placeholder trên Admin.

**SQL (bắt buộc):** chạy `supabase/support-sessions.sql` trên Supabase SQL Editor (một lần).  
Bảng `notifications` dùng chung với các tính năng khác — không nằm trong file này.

**Thông báo KH (chuông 🔔):**
- Tiêu đề: Admin muốn xem màn hình để hỗ trợ bạn
- Nội dung gồm: ⚠️ Admin chỉ **XEM**, không thao tác · ⏱️ Tự kết thúc sau **30 phút**
- Thông báo chưa đọc: nút **✅ Đồng ý** / **Từ chối** (parse `supportSession` từ link)

**Dashboard KH:**
- **Đã bỏ** card 🔧 Cần trợ giúp? (KH không tự khởi tạo phiên)
- **Chuông 🔔** — `NotificationBell.tsx` + `NotificationDropdown.tsx` (approve/reject inline)
- **Banner đỏ** khi phiên `active` — `DashboardSupportActiveBanner` + nút Ngừng chia sẻ
- Card ❓ HỖ TRỢ (Zalo/email) vẫn giữ — liên hệ thông thường, khác hỗ trợ từ xa

**Admin:**
- Tab **Khách hàng** — nút 👁 trên từng dòng + accordion **Hỗ trợ từ xa**
- Modal `AdminRemoteSupportModal.tsx`: gửi yêu cầu, chờ KH qua 🔔, placeholder stream khi active, hủy/kết thúc

**API:**

| Method | Path | Mô tả |
|--------|------|--------|
| POST | `/api/admin/support/request` | Admin gửi yêu cầu xem màn hình (`userId`) |
| POST | `/api/support/request` | **403** — KH không được tự gửi |
| POST | `/api/support/approve` | KH chấp nhận phiên pending |
| POST | `/api/support/reject` | KH từ chối phiên pending |
| POST | `/api/support/end` | KH hoặc Admin kết thúc phiên |
| GET | `/api/support/status` | KH poll phiên đang mở |
| GET | `/api/support/sessions` | Admin liệt kê phiên pending/active |

**File chính:** `src/lib/support-sessions.js`, `src/lib/user-notifications.js` (`notifySupportRequestToCustomer`, `notifySupportSessionActive`), `DashboardSupportCard.tsx`, `AdminRemoteSupportModal.tsx`, `NotificationDropdown.tsx`

**Còn lại (backlog hỗ trợ từ xa):**
- [ ] WebRTC / screen share thật (Admin xem stream KH)
- [ ] Thông báo Admin khi KH đồng ý / từ chối

## Dashboard KH ✅

| Route | Nội dung |
|-------|----------|
| `/dashboard` | Tổng quan gói, giờ (2 decimal), pending; boot progress; optimistic start/stop; stop confirm modal; chuông 🔔; banner hỗ trợ từ xa |
| `/dashboard/goi-cua-toi` | Tab **Gói của tôi** — trạng thái gói, tái tục, nâng cấp |
| `/dashboard/model-lora` | Tab **Model & LoRA** |
| `/dashboard/workflows` | Tab **Workflow** |
| `/dashboard/storage` | Tab **Bộ nhớ** |
| `/dashboard/storage/checkout` | Thanh toán nâng cấp bộ nhớ (Ví / CK) |
| `/dashboard/cai-dat` | Thông tin tài khoản, SĐT (Zalo/SMS), mật khẩu, xóa backup |
| `/dashboard/wallet` | Tab **Ví Nạp Trước** — số dư + nạp (SePay QR tự động) + auto-renew + lịch sử + modal nâng cấp bộ nhớ |
| `/dashboard/lich-su` | Tab **Lịch sử phiên** |
| `/dashboard/makestudio` | ⏸️ **MakeStudio** — scaffold, **sau MVP**, chưa sidebar |

**Header Dashboard:** `WalletDropdown.tsx` — số dư Ví góc phải; `NotificationBell.tsx` — chuông 🔔 (poll unread, dropdown approve/reject hỗ trợ từ xa); click mở **modal căn giữa màn hình** (3 tab Nạp ví / Sử dụng / Lịch sử); nút **⚡ Nạp giờ** → `/bang-gia` (sidebar đã bỏ mục Nạp giờ/Gói mới)

### Tab Gói của tôi ✅

- **Component:** `src/components/dashboard/MyPlanPanel.tsx`, `RenewPlanModal.tsx`, `PlanSelectorModal.tsx`
- **Page:** `/dashboard/goi-cua-toi` → `DashboardGoiCuaToiPage.tsx`
- **Sidebar:** `DashboardShell.tsx` — mục 📦 Gói của tôi
- Fetch `GET /api/dashboard/me` + `GET /api/user/plans` — kho gói `user_plan_inventory` (nhiều gói, kích hoạt/deactivate)
- **Tái tục:** modal `RenewPlanModal` — đủ Ví trừ ngay; thiếu Ví hiện thông tin CK
- **API:** `POST /api/payment/renew`, `PUT /api/user/plans/activate`, `POST /api/user/auto-renew/check`
- Fetch `GET /api/dashboard/me` — 3 trạng thái UI:
  - **Chưa có gói:** chào mừng + 3 card Starter/Pro/Studio (giá/giờ) + link dùng thử
  - **Hết hạn** (`expiredSubscription`): cảnh báo + tái tục → `/checkout-plan?plan=&billing=`
  - **Active:** thông tin gói, giờ còn, tái tục Combo, nâng cấp, đổi sang Combo (hourly)
- Giá từ `gpu-pricing.js`; link bảng giá → `/bang-gia`

**File styles:** `src/styles/pages/dashboard-goi-cua-toi.styles.ts`

### Header trang công khai ✅

- **Component:** `src/components/layout/PublicHeader.tsx` + `UserMenu.tsx`
- **Styles:** `src/styles/layout/public-header.styles.ts`
- Tích hợp trên: trang chủ, `/bang-gia`, about, điều khoản, chính sách, login/register/OTP, checkout/payment
- **Chưa đăng nhập:** nút **Đăng nhập** (outline) + **Dùng thử miễn phí** (CTA)
- **Đã đăng nhập KH:** dropdown Dashboard / Cài đặt / Bộ nhớ / Đăng xuất
- **Đã đăng nhập Admin:** dropdown riêng (Admin Panel, Duyệt yêu cầu, Edit giá, Giá bộ nhớ, **Hạ tầng GPU**, **Khách hàng**, Trang chủ, Bảng giá) — `src/lib/admin-nav.ts`
- Mobile: hamburger menu gom nav + auth
- Auth: `AuthContext` + `GET /api/auth/me` / `GET /api/admin/check`

### Trang chủ — Hero & responsive ✅

- **Hero:** `TrangChuPage.tsx` + `trang-chu.styles.ts`
  - Chiều cao `min-height: clamp(520px, 76svh, 720px)`, căn giữa nội dung
  - Typography 2 dòng: *"Sẵn sàng sáng tạo & sản xuất nội dung"* — **Be Vietnam Pro** 600; *"AI Art · Studio"* — **Space Grotesk** 700 (cùng dòng `.hero-headline-brand`)
  - Font load `_document.tsx`: Be Vietnam Pro + Inter + Space Grotesk
  - Viewport meta `<meta name="viewport" content="width=device-width, initial-scale=1" />` trên toàn site
- **Section pricing mobile:** tiêu đề/subtitle scale `clamp`; subtitle `line-height` + khoảng cách với `BillingToggleBar`
- **Billing toggle mobile:** xem mục **Giá GPU tập trung** — nút dọc, không đè chữ "Theo giờ thực tế / Combo1 / Combo2"

### Responsive mobile / tablet ✅

| Khu vực | Thay đổi chính |
|---------|----------------|
| **Admin** | Sidebar → drawer ☰ + overlay; tab Duyệt yêu cầu scroll ngang; card thanh toán stack; badge LIVE rút gọn — `admin-panel.styles.ts`, `useAdminMobileShell.ts`, `AdminPanelPage.tsx` |
| **Admin Khách hàng / Hạ tầng** | Shell mobile tương tự — `AdminCustomersPage.tsx`, `AdminInfrastructurePage.tsx` |
| **Dashboard** | `overflow-x: hidden`; header greeting rút gọn; wallet trigger truncate; nút card server full-width — `dashboard.styles.ts`, `DashboardShell.tsx`, `DashboardOverview.tsx` |
| **Trang công khai** | Hero + section title scale; billing toggle dọc — `trang-chu.styles.ts`, `billing-toggle.styles.ts` |

**Test mobile từ laptop:** DevTools `Ctrl+Shift+M`; hoặc `npm run dev -- -H 0.0.0.0` + IP LAN / localtunnel.

### Trang chủ — section CTA cuối trang ✅

- **Chưa login / chưa có gói active:** tiêu đề dùng thử + nút **🏠 Vào phòng làm việc miễn phí** (`/register?trial=true` hoặc modal trial nếu đã login)
- **Login + gói active:** section **🏠 Vào phòng làm việc của bạn** + **🚀 Vào Dashboard** → `/dashboard`
- Kiểm tra: `useActivePlanGate` + `subscription.status === 'active'`
- **File:** `TrangChuPage.tsx`, `trang-chu.styles.ts` (`.cta-section-workspace`)

### Giá GPU & biên lợi nhuận ✅

- **Nguồn runtime:** bảng `gpu_pricing_config` (Admin tab Edit giá) + fallback `src/lib/gpu-pricing-defaults.js`
- **Backend:** Vast.ai — giá vốn theo giờ instance chạy; KH trả theo giờ/combo (metered).
- **Lib:** `src/lib/gpu-pricing.js`, `gpu-pricing-config.js`, `user-plan-inventory.js` (`computeRenewQuote`)

**Giá vốn → Giá bán (theo giờ lẻ, VNĐ/giờ):**

| GPU (gói) | Giá vốn Vast | Giá bán KH | Biên gộp ~ |
|-----------|--------------|------------|------------|
| RTX 3090 (Starter) | 5.500 | **15.000** | ~63% |
| RTX 4090 1x (Pro) | 11.000 | **20.000** | ~45% |
| RTX 5090 1x (Studio) | 21.000 | **35.000** | ~40% |

**Combo (mua gói lần đầu / tái tục cùng billing):**

| Combo | Quota | Hiệu lực (mặc định) |
|-------|--------|----------------------|
| **Giờ lẻ** | Theo giờ thực dùng | 60 ngày |
| **Combo1** | 100h + **tặng 10h** | 120 ngày |
| **Combo2** | 200h + **tặng 30h** | 180 ngày |

**Giá combo (VNĐ) = giờ cơ sở × giá/giờ gói** (10h/30h tặng kèm không tính tiền):

| Gói | Theo giờ | Combo1 (100h) | Combo2 (200h) |
|-----|----------|---------------|---------------|
| Starter (3090) | 15.000 | 1.500.000 | 3.000.000 |
| Pro (4090 1x) | 20.000 | 2.000.000 | 4.000.000 |
| Studio (5090 1x) | 35.000 | 3.500.000 | 7.000.000 |

**Thưởng giờ khi tái tục** (`computeRenewQuote` — `user-plan-inventory.js`):

| Loại tái tục | Thưởng | Điều kiện |
|--------------|--------|-----------|
| **Chủ động** (KH bấm tái tục / CK) | Không thưởng | — |
| **Gia hạn tự động** (bật trong Cài đặt) | **+3%** giờ cơ sở combo | `auto_renew_enabled` + Combo + còn **≥10h** |
| Tái tục tự động khi còn **<10h** | Không thưởng | — |

Tổng giờ tái tục = `baseHours + comboBonus (10/30) + renewBonus (3% nếu auto-renew & ≥10h, ngược lại 0)`.

- **UI chọn giờ:** `BillingToggleBar.tsx` — Theo giờ / Combo1 / Combo2
- **Bảng giá:** `HomePricingSection.tsx` — trang chủ `#pricing`, `/bang-gia`
- Sửa giá trên Admin **Edit giá** hoặc `gpu-pricing-defaults.js` → checkout, dashboard, auto-renew đồng bộ

> **Lưu ý DB:** Nếu đã lưu `gpu_pricing_config` cũ (15k/20k/35k), cập nhật qua Admin **Edit giá** hoặc PUT API để khớp bảng trên.

### Thanh toán gói từ `/bang-gia` ✅

- **Page:** `/bang-gia/thanh-toan` → `PlanCheckoutPage.tsx` (`routes.bangGiaCheckout`)
- **Chi tiết đơn dịch vụ:** Gói Starter/Pro/Studio, số giờ, GPU, tổng tiền
- **Ví nạp trước:** trừ `wallet_balance` qua `POST /api/payment/pay-wallet` — gói **kích hoạt tức thì** (`src/lib/gpu-subscription-purchase.js`)
- **Chuyển khoản:** QR + xác nhận → `pending_payment` → Admin duyệt
- Môi trường ComfyUI chọn sau trên Dashboard (không bắt buộc ở bước thanh toán)

### Tab Model & LoRA ✅

- Nguồn HTML: `Dashboard cua KH.html` (tab models)
- **Component:** `src/components/dashboard/ModelLoraPanel.tsx`
- **Page:** `src/pages/dashboard/model-lora.tsx`
- Fetch Supabase: model `system` + model `user` của KH đang login
- Filter: Tất cả / Hệ thống / Của tôi
- Lưới **3 cột** (HTML), card **ảnh nền + chữ đè gradient**, nút hành động bên dưới
- **Tải lên models:** upload file → Storage `user-models` → insert `models`
- **Xóa đã chọn:** checkbox trên model `Của tôi`, confirm, xóa hàng loạt
- Nút **Dùng ngay** / **Tải về:** placeholder (chưa gắn ComfyUI)

**Seed model hệ thống:** SDXL Base, RealVisXL, Pony Diffusion, Flux.1 Dev, LoRA Người Việt, LoRA Áo dài

**File styles:** `src/styles/pages/dashboard.styles.ts` (`.models-lora-panel`, `.model-card-visual`, overlay)

### Tab Workflow ✅

- Nguồn thiết kế: Mục 6 (Tab 2: Workflow) — hồ sơ dự án
- **Component:** `src/components/dashboard/WorkflowPanel.tsx`
- **Page:** `src/pages/dashboard/workflows.tsx` → `DashboardWorkflowsPage.tsx`
- **Sidebar:** `DashboardShell.tsx` — mục 📁 Workflow
- Fetch Supabase: workflow `is_public=true` + workflow `user_id` của KH đang login
- Filter: Tất cả / Hệ thống / Của tôi
- Lưới **3 cột** (2 tablet, 1 mobile), card thumbnail + meta + badge GPU / Hệ thống / Của tôi
- Nút **Chạy** (xanh lá, full-width), **Sửa**, **Tải xuống** (JSON), **Xóa** (chỉ Của tôi, có confirm)
- **Tạo Workflow mới:** placeholder upload (chưa gắn Storage)
- Nút **Chạy** / **Sửa:** placeholder (chưa gắn ComfyUI)

**Seed workflow hệ thống:** Tạo ảnh sản phẩm chuyên nghiệp, Đổi background tự động, Avatar AI phong cách Ghibli, Upscale ảnh cũ không vỡ

**File styles:** `src/styles/pages/dashboard.styles.ts` (`.workflows-panel`, `.workflow-card`, `.workflow-run-btn`, badge GPU/Hệ thống/Của tôi)

### Tab Bộ nhớ ✅

- Nguồn thiết kế: Mục 6 (Tab 4: Bộ nhớ) — hồ sơ dự án
- **Component:** `src/components/dashboard/StoragePanel.tsx`
- **Page:** `src/pages/dashboard/storage.tsx` → `DashboardStoragePage.tsx`
- **Checkout:** `src/pages/dashboard/storage/checkout.tsx` → `StorageCheckoutPage.tsx`
- **Sidebar:** `DashboardShell.tsx` — mục 💾 Bộ nhớ
- Gói lưu trên `users`: `ssd_plan_gb`, `backup_plan_gb`, `wallet_balance` (mặc định 20/20/0)
- Fetch Supabase: `storage_files` của KH; gói/ví/pending qua `GET /api/storage/plan`

**Khu vực SSD / Backup:**
- **SSD:** chỉ tương tác khi `server_status === 'online'`; máy tắt → overlay mờ + thông báo
- Progress bar theo gói hiện tại; thư mục models / outputs / workflows / custom_nodes
- **Backup:** luôn hiển thị; Tải xuống / Khôi phục / Xóa (placeholder storage GPU)
- Action bar: Chuyển SSD→Backup, Upload Backup (placeholder), **Nâng cấp dung lượng**

**Modal Nâng cấp/Hạ cấp:**
- 2 cột SSD / Backup riêng; radio 10/20/50/100 GB; giá SSD (29k–179k) và Backup (19k–129k) đ/tháng
- Chặn hạ cấp nếu đang dùng > gói chọn; nút Dọn dẹp → scroll + highlight card
- **Xác nhận** → `POST /api/storage/upgrade`
  - `totalAmount = 0` → cập nhật gói ngay + toast
  - `totalAmount > 0` → redirect `/dashboard/storage/checkout?id=...`

**Thanh toán checkout (`StorageCheckoutPage`):**
- **Ví:** `POST /api/storage/pay-wallet` — trừ `wallet_balance`, cập nhật gói ngay
- **Chuyển khoản:** `POST /api/storage/pay-transfer` → pending → Admin duyệt tab Bộ nhớ

**Badge trạng thái trên tab:**
- Vàng **Đang chờ duyệt** nếu có `storage_upgrades` pending
- Đỏ **Bị từ chối** + `admin_note` nếu bị reject (ẩn khi đang pending)

**Giá & logic:** `src/lib/storage-plans.js` — giá đọc từ `storage_pricing` (fallback hardcode); modal nâng cấp fetch `GET /api/admin/storage-pricing`

**File styles:** `src/styles/pages/dashboard.styles.ts` (`.storage-panel`, modal upgrade, checkout, badge)

### Tab Lịch sử phiên ✅

- **Component:** `src/components/dashboard/HistoryPanel.tsx`
- **Page:** `/dashboard/lich-su` → `DashboardLichSuPage.tsx`
- **Sidebar:** `DashboardShell.tsx` — mục 📜 Lịch sử
- Fetch `GET /api/user/sessions?limit=&offset=` — bảng `gpu_sessions` + phiên đang chạy (nếu `server_status === 'online'`)
- Card phiên: template, cấu hình GPU, gói, VRAM, bật/tắt máy, thời lượng, output
- Trạng thái: ✅ Hoàn thành / ⚠️ Bị ngắt / 🔄 Đang chạy (đếm thời gian realtime)
- Xem tất cả + tải thêm (pagination)
- **SQL:** `supabase/gpu-sessions.sql`, seed `supabase/seed-gpu-sessions.sql`
- **Lib:** `src/lib/gpu-sessions.js` — format thời lượng, gói, phiên live từ subscription

**File styles:** `src/styles/pages/dashboard.styles.ts` (`.history-panel`, `.session-item`, badge trạng thái)

## Luồng thanh toán nâng cấp bộ nhớ ✅

```
Modal → POST /api/storage/upgrade
  ├─ Miễn phí / hạ cấp (total=0) → cập nhật users.ssd/backup_plan_gb ngay
  └─ Cần trả tiền → /dashboard/storage/checkout?id=...
        ├─ Ví → POST /api/storage/pay-wallet → completed
        └─ CK → POST /api/storage/pay-transfer → Admin tab Duyệt bộ nhớ
```

**Test ví (SQL):** `update public.users set wallet_balance = 500000 where email = '...';`

### Tab Cài đặt ✅

- **HTML tham chiếu:** `Dashboard cua KH Cai dat.html`
- **Page:** `/dashboard/cai-dat` → `DashboardCaiDatPage.tsx` + `DashboardSettingsPage.tsx`
- **Layout:** grid 2 cột desktop / 1 cột mobile; section Bảo mật & Dữ liệu nền đỏ nhạt

**Các section:**

| Section | Nội dung |
|---------|----------|
| 👤 Thông tin cá nhân | Họ tên (sửa), email readonly, đổi SĐT qua OTP |
| 💰 Ví Nạp Trước | Số dư, **modal nạp 2 bước** (nhập tiền → CK), 5 GD gần nhất, link `/dashboard/wallet` |
| 🔄 Gia hạn tự động | **Chỉ Combo** — radio Ví / Chuyển khoản (ẩn nếu hourly/null) |
| 🔔 Thông báo | Zalo/Email + 4 sự kiện (toggle lưu DB) |
| 🎨 Giao diện | Sáng/Tối → `user_settings.theme` + localStorage |
| 🔒 Bảo mật | Modal đổi MK, đăng xuất tất cả thiết bị |
| 🗑️ Dữ liệu | Xóa toàn bộ Backup (confirm nhập `XÓA`) |

**Gia hạn tự động (Combo only)** — card `🔄 Gia hạn tự động` trong `DashboardSettingsPage.tsx`:

- Chỉ hiện khi `billingType === 'combo'`; hourly / null → ẩn card
- Radio: `auto_renew_method` = `wallet` (mặc định) | `transfer` — lưu `PUT /api/user/settings`
- Ví: hiện số dư (xanh nếu đủ tái tục, đỏ nếu thiếu); CK: nhắc thông báo khi sắp hết giờ
- Ngưỡng **≤ 10h** mặc định (dropdown 5/10/15/20 trong Cài đặt); đã bỏ toggle + badge + UI Auto Top-up hourly

**Gia hạn tự động Combo** (`POST /api/user/auto-renew`, gọi khi mở Dashboard):

- Điều kiện: `hours_remaining ≤ auto_renew_threshold` (mặc định **10**) + `auto_renew_enabled`
- Ví đủ tiền → trừ ví, cộng giờ combo, ghi `wallet_transactions` (giá từ `gpu-pricing.js`)
- Không đủ → `{ action: 'insufficient_balance', message: 'Không đủ số dư' }`

**Luồng nạp Ví (2 bước)** — dùng chung `WalletDepositForm.tsx` trên header + tab Cài đặt:

```
Bước 1 — Nhập số tiền (tối thiểu 50.000đ)
  ├─ Ô nhập + nút nhanh 100k / 200k / 500k / 1M
  └─ Nút 「Tiếp tục」→ POST /api/user/wallet/deposit → tạo wallet_transactions (type=deposit, status=pending_deposit)

Bước 2 — Thông tin chuyển khoản (modal rộng 640px, bố cục ngang, không cuộn)
  ├─ Trái: khung QR · Phải: lưới NH / STK / chủ TK / số tiền / mã CK (`NVxxxx`)
  ├─ Nội dung CK: NAPVI-{8 ký tự UUID} + nút Copy
  ├─ STK: 888666369 · Chủ TK: Lê Thế Cường · MB Bank
  ├─ Checkbox 「Tôi đã thực hiện chuyển khoản」
  └─ Nút 「Xác nhận」→ đóng modal (Admin duyệt ~15 phút)
```

- **Đã bỏ:** khuyến mãi % nạp ví (2–5%), checkbox Điều khoản nạp Ví
- **Admin duyệt:** tab Duyệt yêu cầu → loại **Nạp Ví**; approve cộng `wallet_balance`, reject ghi `rejected`

**WalletDropdown (Header Dashboard):**

- Trigger: `💰 200.000đ ▾` — xanh >100k, vàng ≤100k, đỏ = 0
- Click → **modal overlay căn giữa** (`createPortal` → `document.body`), giống modal Cài đặt — không còn dropdown gắn header
- Tab **Nạp ví:** luồng 2 bước ở trên (`compact` ở bước 1)
- Tab **Sử dụng:** link Mua giờ / Combo / Bộ nhớ / Gia hạn
- Tab **Lịch sử:** 5 GD gần nhất (+ badge **Chờ duyệt** nếu `pending_deposit`), link `/dashboard/wallet`
- Fetch `GET /api/user/wallet`; overlay click / Escape / nút ✕ đóng; khóa scroll body khi mở

**File chính:** `src/lib/user-settings.js`, `src/lib/auto-renew.js`, `src/lib/gpu-pricing.js`, `src/lib/wallet-deposit.js`, `src/lib/wallet-topup.js`, `WalletDepositForm.tsx`, `WalletDropdown.tsx`, `src/styles/pages/dashboard-cai-dat.styles.ts`

**SQL bổ sung (nếu DB đã tạo trước):** chạy lại `supabase/user-settings.sql` hoặc các `ALTER TABLE` cho `auto_renew_threshold`, `auto_topup_*`

## Trang công khai

| Route | Nội dung |
|-------|----------|
| `/` | Trang chủ — hero, hạ tầng, nhu cầu, bảng giá (`HomePricingSection` #pricing), FAQ |
| `/bang-gia` | Bảng giá độc lập — cùng `HomePricingSection` với trang chủ |
| `/bang-gia/thanh-toan` | Thanh toán gói (Ví / CK) sau khi chọn từ bảng giá |
| `/about` | Về chúng tôi |
| `/login`, `/register`, `/verify-otp` | Auth — layout 2 cột `AuthPageShell` (100vh, không scroll) |
| `/checkout-plan`, `/checkout/2` | Checkout chọn gói + môi trường (luồng trang chủ) |
| `/quen-mat-khau`, `/dat-lai-mat-khau` | Reset password |

## API routes

| Method | Path | Mô tả |
|--------|------|--------|
| POST | `/api/register` | Tạo user + OTP |
| GET | `/api/auth/me` | Role user đang đăng nhập (`admin` / `user`) |
| POST | `/api/auth/login` | Email/SĐT + password (+ trả `role`) |
| POST | `/api/auth/forgot-password` | Gửi email reset |
| POST | `/api/otp/send` | Gửi lại OTP (rate limit + cooldown) |
| POST | `/api/otp/verify` | Verify + session (rate limit + brute-force lock) |
| POST | `/api/auth/signout-all` | **Mới:** Đăng xuất tất cả thiết bị |
| POST | `/api/payment/confirm` | Ghi `pending_payment` (CK gói GPU) |
| POST | `/api/payment/pay-wallet` | Mua gói GPU bằng Ví — kích hoạt ngay |
| POST | `/api/payment/sepay-qr` | VietQR SePay (`NVxxxx`) cho giao dịch pending |
| POST | `/api/payment/sepay-webhook` | Webhook HMAC → auto-approve |
| GET/POST | `/api/cron/sepay-reconcile` | Reconcile dự phòng — cron daily Hobby |
| POST | `/api/makestudio/jobs` | ⏸️ sau MVP: list/create MakeStudio job |
| GET | `/api/makestudio/[id]` | ⏸️ sau MVP: chi tiết job |
| POST | `/api/makestudio/upload-images` | ⏸️ sau MVP: presign R2 upload ảnh train |
| POST/GET | `/api/makestudio/callback` | ⏸️ sau MVP: callback container + SSE |
| POST | `/api/makestudio/train-callback` | ⏸️ sau MVP: callback train |
| POST | `/api/lora-train/create` | ⏸️ sau MVP: tạo job (chưa provision) |
| GET | `/api/lora-train/[id]` | ⏸️ sau MVP: trạng thái job |
| GET | `/api/lora-train/[id]/download` | ⏸️ sau MVP: redirect R2 |
| POST | `/api/auth/google-callback` | Google OAuth code exchange |
| POST | `/api/trial/activate` | Dùng thử 3h |
| GET | `/api/user/pricing-context` | Trial eligibility, returning customer, số dư ví (bảng giá) |
| GET | `/api/dashboard/me` | User + subscription active + `expiredSubscription` + `hasUsedTrial` + `billingType` |
| PUT | `/api/user/profile` | Cập nhật họ tên |
| PUT | `/api/user/password` | Đổi mật khẩu |
| POST | `/api/user/change-phone` | Gửi OTP đổi SĐT |
| POST | `/api/user/verify-phone` | Xác nhận SĐT mới |
| GET | `/api/user/settings` | Cài đặt gia hạn, auto-topup, theme |
| PUT | `/api/user/settings` | Cập nhật cài đặt |
| GET | `/api/user/notifications` | Cài đặt thông báo; hoặc `?limit=&offset=` → danh sách thông báo chuông |
| GET | `/api/user/notifications/unread-count` | Số thông báo chưa đọc (badge chuông) |
| PUT | `/api/user/notifications/read` | Đánh dấu đọc (1 hoặc `all: true`) |
| PUT | `/api/user/notifications` | Cập nhật cài đặt thông báo |
| GET | `/api/user/sessions` | Lịch sử phiên GPU (pagination) |
| GET | `/api/user/wallet` | Số dư + lịch sử ví |
| POST | `/api/user/wallet/deposit` | Tạo yêu cầu nạp Ví (`pending_deposit`) + trả thông tin CK |
| POST | `/api/user/auto-renew` | Gia hạn tự động Combo qua Ví |
| GET | `/api/user/plans` | Kho gói `user_plan_inventory` |
| PUT | `/api/user/plans/activate` | Kích hoạt / tắt gói trong kho |
| POST | `/api/payment/renew` | Tái tục gói (Ví hoặc pending CK) |
| POST | `/api/user/auto-renew/check` | Kiểm tra & chạy gia hạn tự động |
| POST | `/api/user/delete-backup` | Xóa toàn bộ backup |
| GET | `/api/admin/check` | Kiểm tra quyền admin |
| GET | `/api/admin/pending-requests` | Tất cả yêu cầu pending (GPU + bộ nhớ) |
| GET | `/api/admin/pending-requests/count` | Số yêu cầu pending (badge tab) |
| GET | `/api/admin/subscriptions/pending` | CK gói GPU chờ duyệt (legacy) |
| POST | `/api/admin/subscriptions/reject` | Từ chối CK gói GPU |
| POST | `/api/admin/subscriptions/approve` | Duyệt CK gói GPU |
| GET | `/api/storage/plan` | Gói bộ nhớ, ví, pending/rejected upgrade |
| POST | `/api/storage/upgrade` | Tạo/cập nhật yêu cầu nâng cấp bộ nhớ |
| GET | `/api/storage/upgrade?id=` | Chi tiết upgrade (checkout) |
| POST | `/api/storage/pay-wallet` | Thanh toán nâng cấp bằng Ví |
| POST | `/api/storage/pay-transfer` | Ghi nhận CK nâng cấp bộ nhớ |
| GET | `/api/admin/storage/pending` | CK nâng cấp bộ nhớ chờ duyệt |
| POST | `/api/admin/storage/approve` | Duyệt nâng cấp bộ nhớ |
| POST | `/api/admin/storage/reject` | Từ chối nâng cấp bộ nhớ |
| POST | `/api/admin/wallet-deposits/approve` | Duyệt nạp Ví — cộng số dư |
| POST | `/api/admin/wallet-deposits/reject` | Từ chối nạp Ví |
| GET | `/api/gpu-pricing` | Cấu hình bảng giá GPU (public) |
| GET | `/api/admin/gpu-pricing` | Cấu hình bảng giá GPU (admin) |
| PUT | `/api/admin/gpu-pricing` | Lưu toàn bộ bảng giá GPU (admin) |
| GET | `/api/admin/storage-pricing` | Bảng giá SSD/Backup |
| PUT | `/api/admin/storage-pricing` | Cập nhật giá hoặc trạng thái (admin) |
| GET | `/api/admin/infrastructure` | Bảng hạ tầng GPU (provider/GPU/region, filter) |
| GET | `/api/admin/customers` | Phân tích KH — danh sách + filter/sort + cảnh báo |
| GET | `/api/admin/customer-stats` | Stats tab Khách hàng (7 card) |
| POST | `/api/admin/support/request` | Admin gửi yêu cầu hỗ trợ từ xa (xem màn hình KH) |
| POST | `/api/support/approve` | KH chấp nhận phiên hỗ trợ pending |
| POST | `/api/support/reject` | KH từ chối phiên hỗ trợ pending |
| POST | `/api/support/end` | KH hoặc Admin kết thúc phiên hỗ trợ |
| GET | `/api/support/status` | KH poll phiên hỗ trợ đang mở |
| GET | `/api/support/sessions` | Admin liệt kê phiên hỗ trợ pending/active |

## Lib & routes quan trọng

| Path | Mô tả |
|------|--------|
| `src/lib/post-login-redirect.ts` | Redirect sau login: admin → `/admin`, user → `/dashboard` |
| `src/lib/user-role.js` | `resolveUserRole`, `syncUserRoleOnLogin`, `ADMIN_EMAILS` |
| `src/lib/active-plan-gate.ts` | Kiểm tra gói active, URL `/dashboard?activated=1` |
| `src/hooks/useActivePlanGate.ts` | Hook redirect checkout → Dashboard khi có gói active |
| `src/components/auth/AuthPageShell.tsx` | Layout Login/Register 2 cột full-viewport |
| `src/styles/pages/auth-pages.styles.ts` | CSS trang Login/Register |
| `src/components/pricing/ActivePlanBanner.tsx` | Banner gói active trên `/bang-gia` |
| `src/components/dashboard/MyPlanPanel.tsx` | Tab Gói của tôi — 3 trạng thái gói |
| `src/lib/routes.ts` | URL constants (`dashboardGoiCuaToi`, `bangGia`, `bangGiaCheckout`, `adminInfrastructure`, `adminCustomers`, …) |
| `src/lib/gpu-pricing.js` | Giá GPU runtime — `getPlanPrice`, derive từ DB qua `gpu-pricing-config` |
| `src/lib/gpu-pricing-config.js` | Load/lưu `gpu_pricing_config`, build checkout plans |
| `src/lib/gpu-pricing-defaults.js` | Giá & nội dung mặc định khi DB trống |
| `src/lib/checkout-auth.ts` | `buildLoginRedirectUrl`, `buildBangGiaCheckoutUrl`, `DEFAULT_CHECKOUT_ENV` |
| `src/lib/gpu-subscription-purchase.js` | Mua gói GPU bằng Ví — trừ ví, tạo/cập nhật subscription |
| `src/lib/wallet-topup.js` | Gợi ý gia hạn (`WALLET_RENEW_HINTS`); re-export mệnh giá từ `wallet-deposit.js` |
| `src/lib/wallet-deposit.js` | Luồng nạp Ví: validate, STK CK, `createWalletDepositRequest`, approve/reject |
| `src/lib/user-plan-inventory.js` | Sync/list/activate kho gói, `computeRenewQuote`, `processPlanRenew` |
| `src/lib/checkout-plans.ts` | Metadata gói checkout; `BILLING_TOGGLES`; giá derive từ `gpu-pricing` |
| `src/lib/storage-plans.js` | Giá SSD/Backup từ DB, tính chênh lệch, validate hạ cấp |
| `src/lib/user-settings.js` | Default settings, `getOrCreateUserSettings` |
| `src/lib/auto-renew.js` | `evaluateAutoRenew`, `executeAutoRenew` (ngưỡng mặc định 10h) |
| `src/lib/gpu-sessions.js` | Format phiên GPU, phiên live từ subscription |
| `src/lib/plan-pricing.js` | Re-export `getPlanPrice` từ `gpu-pricing` (tương thích) |
| `src/lib/plan-hours.js` | Quota combo từ `gpu-pricing`; trial hours |
| `src/lib/admin-pending-requests.js` | Gộp pending GPU + bộ nhớ cho Admin |
| `src/lib/supabase-browser.js` | Client Supabase |
| `src/lib/supabase-admin.js` | Service role (API) |
| `src/lib/admin-auth.js` | `requireAdmin` — Auth admin hoặc secret |
| `src/lib/admin-session.ts` | `adminFetch`, lưu secret session |
| `src/lib/admin-nav.ts` | Menu header Admin + sidebar tabs |
| `src/lib/admin-customers.js` | Fetch KH (DB/mock), filter, sort, churn, online, anomalies |
| `src/lib/admin-customers-shared.ts` | Types, filters, sort columns, `formatSessionDurationShort` |
| `src/lib/customer-anomalies.ts` | Rules phát hiện hành vi bất thường KH |
| `src/lib/export-customers-excel.ts` | Xuất `.xlsx` tab Khách hàng (SheetJS) |
| `src/lib/support-sessions.js` | Phiên hỗ trợ từ xa: create/approve/reject/end, auto-expire 30 phút |
| `src/lib/user-notifications.js` | Tạo thông báo in-app (`support_request`, `support_active`, …) |
| `src/lib/infrastructure-providers.js` | Mock + stub bảng giá market Admin (tách khỏi GPUService runtime) |
| `src/lib/infrastructure-shared.ts` | Types/filter hạ tầng, `UPTIME_THRESHOLD` |
| `src/lib/gpu/index.js` | **`getGpuService()`** — entry point provisioning GPU (VastProvider) |
| `src/lib/gpu/gpu-service.js` | Facade: logging, retry, exception mapping |
| `src/lib/gpu/providers/gpu-provider.interface.ts` | `GPUProvider` interface — mở rộng multi-provider sau |
| `src/lib/gpu/providers/vast/vast-provider.js` | Vast.ai implementation |
| `src/lib/currency.js` | Quy đổi USD → VNĐ cho giá GPU/h |
| `src/lib/site-url.js` | URL gốc cho redirect email |
| `src/lib/rate-limit.js` | **Mới (2026-08):** In-memory rate limiter — `checkRateLimit`, `isLocked`, `setLock`, `clearLock` |
| `src/lib/audit-log.js` | **Mới (2026-08):** Ghi auth events vào `public.auth_audit_log` |
| `src/components/layout/PublicHeader.tsx` | Header công khai + auth |
| `src/components/layout/UserMenu.tsx` | Dropdown KH hoặc Admin (theo `isAdmin`) |
| `src/components/dashboard/WalletDropdown.tsx` | Modal Ví căn giữa header Dashboard (3 tab) |
| `src/components/dashboard/WalletDepositForm.tsx` | Form nạp Ví 2 bước — dùng chung header + Cài đặt |
| `src/components/dashboard/RenewPlanModal.tsx` | Modal tái tục gói (Ví / CK) |
| `src/components/dashboard/PlanSelectorModal.tsx` | Chọn gói khi bật máy |
| `src/components/pricing/HomePricingSection.tsx` | Section bảng giá dùng chung (trang chủ + `/bang-gia`) |
| `src/components/pricing/BillingToggleBar.tsx` | Chọn số giờ sử dụng ▶ hourly / Combo1 / Combo2 |
| `src/components/pricing/PricingPage.tsx` | Wrapper `/bang-gia` (header + `HomePricingSection` + footer) |
| `src/components/pages/PlanCheckoutPage.tsx` | Thanh toán `/bang-gia/thanh-toan` (Ví / CK) |
| `src/components/checkout/CheckoutActionButton.tsx` | Nút auth-aware: Đăng nhập / Thanh toán ngay |
| `src/hooks/useCheckoutSession.ts` | Kiểm tra session Supabase cho checkout |
| `src/hooks/usePricingContext.ts` | Trial eligibility + returning customer trên bảng giá |
| `src/hooks/useGpuPricingConfig.ts` | Fetch bảng giá GPU từ API cho trang công khai |
| `src/hooks/useTrialWorkstationModal.tsx` | Modal chọn môi trường dùng thử 3h |
| `src/components/admin/AdminGpuPricingPanel.tsx` | Admin tab Edit giá GPU |
| `src/components/admin/AdminInfrastructurePanel.tsx` | Admin tab Hạ tầng GPU |
| `src/components/admin/AdminCustomersPanel.tsx` | Admin tab Khách hàng — stats, cảnh báo, bảng accordion, hỗ trợ từ xa |
| `src/components/admin/AdminRemoteSupportModal.tsx` | Modal Admin gửi/chờ/kết thúc phiên hỗ trợ từ xa |
| `src/components/dashboard/NotificationBell.tsx` | Chuông 🔔 header Dashboard — poll + dropdown thông báo |
| `src/components/dashboard/NotificationDropdown.tsx` | Dropdown thông báo; approve/reject hỗ trợ từ xa inline |
| `src/components/dashboard/DashboardSupportCard.tsx` | Hook trạng thái phiên + banner active (KH) |
| `src/components/pages/AdminCustomersPage.tsx` | Shell `/admin/customers` |
| `src/components/pages/AdminInfrastructurePage.tsx` | Shell `/admin/infrastructure` |

## Bug đã xử lý

- URL Supabase sai ref, anon key duplicate prefix
- Trigger `auth.users` → drop, API tự upsert `users`
- Admin login: bỏ `@supabase/auth-helpers-nextjs`, dùng API `/api/admin/check`
- Admin panel tràn chữ → layout card
- Model grid tràn/co lệch → full width + 3 cột + card overlay
- Card Bộ nhớ nền trắng → dark theme đồng bộ dashboard
- Modal nâng cấp bộ nhớ → fit viewport, không scroll ngang
- Modal nạp Ví bước 2 tràn/cuộn → bố cục ngang 640px, modal căn giữa, không scroll
- **BillingToggleBar mobile:** 3 nút ngang + `nowrap` → chữ "Theo giờ thực tế / Combo…" đè nhau → xếp dọc full-width + wrap text
- **Docker CUDA 12.1 trên driver 526.56:** `cuda>=12.1` khi start container → hạ base image **12.0.0** + PyTorch **cu118** trong `Dockerfile`
- **SCB 4.0 — remaining hours reset sau stop:** UI snap back về giá trị pre-session → ADR-004 D1 (client-validated projection override, CAS guard, drift ≤ 0.05h, settlement-fail guard)
- **SCB 4.0 — `machines/status` leak billing:** hai nguồn billing truth trên UI → ADR-004 D2 (infra-only response, billing từ `dashboard/me`)
- **SCB 4.0 — stuck provisioning khi async start:** drift reset `provisioning` → `offline` trước khi Vast rent insert machine row → ADR-004 D3 (`shouldResetIdleProvisioningSubscription` luôn `false`)
- **Dashboard flicker khi start/stop:** ba nút thay vì hai, nháy trạng thái → optimistic UI (`buildOptimisticOpeningMachineSessionView` / `buildOptimisticStoppingMachineSessionView`)
- **Sai số hiển thị giờ:** `20h` thay vì `20.09h` → `formatDisplayHours` 2 decimal

## Việc tiếp theo (backlog)

**Ưu tiên — Go-Live P0:**
- [x] P0-A durable start + VPS Vast-only + smoke Phase F.2 7/7
- [x] P0-B harness: `scripts/p0b-t11-billing-proof.mjs` + [`P0B_T11_BILLING_PROOF.md`](operations/P0B_T11_BILLING_PROOF.md) (unit gate + full E2E)
- [x] P0-B T11 **ký PASS** — prod 2026-08-08 report `tmp/p0b-t11-1786206245215.json`
- [ ] P0-C alerts / ops notify
- [ ] P0-D E2E khách thật

**Ưu tiên — Staging & RC6:**
- [x] Audit Staging + env switch (2026-08-05)
- [ ] Scenario 1 Clean Start trên Vast
- [ ] Scenarios 2–5 → `RC6 VERIFIED` → promote Production

**Ưu tiên — SePay:** ✅ **chốt xong**
- [x] Lib + QR + webhook + SQL `0054` + WalletDepositForm QR
- [x] Cron `sepay-reconcile` trong `vercel.json` (daily Hobby)
- [x] Match nạp ví / gói GPU / tái tục (mã `NVxxxx`) + UI tự động duyệt
- [x] Ops: env SePay + webhook dashboard + cấu trúc mã `NV`+4 số + test nạp ví thật
- [ ] (Sau) storage upgrade auto-match nếu cần

**MakeStudio + LoRA — ⏸️ sau MVP (không làm trước Go-Live):**
- [x] Scaffold UI/API/Docker/SQL MakeStudio (`0053`)
- [x] `supabase-route-client.js` + lib/Docker LoRA
- [ ] (sau MVP) Fix create-job snake↔camel; gắn sidebar/nav
- [ ] (sau MVP) Wire `startLoraTraining` + auth signature; SQL LoRA vào manifest
- [ ] (sau MVP) E2E Train / Preview / Final; billing/quota

**Ưu tiên — ComfyUI / Dashboard còn stub:**
- [x] Image `:v3.7` / `:v4.4` + start-machine + workstation env
- [ ] Test workflow từng môi trường trên Vast
- [ ] Nút **Chạy workflow** / **Dùng ngay** E2E
- [ ] WebRTC remote support; Admin overview/revenue tabs
- [x] Custom SMTP Resend + `/api/notify/payment`
- [ ] Auto Top-up / cảnh báo Hourly (Zalo/Email)
- [ ] Gia hạn Combo qua CK tự động (SePay hoặc Admin)

## Go-Live / P0 (cập nhật 2026-08)

| Gate | Trạng thái |
|------|------------|
| Migration `user_start_provision` (0049) | ✅ |
| `POST /api/user/start-machine` → enqueue `operationId` | ✅ |
| VPS systemd `gpuvietnam-lifecycle-worker` | ✅ |
| **P0-A** Vast-only (`GPU_VAST_ONLY` + `GPU_ALLOW_VAST`) + smoke Phase F.2 | ✅ **7/7 PASS** |
| **P0-B** T11 billing E2E | ✅ **PASS** 2026-08-08 — `tmp/p0b-t11-1786206245215.json` |
| **P0-C** alerts | ⬜ |
| **P0-D** E2E khách | ⬜ |
| Staging RC6 Scenarios 1–5 | 🟡 gate/Vast ready; Scenario 1 chưa PASS trên Vast |

Chi tiết worker: [`docs/operations/LIFECYCLE_WORKER.md`](operations/LIFECYCLE_WORKER.md).  
Roadmap dễ hiểu: [`PROJECT_CONTEXT.md` §21](PROJECT_CONTEXT.md#21-roadmap--đang-ở-đâu-còn-làm-gì).

## Đã xong (gần đây)

- [x] **Auth Hardening P0+P1+P2 (2026-08-02)** — Rate limit 5 endpoints + OTP lock/cooldown/single-use; Middleware JWT verify (Web Crypto HS256); Secure cookie + Security headers (HSTS/CSP/X-Frame/nosniff); Anti-enumeration login; Fix `phone_verified` reset; Password strength client+server + confirm password; Session invalidation on password change; `pending_login_password` TTL 1h; Audit log `auth_audit_log`; Sign-out all devices
- [x] **P0-A code path** — enqueue `user_start_provision` + VPS `scripts/lifecycle-worker.mjs` + systemd unit; bỏ fire-and-forget provision trên serverless
- [x] **VPS Clore-only chốt** — `Environment=GPU_CLORE_ONLY=true` trên unit + verify environ (2026-07-24)
- [x] **Continuity A→B (Clore)** — prod E2E trước đó; Gate2 PASS WITH CONSTRAINTS
- [x] **Auto-stop theo gói đang dùng + cảnh báo 30 phút** — Remaining/out-of-credit scoped Starter/Pro/Studio của máy chạy; hết giờ gói đó → tắt dù còn giờ gói khác; `credit_warning` notification + `machines.credit_warning_sent` (migration `0035`)
- [x] **SCB 4.0 đóng băng** — tag `scb-4.0` (commit `bbed8da`); ADR-004 + SCB_CHANGELOG entry; ADR-001..004 closed set
- [x] **Server-authoritative remaining hours (Phương án 4)** — `POST /api/machines/destroy` nhận `clientRemainingHours` + `clientSessionDurationSeconds`; server validate drift ≤ 0.05h + non-gain; CAS-guarded override `subscriptions.hours_used` / `manual_hour_grants.hours_used` (projection only); settlement-fail guard; `gpu_sessions` SoT không đổi
- [x] **`/api/machines/status` infra-only** — bỏ `billingView`/`remainingFields`/`sessionFields`/`outOfHours`/`lowCreditWarning`; billing truth từ `/api/dashboard/me`; xem `docs/ui/DASHBOARD_VIEW_CONTRACT.md`
- [x] **Suppress drift reset async provisioning** — `shouldResetIdleProvisioningSubscription` luôn `false`; fix "stuck provisioning" khi `start-machine` async
- [x] **Dashboard optimistic UX** — `buildOptimisticOpeningMachineSessionView` / `buildOptimisticStoppingMachineSessionView`; UI chuyển `opening`/`stopping` ngay; `machine-lifecycle.js` `isBillingAnchored` không regress PROVISIONING khi đã anchor billing
- [x] **Boot progress bar** — indeterminate progress trong lúc chờ ComfyUI traffic-ready
- [x] **Stop confirmation modal** — tránh vô tình tắt phiên đang làm việc
- [x] **Remaining hours 2 decimal** — `formatDisplayHours` (`20.09h/110h`); gỡ client-side countdown floors (`remainingHoursFloor` / `postSessionFloorHours`)
- [x] **Wallet tab merge** — gộp card Ví + card Gia hạn tự động (Combo only, default wallet) + modal nâng cấp bộ nhớ (`StorageUpgradeModal` export từ `StoragePanel`) vào `/dashboard/wallet`; gỡ card Giao diện sáng/tối khỏi `/dashboard/cai-dat`; lịch sử giao dịch 7gd + expand
- [x] Trang Admin duyệt `pending_payment` (`/admin`)
- [x] Admin auth: `role=admin` + `ADMIN_SECRET`
- [x] Quên mật khẩu (`/quen-mat-khau`, `/dat-lai-mat-khau`)
- [x] Dashboard tab Model & LoRA + upload + xóa đã chọn
- [x] Dashboard tab Workflow (`/dashboard/workflows`) — grid card, filter, tải JSON, xóa workflow cá nhân
- [x] Dashboard tab Bộ nhớ (`/dashboard/storage`) — SSD/Backup, progress, chuyển dữ liệu, dọn file tạm
- [x] Modal Nâng cấp/Hạ cấp bộ nhớ (SSD + Backup riêng, chặn hạ cấp, tổng kết giá)
- [x] Thanh toán nâng cấp bộ nhớ: Ví + CK + checkout `/dashboard/storage/checkout`
- [x] Admin tab **Duyệt bộ nhớ** + API approve/reject `storage_upgrades`
- [x] Admin gộp tab **Duyệt yêu cầu** (GPU + bộ nhớ) + API `/api/admin/pending-requests`
- [x] Admin tab **Giá bộ nhớ** + bảng `storage_pricing` + giá động trên Dashboard KH
- [x] Badge pending/rejected trên tab Bộ nhớ KH
- [x] Dashboard tab **Cài đặt** (`/dashboard/cai-dat`) — profile, ví, thông báo, bảo mật, theme, xóa backup
- [x] Trang **Ví** (`/dashboard/wallet`) — lịch sử giao dịch
- [x] API user: profile, password, change-phone, settings, notifications, wallet, delete-backup
- [x] Bảng `user_settings` / `user_notification_settings` / `wallet_transactions` (`supabase/user-settings.sql`)
- [x] Gia hạn tự động Combo: ngưỡng mặc định 10h (5/10/15/20), `POST /api/user/auto-renew` (logic backend)
- [x] Dashboard tab **Lịch sử phiên** (`/dashboard/lich-su`) — API + DB `gpu_sessions`, phiên live, pagination
- [x] **Header công khai** — `PublicHeader` + `UserMenu`: Đăng nhập / Dùng thử / dropdown user; mobile hamburger
- [x] **Card Gia hạn tự động** (Combo) — radio Ví/CK, ngưỡng 5/10/15/20h; bỏ toggle/badge/Auto Top-up UI hourly
- [x] **WalletDropdown** trên header Dashboard — modal căn giữa 3 tab Nạp ví / Sử dụng / Lịch sử; luồng nạp 2 bước; màu số dư theo ngưỡng
- [x] **`src/lib/gpu-pricing.js`** — nguồn giá GPU duy nhất; đồng bộ checkout, trang chủ, dashboard, auto-renew
- [x] Trang **`/bang-gia`** — bảng giá 3 gói, link header nav
- [x] **`BillingToggleBar`** — thẻ "Chọn số giờ sử dụng" + Theo giờ thực tế / Combo1 / Combo2 (Combo2 **120 ngày**)
- [x] **`HomePricingSection`** — `/bang-gia` đồng bộ UI với `#pricing` trang chủ; CTA Starter theo trial eligibility
- [x] **`/bang-gia/thanh-toan`** — `PlanCheckoutPage`: Chi tiết đơn dịch vụ, thanh toán **Ví** (kích hoạt ngay) hoặc CK
- [x] **`POST /api/payment/pay-wallet`** + `gpu-subscription-purchase.js` — mua gói Starter/Pro/Studio từ Ví
- [x] **`CheckoutActionButton`** + `useCheckoutSession` — nút Đăng nhập / Thanh toán ngay trên checkout; `login?redirect=` giữ query
- [x] Admin tab **Edit giá GPU** + bảng `gpu_pricing_config` + API `/api/gpu-pricing`
- [x] **`useGpuPricingConfig`** — bảng giá động trên trang chủ & `/bang-gia`
- [x] **Admin redirect & menu** — login admin → `/admin`; `UserMenu` Admin riêng; `ADMIN_EMAILS` + `set-admin-role.sql`
- [x] **Tab Gói của tôi** (`/dashboard/goi-cua-toi`) — `MyPlanPanel`: chưa có gói / hết hạn / active + tái tục & nâng cấp
- [x] **Dashboard header** — nút ⚡ Nạp giờ → `/bang-gia`; bỏ sidebar Nạp giờ/Gói mới
- [x] **`useActivePlanGate`** — KH có gói active: skip checkout, redirect `/dashboard`; banner trên `/bang-gia`
- [x] **Trang chủ CTA cuối** — 3 trạng thái: dùng thử / phòng làm việc (active) / 🏠 Vào phòng làm việc miễn phí
- [x] **Login & Register UI** — `AuthPageShell` 2 cột, 100vh, form trắng compact, responsive mobile
- [x] **Admin tab Hạ tầng GPU** (`/admin/infrastructure`) — bảng provider/GPU/region, filter, auto-refresh 3h, banner cảnh báo khan hiếm
- [x] **Admin tab Khách hàng** (`/admin/customers`) — stats 7 card, cảnh báo bất thường, bảng compact 6 cột + accordion, online realtime 30s, Excel export
- [x] **API admin customers** — `GET /api/admin/customers`, `GET /api/admin/customer-stats`; churn risk; mock 12 KH fallback
- [x] **Customer anomalies** — multi-machine, no output, marathon session, churn; banner + filter + cột compact
- [x] **Xuất Excel KH** — `export-customers-excel.ts` + dependency `xlsx`
- [x] **Luồng nạp Ví 2 bước** — `WalletDepositForm.tsx`: nhập tiền → CK; STK **888666369** / **Lê Thế Cường**; Admin duyệt tab Duyệt yêu cầu
- [x] **SQL nạp Ví** — `supabase/wallet-deposit-status.sql` (type `deposit`, `pending_deposit`); bỏ khuyến mãi % nạp ví
- [x] **API nạp Ví** — `POST /api/user/wallet/deposit`, `POST /api/admin/wallet-deposits/approve|reject`
- [x] **WalletDropdown modal căn giữa** — overlay full-screen thay dropdown header; bước 2 rộng 640px, layout ngang QR + STK, không cuộn
- [x] **Kho gói KH** — `user_plan_inventory` + `MyPlanPanel` (activate/deactivate, tái tục `RenewPlanModal`, `PlanSelectorModal`)
- [x] **API kho gói & tái tục** — `GET /api/user/plans`, `PUT /api/user/plans/activate`, `POST /api/payment/renew`, `POST /api/user/auto-renew/check`
- [x] **Docker ComfyUI** — `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/download-models.sh`, 5 workflow mẫu `workflows/`
- [x] **Dockerfile CUDA 12.0** — base `12.0.0-runtime-ubuntu22.04`, PyTorch `cu118` (driver NVIDIA 526.56 / CUDA 12.0)
- [x] **ComfyUI local dev** — `docker compose up -d`, UI http://localhost:8080 chạy OK
- [x] **GHCR public** (legacy) — đã chuyển **Docker Hub** `dieuhaukieuhanh/gpuvietnam-comfyui:v1`
- [x] **Wire start-machine** — Vast provisioning, multi-offer retry, billing, đổi môi trường
- [x] **setup-workstation.sh** — workflow theo môi trường; SSH `VAST_SSH_PRIVATE_KEY_PATH`
- [x] **Dockerfile hardening** — PyTorch timeout/retry, pin frontend, git clone retry
- [x] **Mô hình giá Vast.ai** — giá vốn/giá bán theo giờ (3090/4090/2×4090); combo 100h+10h / 200h+30h; tái tục chủ động không thưởng / auto-renew +3% khi còn ≥10h
- [x] **Tầng GPU Service** — `src/lib/gpu/`: `GPUService` → `GPUProvider` → `VastProvider`; domain `GPUInstance` / `GPUJob` / `GPUStatus`; đã wire `start-machine`
- [x] **Hỗ trợ từ xa (một chiều)** — `support_sessions` + API; Admin gửi → KH đồng ý/từ chối qua chuông 🔔; phiên 30 phút; bỏ card 🔧 Cần trợ giúp? trên Dashboard
- [x] **Chuông thông báo Dashboard** — `NotificationBell` + `NotificationDropdown` (approve/reject inline cho `support_request`)
- [x] **Hero trang chủ** — Be Vietnam Pro + Space Grotesk, chiều cao `76svh`, headline 2 dòng cân đối mobile/desktop
- [x] **Responsive mobile/tablet** — Admin drawer, Dashboard không tràn ngang, header/wallet rút gọn; viewport meta toàn site
- [x] **BillingToggleBar mobile** — 3 nút xếp dọc full-width, wrap text; áp dụng `#pricing`, `/bang-gia`, checkout, preview Admin Edit giá

**HTML tham chiếu UI (thư mục cha):** `Dashboard cua KH.html`, `Dashboard cua KH Cai dat.html`, `Trang chu.html`, `Quan tri KH.html`, `Ha tang GPU.html`

**Chat mới — copy nhanh:**

```
Tiếp tục GPUVietnam. Đọc docs/PROJECT_CONTEXT.md + docs/PROGRESS.md + docs/operations/LIFECYCLE_WORKER.md.
SCB 4.0 + ADR-005 freeze. Go-Live: P0-A ✅ → P0-B billing → P0-C alerts → P0-D E2E.
VPS Vast-only. Host Intelligence Vast on / Clore opt-in. Image :v3.7 / :v4.4.
Ưu tiên: Go-Live P0-B..D + Staging RC6. SePay ✅ chốt. MakeStudio/LoRA ⏸️ sau MVP. Không Dual Run/warm pool trừ owner mở.
Roadmap dễ hiểu: PROJECT_CONTEXT §21.
```

**Lưu ý dev:** Giá GPU = Admin **Edit giá**. SQL: `sepay-transactions.sql` (`0054`) live; `makestudio-jobs.sql` (`0053`) scaffold park; LoRA SQL chưa manifest. SePay: `docs/operations/SEPAY_SETUP.md`.

**Lưu ý SCB 4.0:** Thay đổi đụng destroy/settlement/session-lifecycle/machines-drift/status contract / Queue / Worker / Provider Abstraction → **cần ADR-005+ và owner approval**. Bug fix tối thiểu + cùng semantics OK. Xem `docs/scb/ADR-004-scb4-product-exceptions.md`.
