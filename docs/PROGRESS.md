# GPUVietnam — Tiến độ dự án

> File này giúp chat / dev mới nắm context nhanh. Cập nhật khi hoàn thành milestone lớn.

## Stack

- **Framework:** Next.js 14 Pages Router (`src/pages/`, `src/components/pages/`)
- **Auth & DB:** Supabase Auth + Postgres + Storage (`@supabase/supabase-js`)
- **OTP SMS:** Speedsms.vn (dev: thiếu token → OTP hiện trên `/verify-otp`)
- **ComfyUI (GPU):** `dieuhaukieuhanh/gpuvietnam-comfyui:v1` (Docker Hub) — **CUDA 12.0** + PyTorch **cu118**; **backend GPU: Vast.ai** (thuê theo giờ chạy, không tốn idle); port **8080**

## Thay đổi gần đây (2026-06)

| Hạng mục | Trạng thái |
|----------|------------|
| Docker Hub thay GHCR | ✅ `dieuhaukieuhanh/gpuvietnam-comfyui:v1` |
| Dockerfile: retry PyTorch / git clone / pin frontend | ✅ (build đang chạy lại) |
| `setup-workstation.sh` — workflow theo môi trường | ✅ |
| Wire `start-machine` → Vast + billing + đổi môi trường | ✅ (cần test sau push image) |
| SSH `VAST_SSH_PRIVATE_KEY_PATH` | ✅ cấu hình local |
| Push image mới lên Docker Hub | ⏳ chờ build xong |

> **Build hiện tại:** `docker compose build --no-cache` đang chạy — chưa hoàn thành. Sau khi build xong: **push Docker Hub** → test luồng môi trường (Character / Commerce / Video AI) trên Vast.

## Bước tiếp theo

> **Docker + Docker Hub ⏳** (build lại) · **GPUService + Vast runtime ✅** · **Wire start-machine ✅**  
> **Kế tiếp:** push `dieuhaukieuhanh/gpuvietnam-comfyui:v1` → test workflow từng môi trường trên instance Vast.

## Docker Image (ComfyUI) ✅

Môi trường AI Art sẵn sàng cho GPUVietnam — chạy ComfyUI trên GPU NVIDIA qua **Vast.ai**.

**Hạ tầng GPU (Vast.ai):**
- Thuê instance **theo giờ thực tế** khi máy KH bật — **không chịu chi phí idle** như pool GPU cố định.
- Image triển khai: **`dieuhaukieuhanh/gpuvietnam-comfyui:v1`** trên **Docker Hub** (trước đây: GHCR).
- Admin tab **Hạ tầng** (`infrastructure-providers.js`) — bảng giá/market mock cho Admin; **provisioning runtime** đi qua `src/lib/gpu/` (GPUService), không gọi Vast trực tiếp từ UI/API KH.

**Cột mốc Docker (hoàn thành / đang làm lại):**

| Cột mốc | Trạng thái |
|---------|------------|
| Build Docker Image | ✅ (đang build lại `--no-cache`) |
| Chạy ComfyUI local (`http://localhost:8080`) | ✅ |
| Push GHCR (legacy) | ✅ (đã chuyển sang Docker Hub) |
| Push **Docker Hub** `dieuhaukieuhanh/gpuvietnam-comfyui:v1` | ⏳ sau build |
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
| `Dockerfile` | Image **CUDA 12.0** + ComfyUI + Manager + PyTorch cu118 + pin frontend |
| `docker-compose.yml` | Chạy local với GPU; image `dieuhaukieuhanh/gpuvietnam-comfyui:v1` |
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
- [ ] **Push Docker Hub** `dieuhaukieuhanh/gpuvietnam-comfyui:v1` (chờ build xong)

**Docker Hub:**

```bash
# Tag & push (sau khi build xong)
docker tag gpuvietnam-comfyui:v1 dieuhaukieuhanh/gpuvietnam-comfyui:v1
docker push dieuhaukieuhanh/gpuvietnam-comfyui:v1

# Pull trên Vast / máy khác
docker pull dieuhaukieuhanh/gpuvietnam-comfyui:v1
docker run --gpus all -p 8080:8080 \
  -e GPUVIETNAM_WORKSTATION=commerce-product \
  dieuhaukieuhanh/gpuvietnam-comfyui:v1
```

> GHCR (`ghcr.io/dieuhaukieuhanh/gpuvietnam-comfyui`) — **legacy**, không dùng cho deploy mới.

**Còn lại (tích hợp Docker):**
- [ ] Hoàn tất build `--no-cache` hiện tại + push Docker Hub
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

**GPULine:** `rtx3090` (Starter) · `rtx4090_1x` (Pro) · `rtx4090_2x` (Studio)

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
- [ ] Test end-to-end trên Vast sau push image mới
- [ ] Thêm provider khác: implement `GPUProvider` mới (chưa làm RunPod/multi-cloud)

**Hardcode Vast còn lại (chấp nhận được):**

| Vị trí | Ghi chú |
|--------|---------|
| `getGpuService()` | Singleton chỉ wire `VastProvider` |
| `infrastructure-providers.js` | Mock admin + `fetchVastAiOffers` TODO (chưa qua GPUService) |
| `infrastructure-shared.ts` | `INFRA_PROVIDERS` có tên RunPod/TensorDock (UI filter mock) |
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
| `supabase/admin-approve-payment.sql` | Mẫu SQL duyệt CK thủ công |

**Gán admin:** chạy `supabase/set-admin-role.sql` (email `admin@gpuvietnam.com`) hoặc `update public.users set role = 'admin' where email = '...';`

**Redirect admin:** Tài khoản `role = admin` sau đăng nhập → `/admin` (API login trả `redirect`). Menu header Admin riêng (không Dashboard/Cài đặt/Bộ nhớ KH). Lib: `post-login-redirect.ts`, `user-role.js` (`syncUserRoleOnLogin`, `ADMIN_EMAILS`), `GET /api/auth/me`.

## Luồng Auth ✅

```
/register → POST /api/register → /verify-otp → POST /api/otp/verify → session
/login → POST /api/auth/login → redirect /admin (admin) hoặc /dashboard (user)
/quen-mat-khau → POST /api/auth/forgot-password → email reset
/dat-lai-mat-khau → đặt mật khẩu mới (link từ email)
```

- **UI Login / Register:** layout 2 cột full-viewport (`AuthPageShell.tsx`) — hero trái (desktop), form trắng phải; mobile chỉ form, không scroll trừ màn h `<500px` cao
- `AuthContext` + cookie `gpuvietnam-auth`
- Middleware bảo vệ `/dashboard`, `/dashboard/*`
- Reset password: cấu hình Supabase **Redirect URL** `.../dat-lai-mat-khau`; email mặc định từ `noreply@mail.app.supabase.io` — muốn hiển thị **GPUVietnam** cần **Custom SMTP** + domain riêng

**File chính:** `AuthPageShell.tsx`, `auth-pages.styles.ts`, `LoginPage.tsx`, `RegisterPage.tsx`, `AuthContext.tsx`, `src/middleware.ts`, `src/pages/api/register.js`, `src/pages/api/otp/*`, `src/pages/api/auth/forgot-password.js`

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
| `/dashboard` | Tổng quan gói, giờ, pending; chuông 🔔 thông báo; banner hỗ trợ từ xa khi active |
| `/dashboard/goi-cua-toi` | Tab **Gói của tôi** — trạng thái gói, tái tục, nâng cấp |
| `/dashboard/model-lora` | Tab **Model & LoRA** |
| `/dashboard/workflows` | Tab **Workflow** |
| `/dashboard/storage` | Tab **Bộ nhớ** |
| `/dashboard/storage/checkout` | Thanh toán nâng cấp bộ nhớ (Ví / CK) |
| `/dashboard/cai-dat` | Thông tin tài khoản, ví, thông báo, bảo mật |
| `/dashboard/wallet` | Lịch sử giao dịch ví |
| `/dashboard/lich-su` | Tab **Lịch sử phiên** |

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
| RTX 3090 (Starter) | 5.500 | **9.900** | ~44% |
| RTX 4090 1x (Pro) | 11.000 | **22.000** | ~50% |
| RTX 4090 2x (Studio) | 21.000 | **40.000** | ~48% |

**Combo (mua gói lần đầu / tái tục cùng billing):**

| Combo | Quota | Hiệu lực (mặc định) |
|-------|--------|----------------------|
| **Combo1** | 100h + **tặng 10h** | 45 ngày |
| **Combo2** | 200h + **tặng 30h** | 120 ngày |

**Giá combo (VNĐ) = giờ cơ sở × giá/giờ gói** (10h/30h tặng kèm không tính tiền):

| Gói | Theo giờ | Combo1 (100h) | Combo2 (200h) |
|-----|----------|---------------|---------------|
| Starter (3090) | 9.900 | 990.000 | 1.980.000 |
| Pro (4090 1x) | 22.000 | 2.200.000 | 4.400.000 |
| Studio (4090 2x) | 40.000 | 4.000.000 | 8.000.000 |

**Thưởng giờ khi tái tục** (`computeRenewQuote` — `user-plan-inventory.js`):

| Loại tái tục | Thưởng | Điều kiện |
|--------------|--------|-----------|
| **Chủ động** (KH bấm tái tục) | **+5%** giờ cơ sở combo | Còn **>10h** (`PROACTIVE_RENEW_HOURS_THRESHOLD`) |
| **Gia hạn tự động** (bật trong Cài đặt) | **+3%** giờ cơ sở combo | `auto_renew_enabled` + Combo |
| Tái tục khi còn **≤10h** | **+3%** (cùng mức auto) | Khuyến khích gia hạn sớm |

Tổng giờ tái tục = `baseHours + comboBonus (10/30) + renewBonus (3% hoặc 5%)`.

- **UI chọn giờ:** `BillingToggleBar.tsx` — Theo giờ / Combo1 / Combo2
- **Bảng giá:** `HomePricingSection.tsx` — trang chủ `#pricing`, `/bang-gia`
- Sửa giá trên Admin **Edit giá** hoặc `gpu-pricing-defaults.js` → checkout, dashboard, auto-renew đồng bộ

> **Lưu ý DB:** Nếu đã lưu `gpu_pricing_config` cũ (18k/30k/50k), cập nhật qua Admin **Edit giá** hoặc PUT API để khớp bảng trên.

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
  ├─ Trái: khung QR · Phải: lưới NH / STK / chủ TK / số tiền / mã GD
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
| POST | `/api/otp/send` | Gửi lại OTP |
| POST | `/api/otp/verify` | Verify + session |
| POST | `/api/payment/confirm` | Ghi `pending_payment` (CK gói GPU) |
| POST | `/api/payment/pay-wallet` | Mua gói GPU bằng Ví — kích hoạt ngay |
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

## Việc tiếp theo (backlog)

**Ưu tiên milestone kế tiếp — ComfyUI tích hợp:**
- [x] Build Docker Image + chạy local — **http://localhost:8080 OK**
- [x] Push **Docker Hub** `dieuhaukieuhanh/gpuvietnam-comfyui:v1` (đang build lại)
- [x] **Tầng GPU Service** — `GPUService` + `GPUProvider` + `VastProvider`
- [x] Wire **`start-machine`** → `getGpuService().createInstance()`
- [x] Môi trường làm việc → workflow riêng (`setup-workstation.sh`, `workstation-env.js`)
- [ ] Push image sau build `--no-cache` hiện tại
- [ ] Test workflow từng môi trường trên instance Vast
- [ ] LoRA Việt hóa, bake/QR models (nếu cần)
- [ ] Tích hợp ComfyUI workflow qua Dashboard → `getGpuService()` (nút Chạy workflow)

- [ ] Cấu hình `SPEEDSMS_ACCESS_TOKEN` + QR thanh toán thật
- [ ] Custom SMTP Supabase (email hiển thị GPUVietnam)
- [ ] Email/notify Admin khi có yêu cầu CK mới
- [ ] `server_status`: `provisioning` → `online` (hạ tầng GPU)
- [ ] Model: nút **Dùng ngay** → mount/load ComfyUI thật
- [ ] Workflow: upload JSON + nút **Chạy** / **Sửa** → tích hợp ComfyUI
- [ ] Bộ nhớ: upload Backup + khôi phục/tải file thật qua storage GPU
- [ ] QR thanh toán nạp Ví: ảnh QR thật (hiện placeholder 🖼️ trên bước 2)
- [ ] QR thanh toán gói GPU / bộ nhớ: ảnh QR thật (placeholder trên `PlanCheckoutPage`, `PaymentSection`)
- [ ] Auto Top-up / cảnh báo Hourly: gửi thông báo Zalo/Email khi số dư thấp (DB `auto_topup_*` còn, UI đã gỡ khỏi Cài đặt)
- [ ] Gia hạn Combo qua chuyển khoản tự động (hiện chỉ Ví tự trừ; radio CK chỉ lưu preference + nhắc thông báo)
- [ ] `gpu_sessions`: ghi phiên thật khi bật/tắt máy GPU (hiện seed + phiên live từ subscription)
- [ ] Bảng `machines` trên Supabase (schema chưa có file SQL — API customers đã query + fallback)
- [ ] Admin tab Khách hàng: nút Khóa TK / Gửi email / Xem phiên (hiện placeholder demo)
- [ ] **Hỗ trợ từ xa:** WebRTC screen share thật; thông báo Admin khi KH đồng ý/từ chối
- [ ] Admin: các tab còn lại (Tổng quan, Phiên GPU, Doanh thu) — placeholder

## Đã xong (gần đây)

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
- [x] **Mô hình giá Vast.ai** — giá vốn/giá bán theo giờ (3090/4090/2×4090); combo 100h+10h / 200h+30h; tái tục +5% / auto-renew +3%
- [x] **Tầng GPU Service** — `src/lib/gpu/`: `GPUService` → `GPUProvider` → `VastProvider`; domain `GPUInstance` / `GPUJob` / `GPUStatus`; đã wire `start-machine`
- [x] **Hỗ trợ từ xa (một chiều)** — `support_sessions` + API; Admin gửi → KH đồng ý/từ chối qua chuông 🔔; phiên 30 phút; bỏ card 🔧 Cần trợ giúp? trên Dashboard
- [x] **Chuông thông báo Dashboard** — `NotificationBell` + `NotificationDropdown` (approve/reject inline cho `support_request`)
- [x] **Hero trang chủ** — Be Vietnam Pro + Space Grotesk, chiều cao `76svh`, headline 2 dòng cân đối mobile/desktop
- [x] **Responsive mobile/tablet** — Admin drawer, Dashboard không tràn ngang, header/wallet rút gọn; viewport meta toàn site
- [x] **BillingToggleBar mobile** — 3 nút xếp dọc full-width, wrap text; áp dụng `#pricing`, `/bang-gia`, checkout, preview Admin Edit giá

**HTML tham chiếu UI (thư mục cha):** `Dashboard cua KH.html`, `Dashboard cua KH Cai dat.html`, `Trang chu.html`, `Quan tri KH.html`, `Ha tang GPU.html`

**Chat mới — copy nhanh:**

```
Tiếp tục dự án GPUVietnam. Đọc docs/PROJECT_CONTEXT.md + docs/PROGRESS.md.
Docker Hub dieuhaukieuhanh/gpuvietnam-comfyui:v1 ⏳ (build --no-cache đang chạy).
GPUService + start-machine + môi trường workflow ✅. Tiếp: push image → test Vast.
```

**Lưu ý dev:** Giá GPU sửa trên Admin tab **Edit giá** (cần chạy `supabase/gpu-pricing-config.sql`). Giá SSD/Backup sửa tab Giá bộ nhớ. SQL mới: chạy `gpu-sessions.sql` + `seed-gpu-sessions.sql` nếu chưa có bảng lịch sử phiên; **`wallet-deposit-status.sql`** + **`user-plan-inventory.sql`** cho nạp Ví và kho gói; **`support-sessions.sql`** cho hỗ trợ từ xa (bắt buộc trước khi test luồng Admin → KH). Tab **Khách hàng** tại `/admin/customers`; cần bảng `machines` trên Supabase để online realtime đầy đủ (hiện fallback `gpu_sessions` / mock).
