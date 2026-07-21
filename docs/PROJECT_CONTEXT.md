# GPUVietnam — Hồ sơ tổng thể dự án

> **Mục đích:** Tài liệu context cho dev / chat mới — mô tả **thực tế đã triển khai** và phân biệt rõ với kế hoạch tương lai.  
> **Tiến độ chi tiết theo milestone:** [`docs/PROGRESS.md`](PROGRESS.md)  
> **Kiến trúc SCB:** [`docs/scb/`](./scb/) — đóng băng tại tag `scb-4.0` (commit `bbed8da`); ADR-001..004 là closed set.  
> **Kiến trúc Control Plane / Runtime v2.0:** [`docs/architecture/ARCHITECTURE_V2_FREEZE.md`](./architecture/ARCHITECTURE_V2_FREEZE.md) + [ADR-005](./architecture/ADR-005-control-plane-runtime-v2.md) — Frozen 2026-07-21; code checkpoint tag `checkpoint/pre-cp-runtime-split`.  
> **Roadmap triển khai:** [`docs/architecture/IMPLEMENTATION_ROADMAP_V2.md`](./architecture/IMPLEMENTATION_ROADMAP_V2.md).

**Thư mục dự án:** `D:\GPU + AI\Web\gpuvietnam\`  
**Nguồn HTML gốc:** `D:\GPU + AI\Web\*.html` (chuyển đổi qua `npm run convert`)

---

## Mục lục

1. [Tổng quan & định vị](#1-tổng-quan--định-vị)
2. [Trạng thái triển khai (2026-06)](#2-trạng-thái-triển-khai-2026-06)
3. [Stack kỹ thuật](#3-stack-kỹ-thuật)
4. [Cấu trúc mã nguồn](#4-cấu-trúc-mã-nguồn)
5. [Routes & trang](#5-routes--trang)
6. [Dashboard khách hàng](#6-dashboard-khách-hàng)
7. [Admin](#7-admin)
8. [Kiến trúc GPU & ComfyUI](#8-kiến-trúc-gpu--comfyui)
9. [Luồng nghiệp vụ chính](#9-luồng-nghiệp-vụ-chính)
10. [Auth & phân quyền](#10-auth--phân-quyền)
11. [Database (Supabase)](#11-database-supabase)
12. [API (tóm tắt)](#12-api-tóm-tắt)
13. [Docker & scripts](#13-docker--scripts)
14. [Biến môi trường](#14-biến-môi-trường)
15. [Gói giá & billing](#15-gói-giá--billing)
16. [Đã làm vs chưa làm](#16-đã-làm-vs-chưa-làm)
17. [Thay đổi gần đây](#17-thay-đổi-gần-đây)
18. [Dev & vận hành](#18-dev--vận-hành)
19. [Nguyên tắc truyền thông (KH-facing)](#19-nguyên-tắc-truyền-thông-kh-facing)

---

## 1. Tổng quan & định vị

**GPUVietnam** là nền tảng “trạm làm việc trên mây” cho AI Art — không bán GPU thô, mà đóng gói môi trường ComfyUI đã cài sẵn (workflow, model, backup).

| Khía cạnh | Mô tả |
|-----------|--------|
| **Mô hình kinh doanh** | Resell GPU cloud (hiện: **Vast.ai**) + giá trị gia tăng (workflow, hỗ trợ, thanh toán VN) |
| **Đối tượng chính** | Freelancer AI Art (~60%), sinh viên/người mới (~25%), agency nhỏ (~15%) |
| **Điểm khác biệt (mục tiêu)** | Vào là chạy, workflow mẫu, model Việt hóa, Zalo, thanh toán chuyển khoản/Ví VNĐ |
| **Backend GPU thực tế** | Vast.ai — thuê instance **theo giờ khi KH bật máy**, không pool GPU idle |

---

## 2. Trạng thái triển khai (2026-07)

| Hạng mục | Trạng thái |
|----------|------------|
| Next.js app (marketing + auth + checkout + dashboard + admin) | ✅ Production-ready |
| Supabase Auth + 32 file SQL schema | ✅ Chạy thủ công trên Supabase |
| Ví Nạp Trước, mua gói, tái tục, trial 3h | ✅ |
| GPUService + VastProvider + start/stop machine | ✅ |
| Billing theo phiên (combo giờ + hourly ví) | ✅ |
| **SCB 4.0 — server-authoritative remaining hours** | ✅ Frozen at tag `scb-4.0` (ADR-004) |
| **Dashboard UX — optimistic start/stop, boot progress, stop confirm** | ✅ |
| **Wallet tab merge (balance + auto-renew + storage upgrade modal)** | ✅ |
| Docker ComfyUI image | ✅ local; ⏳ push Docker Hub sau build `--no-cache` |
| Môi trường làm việc → workflow riêng | ✅ (boot + SSH runtime) |
| Dashboard "Chạy workflow" trên GPU | ❌ stub |
| Jupyter / Blender workstation | ❌ UI only — "Sắp ra mắt" |
| Trợ lý AI (Qwen/Ollama) | ❌ chưa triển khai |
| VNPay/PayOS tự động | ❌ dùng chuyển khoản + admin duyệt |
| RunPod / multi-provider | ❌ interface only |

> **Build Docker hiện tại:** `docker compose build --no-cache` đang chạy — chưa hoàn thành.  
> **Sau build:** `docker push dieuhaukieuhanh/gpuvietnam-comfyui:v1` → test E2E luồng môi trường trên Vast.

---

## 3. Stack kỹ thuật

| Lớp | Công nghệ |
|-----|-----------|
| **Frontend** | Next.js **14.2** Pages Router, React 18, TypeScript (một phần) |
| **Auth & DB** | Supabase Auth + Postgres + Storage |
| **SMS OTP** | Speedsms.vn (`src/lib/speedsms.js`); dev thiếu token → OTP hiện trên `/verify-otp` |
| **Backup storage** | Cloudflare R2 qua `@aws-sdk/client-s3` |
| **GPU backend** | Vast.ai REST API; SSH (`ssh2`) cho đổi workflow runtime |
| **ComfyUI image** | Docker Hub `dieuhaukieuhanh/gpuvietnam-comfyui:v1` — CUDA **12.0**, PyTorch **cu118**, port **8080** |
| **Export Excel** | `xlsx` (admin customers) |

**Quy ước UI:** CSS gốc từ HTML inject qua `<style dangerouslySetInnerHTML>`; script tương tác qua `src/lib/scripts/*.ts` + `new Function()` trong `useEffect`. Font: Inter + Space Grotesk. Màu: `#0A0A0F`, accent `#4F8EF7`.

---

## 4. Cấu trúc mã nguồn

```
gpuvietnam/
├── src/
│   ├── pages/              # Routes Next.js + 72 API handlers
│   ├── components/
│   │   ├── layout/         # PublicHeader, DashboardSidebar, AdminAuthGate…
│   │   ├── dashboard/      # DashboardOverview, WorkflowPanel, Wallet…
│   │   ├── admin/          # Admin panels (customers, infrastructure, pricing…)
│   │   └── pages/          # Một component / trang HTML gốc
│   ├── lib/
│   │   ├── gpu/            # GPUService, VastProvider, billing, workstation-setup
│   │   ├── workstation-env.js
│   │   ├── workstations.ts
│   │   ├── user-plan-inventory.js
│   │   ├── gpu-sessions.js
│   │   └── scripts/        # JS gốc từ HTML
│   ├── hooks/              # useDashboard, useUserPlans…
│   └── middleware.ts       # Bảo vệ /dashboard/* (cookie gpuvietnam-auth)
├── supabase/               # 32 file SQL (chạy thủ công, không có migrations CLI)
├── scripts/                # Shell: start.sh, setup-workstation.sh, download-models.sh
├── workflows/              # 5 workflow JSON stock
├── Dockerfile
├── docker-compose.yml
└── docs/
    ├── PROJECT_CONTEXT.md  # ← file này
    └── PROGRESS.md         # Tiến độ milestone
```

**Tầng GPU (bắt buộc tuân thủ):**

```
API routes → getGpuService() → GPUService → GPUProvider → VastProvider → VastClient + ComfyClient
```

Dashboard, billing, workflow UI **không** gọi Vast API trực tiếp.

---

## 5. Routes & trang

Định nghĩa tập trung: `src/lib/routes.ts`

### Trang công khai

| Route | File | Ghi chú |
|-------|------|---------|
| `/` | `pages/index.tsx` | Landing |
| `/bang-gia` | `pages/bang-gia.tsx` | Bảng giá |
| `/bang-gia/thanh-toan` | `pages/bang-gia/thanh-toan.tsx` | Checkout gói |
| `/about` | `pages/about.tsx` | Giới thiệu |
| `/dieu-khoan-dich-vu` | `pages/dieu-khoan-dich-vu.tsx` | Điều khoản |
| `/chinh-sach-bao-mat` | `pages/chinh-sach-bao-mat.tsx` | Bảo mật |
| `/cap-nhat-nen-tang` | `pages/cap-nhat-nen-tang.tsx` | Changelog (UI tĩnh) |

### Auth

| Route | File |
|-------|------|
| `/register` | `pages/register.tsx` |
| `/login` | `pages/login.tsx` |
| `/verify-otp` | `pages/verify-otp.tsx` |
| `/quen-mat-khau` | `pages/quen-mat-khau.tsx` |
| `/dat-lai-mat-khau` | `pages/dat-lai-mat-khau.tsx` |

### Checkout & thanh toán

| Route | File | Ghi chú |
|-------|------|---------|
| `/checkout/1` | `pages/checkout/1.tsx` | Chọn môi trường trước |
| `/checkout-plan` | `pages/checkout-plan.tsx` | Alias `/checkout/1` |
| `/checkout/2` | `pages/checkout/2.tsx` | Combo |
| `/checkout` | `pages/checkout.tsx` | Router checkout |
| `/payment` | `pages/payment.tsx` | Xác nhận chuyển khoản |

### Dashboard (middleware: cookie `gpuvietnam-auth`)

| Route | File |
|-------|------|
| `/dashboard` | `pages/dashboard.tsx` |
| `/dashboard/goi-cua-toi` | `pages/dashboard/goi-cua-toi.tsx` |
| `/dashboard/model-lora` | `pages/dashboard/model-lora.tsx` |
| `/dashboard/workflows` | `pages/dashboard/workflows.tsx` |
| `/dashboard/storage` | `pages/dashboard/storage.tsx` |
| `/dashboard/storage/checkout` | `pages/dashboard/storage/checkout.tsx` |
| `/dashboard/lich-su` | `pages/dashboard/lich-su.tsx` |
| `/dashboard/wallet` | `pages/dashboard/wallet.tsx` |
| `/dashboard/cai-dat` | `pages/dashboard/cai-dat.tsx` |

### Admin (live)

| Route | File | Ghi chú |
|-------|------|---------|
| `/admin` | `pages/admin.tsx` | Tab: requests, gpuPricing, storagePricing, hourGrants |
| `/admin/infrastructure` | `pages/admin/infrastructure.tsx` | Monitor hạ tầng (mock market + API) |
| `/admin/customers` | `pages/admin/customers.tsx` | Quản lý KH, export Excel, remote support |
| `/admin/tang-gio` | `pages/admin/tang-gio.tsx` | Tặng giờ (trùng tab hourGrants) |

### Admin legacy (demo / preview — không dùng production)

| Route | File |
|-------|------|
| `/admin/ha-tang` | `pages/admin/ha-tang.tsx` — mock tĩnh |
| `/admin/khach-hang` | `pages/admin/khach-hang.tsx` — mock tĩnh |
| `/admin/tai-nguyen` | `pages/admin/tai-nguyen.tsx` — mock tĩnh |

---

## 6. Dashboard khách hàng

Sidebar: `src/components/dashboard/DashboardShell.tsx`

| Tab | Route | Trạng thái |
|-----|-------|------------|
| Trung tâm Điều khiển | `/dashboard` | ✅ Bật/tắt máy (optimistic UI), boot progress bar, stop confirm modal, ComfyUI link, đổi môi trường, billing live (2 decimal), thông báo |
| Gói của tôi | `/dashboard/goi-cua-toi` | ✅ Kho gói, activate/deactivate, tái tục |
| Model & LoRA | `/dashboard/model-lora` | ⚠️ Upload/list OK; "Dùng ngay trên GPU" = stub |
| Workflow | `/dashboard/workflows` | ⚠️ Upload/list OK; "Chạy workflow" = stub |
| Bộ nhớ | `/dashboard/storage` | ✅ SSD/backup plan, upgrade, R2 files |
| Lịch sử | `/dashboard/lich-su` | ✅ Phiên GPU từ `gpu_sessions` |
| Ví Nạp Trước | `/dashboard/wallet` | ✅ Số dư + nạp + auto-renew (Combo) + lịch sử 7gd mở rộng + modal nâng cấp bộ nhớ (gộp từ tab Cài đặt) |
| Cài đặt | `/dashboard/cai-dat` | ✅ Profile, SĐT, mật khẩu, xóa backup (đã gỡ card Ví + card Gia hạn tự động + card Giao diện sang tab Ví / xóa) |

**Trung tâm Điều khiển** (`DashboardOverview.tsx`): card máy chủ (3 thẻ: phiên/giờ/hiệu suất), gói & giờ (2 decimal `Xh/Yh`), boot progress bar trong lúc chờ ComfyUI traffic-ready, optimistic start/stop (UI chuyển `opening`/`stopping` ngay), stop confirmation modal, hiệu suất realtime (poll `/api/machines/status` — **infra-only**, không còn `billingView`), phiên gần đây, chuông thông báo + remote support approve/reject. Billing truth lấy từ `GET /api/dashboard/me` (`machineSessionView` + `billingView`) — xem [`docs/ui/DASHBOARD_VIEW_CONTRACT.md`](ui/DASHBOARD_VIEW_CONTRACT.md).

**Ví Nạp Trước** (`DashboardWalletPage.tsx`): card gộp `💰 VÍ NẠP TRƯỚC` (số dư + nạp + hints + auto-renew toggle cho Combo + lịch sử 7 giao dịch mở rộng) + aside "Mua thêm dịch vụ" (Nạp giờ/Tái tục, Combo, Nâng cấp bộ nhớ — mở `StorageUpgradeModal` tại chỗ, không chuyển trang).

---

## 7. Admin

Xác thực: `AdminAuthGate` — Bearer role `admin` hoặc header `x-admin-secret`.

| Chức năng | API chính | Trạng thái |
|-----------|-----------|------------|
| Duyệt đơn (gói, ví, storage, renew) | `/api/admin/pending-requests`, approve/reject routes | ✅ |
| Quản lý KH | `/api/admin/customers`, `customer-stats` | ✅ |
| Tặng giờ | `/api/admin/hour-grants` | ✅ |
| Cấu hình giá GPU | `/api/admin/gpu-pricing` | ✅ |
| Cấu hình giá storage | `/api/admin/storage-pricing` | ✅ |
| Bật/tắt máy KH | `/api/admin/machines/toggle` | ✅ |
| Remote support (admin gửi) | `/api/admin/support/request` | ✅ (session tracking; chưa WebRTC thật) |
| Tab overview / sessions / billing | `/admin?tab=…` | ❌ placeholder |

---

## 8. Kiến trúc GPU & ComfyUI

### Image Docker

| Thành phần | Giá trị |
|------------|---------|
| Registry | **Docker Hub** `dieuhaukieuhanh/gpuvietnam-comfyui:v1` (legacy: GHCR) |
| Base | `nvidia/cuda:12.0.0-runtime-ubuntu22.04` |
| Python | 3.10 |
| PyTorch | cu118 (`--default-timeout=300 --retries 5`) |
| Frontend pin | `comfyui-frontend-package==1.45.20` |
| ComfyUI | git clone + retry; ComfyUI-Manager |
| Port | 8080 |

### Boot container (`scripts/start.sh`)

1. `setup-workstation.sh` — copy workflow theo `GPUVIETNAM_WORKSTATION`
2. `download-models.sh` — SDXL Base, RealVisXL V6, Real-ESRGAN 4x (skip nếu `GPUVIETNAM_SKIP_MODEL_DOWNLOAD=1`)
3. `python main.py --listen 0.0.0.0 --port 8080 --enable-cors-header "*"`

### Môi trường làm việc (ComfyUI)

Định nghĩa: `src/lib/workstations.ts` + `src/lib/workstation-env.js`

| ID | Tên hiển thị | Slug container | Workflow files |
|----|--------------|----------------|----------------|
| 1 | ComfyUI — Character & Art | `character-art` | avatar-ghibli, sinh-anh-co-ban, upscale-anh-cu |
| 2 | ComfyUI — Commerce & Product | `commerce-product` | tao-anh-san-pham, doi-background |
| 3 | ComfyUI — Video AI | `video-ai` | sinh-anh-co-ban |
| 4 | Jupyter — ML/DL Research | — | ❌ chưa có image |
| 5 | Blender — Render & Design | — | ❌ chưa có image |
| 6 | Custom | — | ❌ bị reject khi đổi env |

**Áp dụng workflow:**
- **Lúc thuê Vast:** `buildWorkstationContainerEnv()` → env vars vào container → `setup-workstation.sh` khi boot
- **Máy đang chạy:** `ensureWorkstationApplied()` qua SSH (`workstation-setup.js`); không có SSH → chỉ cập nhật DB, cần restart máy

### GPU lines (plan → hardware)

| Gói app | GPULine Vast | GPU |
|---------|--------------|-----|
| Starter | `rtx3090` | RTX 3090 |
| Pro | `rtx4090_1x` | RTX 4090 |
| Studio | `rtx5090_1x` | 1× RTX 5090 |

Region mặc định: Taiwan → Japan → Singapore (`GPU_REGIONS` override).

---

## 9. Luồng nghiệp vụ chính

### Mua gói

```
Checkout → POST /api/payment/confirm (chuyển khoản, pending_payment)
        hoặc POST /api/payment/pay-wallet (trừ ví ngay)
→ Admin approve → subscriptions.status = active
→ syncUserPlanInventory() → user_plan_inventory
```

### Bật máy GPU

```
POST /api/user/start-machine
→ repairUserBillingState()
→ subscription.server_status = provisioning
→ getGpuService().createInstance()  [Vast rent + container env]
→ insert machines row
→ Poll GET /api/machines/status
→ ComfyUI healthy → server_status = online
→ startBilling() + ensureWorkstationApplied()
```

### Billing phiên

- Chỉ trừ khi `machines.status === 'running'` và ComfyUI healthy
- **Combo/gift:** `subscriptions.hours_used` hoặc `manual_hour_grants.hours_used` → sync inventory
- **Hourly:** trừ `users.wallet_balance` → `wallet_transactions`
- Ghi `gpu_sessions` (started_at, ended_at, duration, VRAM, outputs)
- Auto-stop: idle 60 phút (queue rỗng) hoặc hết giờ/ví → `destroyUserMachine()`

### Tắt máy

```
POST /api/user/stop-machine  hoặc  POST /api/machines/destroy
→ backup (optional) → stopBilling() → destroyInstance Vast
→ SCB 4.0 (ADR-004 D1): client gửi clientRemainingHours + clientSessionDurationSeconds
   - server validate: non-negative usage, drift ≤ 0.05h vs billing_started_at, no-gain
   - chạy destroy pipeline (runDestroyPipeline — frozen) như cũ
   - nếu settlement OK + client value hợp lệ: CAS-guarded override subscriptions.hours_used
     hoặc manual_hour_grants.hours_used (projection only, không đụng gpu_sessions SoT)
   - syncUserPlanInventory() → user_plan_inventory
→ machine destroyed, subscription offline
```

> Chi tiết kiến trúc đóng băng SCB 4.0: [`docs/scb/ADR-004-scb4-product-exceptions.md`](scb/ADR-004-scb4-product-exceptions.md)

### Đổi môi trường

```
POST /api/user/change-environment
→ cập nhật subscriptions.env_name
→ nếu máy running + SSH OK: chạy setup-workstation.sh remote
→ nếu không: DB only — restart máy để áp dụng workflow
```

---

## 10. Auth & phân quyền

**Mô hình hybrid:** Supabase Auth (identity) + `public.users` (profile) + OTP SMS custom.

| Bước | Cơ chế |
|------|--------|
| Đăng ký | `POST /api/register` → `auth.admin.createUser` + upsert `public.users` + SMS OTP |
| Xác thực SĐT | `POST /api/otp/verify` → `otp_verifications` + `phone_verified=true` |
| Đăng nhập | `POST /api/auth/login` → Supabase password grant + sync role |
| Session | JWT Supabase + cookie `gpuvietnam-auth=1` (middleware dashboard) |
| Admin | `public.users.role = 'admin'` hoặc email trong `ADMIN_EMAILS` |

**Không dùng** trigger `on_auth_user_created` — profile sync trong API register (`supabase/fix-trigger.sql`).

---

## 11. Database (Supabase)

Schema: **32 file SQL** trong `supabase/` — chạy **thủ công** theo thứ tự phụ thuộc (không có `supabase/migrations/`).

### Thứ tự bootstrap (core)

```
schema.sql → fix-trigger.sql → subscriptions.sql → add-user-role.sql
→ hour-grants.sql → user-plan-inventory.sql → gpu-sessions.sql
→ machines.sql → machines-billing.sql → machines-idle.sql
→ (+ wallet, storage, notifications, pricing, support…)
```

### Bảng quan trọng

| Bảng | Vai trò |
|------|---------|
| `auth.users` | Supabase Auth |
| `public.users` | Profile, `wallet_balance`, `role`, storage plan GB |
| `subscriptions` | Gói active: plan, billing, env_name, hours_total/used, server_status |
| `user_plan_inventory` | Cache gói cho UI/billing (sync từ subscriptions + grants) |
| `manual_hour_grants` | Giờ tặng từ admin |
| `machines` | Instance Vast đang/đã chạy, billing fields |
| `gpu_sessions` | Lịch sử phiên + session đang chạy |
| `wallet_transactions` | Ledger ví (balance trên `users.wallet_balance`) |
| `storage_files`, `storage_upgrades` | Backup R2 + nâng cấp dung lượng |
| `workflows`, `models` | Metadata workflow/model KH upload |
| `notifications` | Chuông thông báo dashboard |
| `support_sessions` | Remote support (admin → KH approve) |
| `gpu_pricing_config` | JSON cấu hình giá (single row id=1) |

**Quan hệ billing:**

```
subscriptions ──sync──► user_plan_inventory ◄── manual_hour_grants
       │                        │
       └──── machines ──────────┘ (billing_inventory_id, gpu_session_id)
                    │
              gpu_sessions
```

---

## 12. API (tóm tắt)

**Tổng: 72 route files** trong `src/pages/api/`. Chi tiết đầy đủ: grep thư mục hoặc xem `PROGRESS.md`.

| Nhóm | Ví dụ | Số lượng |
|------|-------|----------|
| Auth & OTP | `/api/auth/login`, `/api/register`, `/api/otp/*` | 6 |
| User profile/settings | `/api/user/profile`, `settings`, `password` | 6+ |
| Plans & billing | `/api/user/plans`, `active-plans`, `auto-renew` | 8 |
| GPU machines | `/api/user/start-machine`, `stop-machine`, `change-environment` | 5 |
| Machines poll | `/api/machines/status`, `destroy`, `recent-outputs` | 3 |
| Payment | `/api/payment/confirm`, `pay-wallet`, `renew` | 3 |
| Wallet | `/api/user/wallet`, `wallet/deposit` | 2 |
| Storage | `/api/storage/*`, backup routes | 7 |
| Support | `/api/support/*`, `/api/admin/support/request` | 7 |
| Admin | pending approve, customers, hour-grants, pricing… | 22 |
| Cron | `/api/cron/check-idle` | 1 |
| Public | `/api/gpu-pricing` | 1 |

**Stub/disabled:** `POST /api/support/request` — luôn 403 (chỉ admin khởi tạo support).

---

## 13. Docker & scripts

| File | Vai trò |
|------|---------|
| `Dockerfile` | Build image ComfyUI CUDA 12.0 |
| `docker-compose.yml` | Dev local GPU, port 8080, volumes models/output/workflows |
| `scripts/start.sh` | Entrypoint container |
| `scripts/setup-workstation.sh` | Lọc workflow từ `workflows-stock/` theo env |
| `scripts/download-models.sh` | Tải checkpoint/upscaler |
| `workflows/*.json` | 5 workflow stock (mount + bake vào image) |

**Workflow stock:**

| File | Mô tả |
|------|--------|
| `tao-anh-san-pham.json` | Ảnh sản phẩm |
| `doi-background.json` | Đổi background |
| `avatar-ghibli.json` | Avatar Ghibli |
| `upscale-anh-cu.json` | Upscale Real-ESRGAN |
| `sinh-anh-co-ban.json` | Text-to-image SDXL |

**Lệnh dev:**

```bash
docker pull nvidia/cuda:12.0.0-runtime-ubuntu22.04
docker compose build --no-cache
docker compose up -d
# UI: http://localhost:8080

# Push production (sau build)
docker push dieuhaukieuhanh/gpuvietnam-comfyui:v1
```

---

## 14. Biến môi trường

### Next.js (`.env.local`)

```env
# Supabase (bắt buộc)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Vast.ai (bắt buộc khi spawn GPU)
VAST_AI_KEY=                    # hoặc VAST_API_KEY

# ComfyUI image trên Vast
GPUVIETNAM_COMFYUI_IMAGE=dieuhaukieuhanh/gpuvietnam-comfyui:v1
COMFYUI_PORT=8080
DEFAULT_DISK_SIZE=32
GPU_REGIONS=Taiwan,Japan,Singapore

# SSH — đổi workflow khi máy đang chạy
VAST_SSH_PRIVATE_KEY_PATH=C:/Users/Lenovo/.ssh/id_rsa
# hoặc VAST_SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----..."

# Models
CIVITAI_API_TOKEN=

# SMS OTP
SPEEDSMS_ACCESS_TOKEN=

# Admin
ADMIN_EMAILS=admin@example.com
ADMIN_SECRET=

# Cron idle check
CRON_SECRET=

# R2 backup
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
```

### Container (set lúc Vast rent)

| Biến | Ý nghĩa |
|------|---------|
| `GPUVIETNAM_WORKSTATION` | `character-art` / `commerce-product` / `video-ai` |
| `GPUVIETNAM_ENV_NAME` | Tên hiển thị môi trường |
| `GPUVIETNAM_ENV_ICON` | Emoji icon |
| `GPUVIETNAM_SKIP_MODEL_DOWNLOAD` | `1` = bỏ qua tải model lúc boot |
| `CIVITAI_API_TOKEN` | Tải RealVisXL trong container |

---

## 15. Gói giá & billing

**SoT giá bán (live):** Admin → Edit giá (`/admin?tab=gpuPricing`) → bảng `gpu_pricing_config`.
Web (trang chủ, checkout, payment, dashboard) đọc qua `/api/gpu-pricing` + `useGpuPricingConfig`.
Seed/fallback khi DB trống: `src/lib/gpu-pricing-defaults.js` (đồng bộ `GPU_PLANS` / `CHECKOUT_PLANS`).

Giá marketing mặc định (tham chiếu seed — **không** sửa giá live tại đây):

| Gói | GPU | Giá/giờ lẻ (VNĐ) | Combo1 (100+10h) | Combo2 (200+30h) |
|-----|-----|------------------|------------------|------------------|
| Starter | RTX 3090 | 9.900 | 990.000 | 1.980.000 |
| Pro | RTX 4090 | 20.000 | 2.000.000 | 4.000.000 |
| Studio | RTX 5090 | 35.000 | 3.500.000 | 7.000.000 |

- **Trial:** 3 giờ Starter — OTP SĐT, chống lạm dụng IP
- **Ví:** nạp trước, bonus 2–5%, dùng mua gói / hourly / auto-renew
- **Thanh toán:** chuyển khoản (admin duyệt) hoặc trừ ví ngay
- **Tái tục:** wallet hoặc chuyển khoản (`plan_renew_requests`)

---

## 16. Đã làm vs chưa làm

### ✅ Đã triển khai

- Marketing pages, auth OTP, checkout, payment pending/approve
- Dashboard đầy đủ tab (trừ GPU run trên workflow/model)
- Ví, kho gói, tái tục, auto-renew, trial
- GPUService + Vast rent/destroy + multi-offer retry
- Billing phiên, auto-stop idle, orphan session repair
- Đổi môi trường + workflow theo env (boot + SSH)
- Storage R2, backup logs, upgrade plan
- Admin: duyệt đơn, KH, tặng giờ, pricing, machine toggle, support request
- Docker ComfyUI local; image config cho Vast
- **SCB 4.0 (tag `scb-4.0`):** server-authoritative remaining hours (ADR-004 D1 — client-validated projection override, CAS-guarded); `/api/machines/status` infra-only (D2); suppress drift reset trong async provisioning (D3)
- **Dashboard UX:** optimistic start/stop, boot progress bar, stop confirmation modal, remaining hours 2 decimal (`Xh/Yh`), gộp Wallet tab (balance + auto-renew + storage upgrade modal)

### ⏳ Đang / chờ

- Push Docker Hub sau build `--no-cache`
- Test E2E môi trường trên Vast instance thật
- `download-models.sh` trên instance production

### ❌ Chưa / kế hoạch

- Dashboard nút “Chạy workflow” → `getGpuService().submitWorkflow()`
- Model/LoRA “Dùng ngay” trên ComfyUI
- LoRA Việt hóa trong image/script
- Jupyter, Blender workstation
- Trợ lý AI (Qwen/Ollama)
- VNPay/PayOS webhook tự động
- RunPod / multi-cloud provider
- WebRTC remote support thật
- Admin tabs overview/sessions/billing analytics

---

## 17. Thay đổi gần đây

| Hạng mục | Chi tiết |
|----------|----------|
| **SCB 4.0 đóng băng** | Tag `scb-4.0` (commit `bbed8da`); ADR-004 ghi nhận 3 ngoại lệ product-layer (D1 client-validated hours override, D2 machines/status infra-only, D3 suppress drift reset). Closed ADR set: ADR-001..004. Xem [`docs/scb/SCB_CHANGELOG.md`](scb/SCB_CHANGELOG.md) |
| **Server-authoritative remaining hours** | `POST /api/machines/destroy` nhận `clientRemainingHours`; server validate drift ≤ 0.05h + non-gain + CAS guard; ghi projection (`subscriptions.hours_used` / `manual_hour_grants.hours_used`), không đụng `gpu_sessions` SoT |
| **Dashboard UX** | Optimistic start/stop (UI chuyển `opening`/`stopping` ngay), boot progress bar, stop confirmation modal, hiển thị giờ còn lại 2 decimal (`20.09h/110h`) |
| **`/api/machines/status` infra-only** | Bỏ `billingView`/`remainingFields`/`sessionFields` khỏi response; billing truth lấy từ `/api/dashboard/me`. Xem [`docs/ui/DASHBOARD_VIEW_CONTRACT.md`](ui/DASHBOARD_VIEW_CONTRACT.md) |
| **Wallet tab merge** | Gộp card Ví + card Gia hạn tự động + modal nâng cấp bộ nhớ vào `/dashboard/wallet`; gỡ card Giao diện sáng/tối khỏi `/dashboard/cai-dat` |
| **Docker registry** | GHCR → Docker Hub `dieuhaukieuhanh/gpuvietnam-comfyui:v1` |
| **Dockerfile** | PyTorch timeout/retry; pin frontend 1.45.20; git clone retry; pip fallback |
| **Workstation** | `setup-workstation.sh` + 3 env ComfyUI với workflow riêng |
| **GPUService** | Wire `start-machine`, billing fix, multi-offer Vast retry |
| **SSH** | `VAST_SSH_PRIVATE_KEY_PATH` cấu hình local (cần pub key trên Vast.ai) |

---

## 18. Dev & vận hành

```bash
cd gpuvietnam
npm install
npm run dev          # http://localhost:3000

npm run build        # Production build
npm run convert      # Tái tạo pages từ HTML gốc (thư mục cha)
```

**Checklist sau deploy code mới:**

1. `npm run build` pass
2. SQL mới chạy trên Supabase (nếu có)
3. Docker: build → push Docker Hub → cập nhật Vast template/image env
4. Test: đăng ký → mua gói → bật máy → đổi môi trường → tắt máy → kiểm tra giờ/ví

**Chat mới — copy nhanh:**

```
Tiếp tục GPUVietnam. Đọc docs/PROJECT_CONTEXT.md + docs/PROGRESS.md + docs/scb/SCB-MAINTENANCE-MODE.md.
SCB 4.0 đã đóng băng (tag scb-4.0, ADR-001..004 closed set). Không refactor frozen components.
Control Plane / Runtime v2.0 đã đóng băng (docs/architecture/ARCHITECTURE_V2_FREEZE.md, ADR-005).
Triển khai theo v2.0 (Job/Attempt, Runtime Port, Comfy Adapter). Đổi kiến trúc CP/Runtime → ADR-006+ + evidence.
Product layer OK: UI/Dashboard/Wallet/Billing UX trong giới hạn hai freeze.
Docker Hub dieuhaukieuhanh/gpuvietnam-comfyui:v1. GPUService + billing + env workflow ✅.
SSH: VAST_SSH_PRIVATE_KEY_PATH. Tiếp: push image → test Vast E2E.
```

---

## 19. Nguyên tắc truyền thông (KH-facing)

Áp dụng cho copy marketing, FAQ, support — **không** áp dụng cho tài liệu dev nội bộ.

1. Không nhắc backend: Vast.ai, RunPod, Docker, R2, Supabase…
2. Không nói “thuê ngoài” / “máy nước ngoài”
3. Nói **giá trị** (“vào là chạy”), không nói công nghệ triển khai
4. Biến giới hạn kỹ thuật thành tính năng (vd. trợ lý tạm dừng khi bạn render)
5. Hạ tầng (nếu được hỏi): *“GPUVietnam có hạ tầng tối ưu cho AI Art tại các trung tâm dữ liệu hiện đại.”*

---

*Tài liệu cập nhật: 2026-07 — đối chiếu với codebase Next.js 14.2, 72 API routes, 32 SQL files, Docker CUDA 12.0. SCB 4.0 đóng băng tại tag `scb-4.0` (ADR-001..004).*
