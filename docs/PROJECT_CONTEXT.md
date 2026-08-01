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
| **Mô hình kinh doanh** | Resell GPU marketplace + giá trị gia tăng (workflow, hỗ trợ, thanh toán VN) |
| **Đối tượng chính** | Freelancer AI Art (~60%), sinh viên/người mới (~25%), agency nhỏ (~15%) |
| **Điểm khác biệt (mục tiêu)** | Workspace/workflow không phụ thuộc một GPU; failover compute; thanh toán VN |
| **Backend GPU thực tế** | **Clore + Vast** (adapter); Go-Live/P0-A **ưu tiên Clore** (`GPU_CLORE_ONLY=true` trên VPS worker). Thuê theo giờ khi KH bật máy |
| **Control Plane** | `gpuvietnam.com` (Vercel Next) — session, billing, enqueue start |
| **Lifecycle worker** | VPS Linux always-on (`gpuvietnam-lifecycle-worker`) — claim/execute `user_start_provision` |

---

## 2. Trạng thái triển khai (2026-07)

| Hạng mục | Trạng thái |
|----------|------------|
| Next.js app (marketing + auth + checkout + dashboard + admin) | ✅ Production (`gpuvietnam.com`) |
| Supabase Auth + migrations (kể cả P0-A 0049) | ✅ |
| Ví Nạp Trước, mua gói, tái tục, trial 3h | ✅ |
| GPUService + Vast + **Clore** adapters | ✅ |
| **CP/Runtime Architecture v2.0** | ✅ Frozen (ADR-005); Continuity A→B chứng minh trên Clore |
| **P0-A durable Start** (enqueue + VPS worker) | ✅ **Phase F.2: 7/7 PASS** (boot events, v3.4, R2 restore) |
| **VPS lifecycle worker + Vast-only** | ✅ Chốt 2026-08-01 (systemd `GPU_VAST_ONLY=true` + `GPU_ALLOW_VAST=true`) |
| **Session Continuity** (Backup → Destroy → Start → Restore) | ✅ E2E verified; auto-restore không giới hạn 200MB |
| Billing theo phiên (combo giờ + hourly ví) | ✅ logic; P0-B T11 E2E **chưa** ký |
| **SCB 4.0 — server-authoritative remaining hours** | ✅ Frozen at tag `scb-4.0` (ADR-004) |
| **Dashboard UX — optimistic start/stop, boot progress, stop confirm, editor khi boot** | ✅ |
| **Wallet tab merge** | ✅ |
| ComfyUI image prod | ✅ `:v3.4` (Starter/Pro) + `:v4.1` (Studio); `:v3.5` + `:v4.2` đang build với filmmaker scripts |
| **Filmmaker Mode** | ✅ Frame Saver + Auto-Skip + Auto-Resume + Realtime Quality Check (InsightFace) |
| Môi trường làm việc → workflow riêng | ✅ (boot + SSH runtime) |
| ComfyUI transparent reconnect | ✅ Update upstream giữ nguyên workUrl khi auto-replace |
| Server-side boot events | ✅ Worker ghi thẳng `runtime_boot_events` |
| Dual Run / warm pool | ❌ sau MVP / sau P0-A..D |
| Dashboard "Chạy workflow" trên GPU | ❌ stub / CP Job path đang mở rộng |
| Jupyter / Blender workstation | ❌ UI only — "Sắp ra mắt" |
| VNPay/PayOS tự động | ❌ dùng chuyển khoản + admin duyệt |

> **Go-Live (owner order):** P0-A ✅ → P0-B billing T11 → P0-C alerts → P0-D E2E khách.  
> Chi tiết: [`docs/operations/LIFECYCLE_WORKER.md`](operations/LIFECYCLE_WORKER.md), [`docs/PROGRESS.md`](PROGRESS.md).

---

## 3. Stack kỹ thuật

| Lớp | Công nghệ |
|-----|-----------|
| **Frontend** | Next.js **14.2** Pages Router, React 18, TypeScript (một phần) |
| **Auth & DB** | Supabase Auth + Postgres + Storage |
| **SMS OTP** | Speedsms.vn (`src/lib/speedsms.js`); dev thiếu token → OTP hiện trên `/verify-otp` |
| **Backup storage** | Cloudflare R2 qua `@aws-sdk/client-s3` |
| **GPU backend** | Vast adapter (`src/lib/gpu/providers/vast/…`); **P0-A VPS:** `GPU_VAST_ONLY=true` + `GPU_ALLOW_VAST=true` |
| **Lifecycle worker** | VPS systemd → `scripts/lifecycle-worker.mjs` (claim `machine_operations`) |
| **ComfyUI image** | Docker Hub `:v3.4` (Starter/Pro) + `:v4.1` (Studio/5090); port **8080** |
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

**Tầng GPU / Start (bắt buộc tuân thủ):**

```
POST /api/user/start-machine
  → enqueue user_start_provision (machine_operations)
  → VPS lifecycle-worker claim / execute
  → provider routing (P0-A: Vast-only) → rent → gate → machines row
```

Dashboard / billing UI **không** gọi Clore/Vast API trực tiếp. Dual-run (nếu có) qua API CP riêng, không qua `start-machine`.

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
| Registry prod | **Docker Hub** `dieuhaukieuhanh/gpuvietnam-comfyui:v3` (Starter/Pro) |
| Ghi chú | Không overwrite tag `:v3` trừ khi promote có chủ đích; Studio/5090 có dòng image riêng nếu cấu hình |
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

| Gói app | GPULine | GPU | Ghi chú provider |
|---------|---------|-----|------------------|
| Starter | `rtx3090` | RTX 3090 | Clore + Vast |
| Pro | `rtx4090_1x` | RTX 4090 | Clore + Vast |
| Studio | `rtx5090_1x` | 1× RTX 5090 | **Vast-oriented** (Clore line không hỗ trợ 5090) |

P0-A / smoke ổn định: **Clore-only** trên VPS worker. Routing mặc định code = Vast→Clore nếu không set `GPU_CLORE_ONLY`.

---

## 9. Luồng nghiệp vụ chính

### Mua gói

```
Checkout → POST /api/payment/confirm (chuyển khoản, pending_payment)
        hoặc POST /api/payment/pay-wallet (trừ ví ngay)
→ Admin approve → subscriptions.status = active
→ syncUserPlanInventory() → user_plan_inventory
```

### Bật máy GPU (P0-A)

```
POST /api/user/start-machine
→ claim subscription / idempotency single-start
→ enqueue machine_operations (user_start_provision) → 200 { operationId }
→ VPS lifecycle-worker: lease + heartbeat + provision
→ provider order: GPU_CLORE_ONLY=true → Clore only (prod P0-A)
→ rent + L2 gate (HTTP/Comfy) → machines row
→ UI poll /api/machines/status + provision-progress
→ Comfy traffic-ready → op completed + billing anchor
```

> Network DevTools: `start-machine` chỉ xuất hiện **một lần** lúc bấm; sau đó chủ yếu `status` / `provision-progress`.

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
- GPUService + **Vast + Clore** adapters, multi-offer / candidate walk, bad-host
- **CP/Runtime v2.0** freeze + Continuity A→B (Clore) evidence
- **P0-A code + VPS worker** (enqueue start, systemd, Clore-only chốt 2026-07-24)
- Billing phiên, auto-stop idle, Clore orphan reconcile (in-process)
- Đổi môi trường + workflow theo env (boot + SSH)
- Storage R2, backup, upgrade plan
- Admin: duyệt đơn, KH, tặng giờ, pricing, machine toggle, support request
- Image prod `:v3`
- **SCB 4.0** + **Dashboard UX** optimistic start/stop

### ⏳ Đang / chờ (Go-Live)

- **P0-A acceptance smoke** — Start→Comfy→op `completed` (+ restart worker / orphan) với Clore-only đã chốt
- Deploy harden Vast disk-only / loader alias lên VPS (hiện patch tay + VPS còn `1f700cd`)
- **P0-B** T11 billing proof · **P0-C** alerts · **P0-D** E2E khách
- Nới / tinh chỉnh fail-fast 502 vs thời gian pull image (tránh đổi host Clore quá sớm)

### ❌ Chưa / kế hoạch (sau MVP)

- Dual Run product / warm pool / đổi GPU không reload
- Dashboard “Chạy workflow” end-to-end trên CP Job path
- Jupyter, Blender, VNPay/PayOS, WebRTC remote support thật

---

## 17. Thay đổi gần đây

| Hạng mục | Chi tiết |
|----------|----------|
| **P0-A + VPS worker (2026-07)** | `start-machine` enqueue durable; VPS `gpuvietnam-lifecycle-worker`; docs `LIFECYCLE_WORKER.md` / `GO_LIVE_READINESS_AUDIT.md` |
| **Clore-only chốt trên VPS (2026-07-24)** | `Environment=GPU_CLORE_ONLY=true` trên systemd + verify `/proc/.../environ`; tạm dừng trước Start sạch acceptance |
| **Smoke note (2026-07-23)** | Khi CLORE_ONLY chưa vào process: dual Vast+Clore, Vast disk-only (`gpuCost=0`); Clore 502 walk đổi host liên tục → hết order. Không phải “Clore API chết”. |
| **CP/Runtime v2.0** | ADR-005 + Continuity A→B Clore PASS WITH CONSTRAINTS |
| **SCB 4.0 đóng băng** | Tag `scb-4.0`; ADR-001..004 closed |
| **Dashboard UX** | Optimistic start/stop, boot progress, stop confirm, giờ 2 decimal |
| **`/api/machines/status` infra-only** | Billing từ `/api/dashboard/me` |
| **Image prod** | `dieuhaukieuhanh/gpuvietnam-comfyui:v3` |

---

## 18. Dev & vận hành

```bash
cd gpuvietnam
npm install
npm run dev          # http://localhost:3000

npm run build        # Production build
npm run convert      # Tái tạo pages từ HTML gốc (thư mục cha)
```

**Checklist sau deploy / P0-A:**

1. VPS worker `active` + `GPU_CLORE_ONLY=true` trong environ process
2. Migration 0049 applied
3. Start một lần từ `gpuvietnam.com` → `operationId` → Comfy → Stop sạch (Clore 1 order, Vast 0)
4. (Tuỳ chọn) `systemctl restart` worker giữa provision — op không mất

**Chat mới — copy nhanh:**

```
Tiếp tục GPUVietnam. Đọc docs/PROJECT_CONTEXT.md + docs/PROGRESS.md + docs/operations/LIFECYCLE_WORKER.md.
SCB 4.0 + ADR-005 CP/Runtime đã freeze. Go-Live: P0-A → P0-B → P0-C → P0-D.
P0-A: VPS worker lên; GPU_CLORE_ONLY đã chốt 2026-07-24. Chưa đóng acceptance smoke.
Tạm dừng sau chốt Clore-only. Image :v3. Branch: feat/cp-runtime-b1.
Không Dual Run / warm pool trừ khi owner mở.
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

*Tài liệu cập nhật: 2026-07-24 — P0-A VPS + Clore-only chốt; Continuity/ADR-005; SCB 4.0 (`scb-4.0`). Chi tiết tiến độ: `docs/PROGRESS.md`.*
