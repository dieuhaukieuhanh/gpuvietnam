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
2. [Trạng thái triển khai (2026-08)](#2-trạng-thái-triển-khai-2026-08)
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
20. [Môi trường Staging & Development](#20-môi-trường-staging--development)
21. [Roadmap — đang ở đâu, còn làm gì](#21-roadmap--đang-ở-đâu-còn-làm-gì)

---

## 1. Tổng quan & định vị

**GPUVietnam** là nền tảng “trạm làm việc trên mây” cho AI Art — không bán GPU thô, mà đóng gói môi trường ComfyUI đã cài sẵn (workflow, model, backup).

| Khía cạnh | Mô tả |
|-----------|--------|
| **Mô hình kinh doanh** | Resell GPU marketplace + giá trị gia tăng (workflow, hỗ trợ, thanh toán VN) |
| **Đối tượng chính** | Freelancer AI Art (~60%), sinh viên/người mới (~25%), agency nhỏ (~15%) |
| **Điểm khác biệt (mục tiêu)** | Workspace/workflow không phụ thuộc một GPU; failover compute; thanh toán VN |
| **Backend GPU thực tế** | Adapter **Vast + Clore + Salad**. **SoT Start (prod):** Admin → Hạ tầng → *Provider routing* (`provider_routing_policy`, default Vast-only). Env `GPU_*_ONLY` chỉ break-glass. Clore 3090/4090/5090. Thuê theo giờ khi KH bật máy |
| **Control Plane** | `gpuvietnam.com` (Vercel Next) — session, billing, enqueue start |
| **Lifecycle worker** | VPS Linux always-on (`gpuvietnam-lifecycle-worker`) — claim/execute `user_start_provision` |

---

## 2. Trạng thái triển khai (2026-08)

| Hạng mục | Trạng thái |
|----------|------------|
| Next.js app (marketing + auth + checkout + dashboard + admin) | ✅ Production (`gpuvietnam.com`) |
| **Auth Hardening (P0+P1+P2)** | ✅ **2026-08-02** — Rate limit, JWT middleware, secure cookie/headers, anti-enumeration, OTP lock, password strength, audit log, sign-out all |
| **Auth Refactor — Email First + Google OAuth** | ✅ **2026-08-08** — Email là chính, SĐT là phụ. Google OAuth trực tiếp (không qua Supabase redirect). Zalo ZNS OTP. Chặn email rác 150+ domain. |
| Supabase Auth + migrations (kể cả P0-A 0049 + auth-audit-log 0052) | ✅ |
| Ví Nạp Trước, mua gói, tái tục, trial 3h | ✅ |
| GPUService + Vast + Clore + **Salad** (backup) adapters | ✅ |
| **CP/Runtime Architecture v2.0** | ✅ Frozen (ADR-005); Continuity A→B chứng minh trên Clore |
| **P0-A durable Start** (enqueue + VPS worker) | ✅ **Phase F.2: 7/7 PASS** (boot events, v3.4, R2 restore) |
| **VPS lifecycle worker** | ✅ Active; `GPU_ALLOW_VAST=true`; **không** pin `GPU_VAST_ONLY` (Admin policy SoT từ 2026-08-09) |
| **Provider routing Admin (Hạ tầng)** | ✅ **Prod 2026-08-09** — bật/tắt + priority cho Start mới; migration `0056`; [`PROVIDER_ROUTING_POLICY.md`](operations/PROVIDER_ROUTING_POLICY.md) |
| **Session Continuity** (Backup → Destroy → Start → Restore) | ✅ E2E verified; auto-restore không giới hạn 200MB |
| Billing theo phiên (combo giờ + hourly ví) | ✅ logic + P0-B T11 **PASS** 2026-08-08 (`tmp/p0b-t11-1786206245215.json`) |
| **SCB 4.0 — server-authoritative remaining hours** | ✅ Frozen at tag `scb-4.0` (ADR-004) |
| **Dashboard UX — optimistic start/stop, boot progress, stop confirm, editor khi boot** | ✅ |
| **Wallet tab merge** | ✅ |
| ComfyUI image prod | ✅ `:v3.7` (Starter/Pro) + `:v4.4` (Studio/5090) — `COMFYUI_LISTEN` default `::` (Salad); Vast/Clore override `0.0.0.0`; 20 GB / 24 GB; ffmpeg + filmmaker |
| **Filmmaker Mode** | ✅ Frame Saver + Auto-Skip + Auto-Resume + Realtime Quality Check (InsightFace) |
| Môi trường làm việc → workflow riêng | ✅ (boot + SSH runtime) |
| ComfyUI transparent reconnect | ✅ Update upstream giữ nguyên workUrl khi auto-replace |
| Server-side boot events | ✅ Worker ghi thẳng `runtime_boot_events` |
| Dual Run / warm pool | ❌ sau MVP / sau P0-A..D |
| **Host Intelligence System** | ✅ **2026-08-06** + **Clore cycle 2026-08-08** — VPS `gpuvietnam-host-intel.timer` (25 phút) → `scripts/host-intelligence-cron.mjs`. Sổ tách `vast-host:*` / `clore-host:*`. Vast + Clore: 3090/4090/**5090** (gpu-test; Clore 5090 timeout gate 180s). Default runtime `providers: { vast: true, clore: false }` — Clore bật qua Admin. Debt: `passRate` chưa cập nhật khi fail. **Không** trong `vercel.json`. |
| **Staging Environment (RC6 Verify)** | 🟡 **2026-08-05** — 4-layer precondition gate PASS; Vast readiness `PASS_HTTP_READY`; Scenario 1 FAIL (Clore provider, không phải RC6); Scenarios 2-5 BLOCKED |
| **MakeStudio** (Train / Preview / Final) | ⏸️ **Sau MVP** — scaffold UI/API/SQL `0053`/Docker giữ; **không** ưu tiên trước Go-Live |
| **LoRA Training** | ⏸️ **Sau MVP** (đi cùng MakeStudio) — lib/Docker/SQL có; chưa wire provision |
| **SePay (CK tự động)** | ✅ **2026-08-08 chốt xong** — VietQR + webhook HMAC + match nạp ví / mua gói / tái tục; mã CK `NVxxxx`; SQL `0054`; cron reconcile daily (Hobby); ops prod + test nạp ví thật OK; tick “đã CK” chỉ đóng UI |
| **Environment Switching** | ✅ **2026-08-05** — `.env.staging` + `.env.production` + script `scripts/switch-env.ps1` |
| Dashboard "Chạy workflow" trên GPU | ❌ stub / CP Job path đang mở rộng |
| Jupyter / Blender workstation | ❌ UI only — "Sắp ra mắt" |
| VNPay/PayOS | ❌ — dùng SePay webhook; fallback CK + admin duyệt |

> **Go-Live (owner order):** P0-A ✅ → P0-B ✅ → P0-C ✅ → Provider routing Admin ✅ → **P0-D** E2E khách.  
> Chi tiết: [`docs/operations/LIFECYCLE_WORKER.md`](operations/LIFECYCLE_WORKER.md), [`docs/PROGRESS.md`](PROGRESS.md), [`docs/operations/PROVIDER_ROUTING_POLICY.md`](operations/PROVIDER_ROUTING_POLICY.md).

---

## 3. Stack kỹ thuật

| Lớp | Công nghệ |
|-----|-----------|
| **Frontend** | Next.js **14.2** Pages Router, React 18, TypeScript (một phần) |
| **Auth & DB** | Supabase Auth + Postgres + Storage |
| **OTP** | Zalo ZNS trước → fallback Speedsms (`zalo-zns.js`, `speedsms.js`); SĐT verify trong Dashboard |
| **OAuth** | Google OAuth trực tiếp (`google-oauth.js`) — consent `gpuvietnam.com` |
| **Thanh toán CK** | SePay VietQR + webhook auto-approve ✅ + Admin duyệt thủ công (fallback) |
| **Backup storage** | Cloudflare R2 qua `@aws-sdk/client-s3` |
| **GPU backend** | Vast + Clore + Salad; Start order = Admin Hạ tầng `provider_routing_policy` (prod); `GPU_*_ONLY` = break-glass |
| **Lifecycle worker** | VPS systemd → `scripts/lifecycle-worker.mjs` (claim `machine_operations`) |
| **ComfyUI image** | Docker Hub `:v3.7` (Starter/Pro) + `:v4.4` (Studio/5090); port **8080**; listen qua `COMFYUI_LISTEN` |
| **Host-intel test image** | `dieuhaukieuhanh/gpu-test:v1` (~200–300MB); bake/default `HOST=0.0.0.0` (Vast IPv4) |
| **MakeStudio images** | `makestudio-train-face:v1` · `makestudio-preview:720p-v1` · `makestudio-final:v1` (⏸️ sau MVP) |
| **Export Excel** | `xlsx` (admin customers) |

**Quy ước UI:** CSS gốc từ HTML inject qua `<style dangerouslySetInnerHTML>`; script tương tác qua `src/lib/scripts/*.ts` + `new Function()` trong `useEffect`. Font: Inter + Space Grotesk. Màu: `#0A0A0F`, accent `#4F8EF7`.

---

## 4. Cấu trúc mã nguồn

```
gpuvietnam/
├── src/
│   ├── pages/              # Routes Next.js + ~115 API handlers
│   ├── components/
│   │   ├── layout/         # PublicHeader, DashboardSidebar, AdminAuthGate…
│   │   ├── dashboard/      # DashboardOverview, WorkflowPanel, Wallet…
│   │   ├── makestudio/     # MakeStudio UI — park sau MVP
│   │   ├── admin/          # Admin panels (customers, infrastructure, pricing…)
│   │   └── pages/          # Một component / trang HTML gốc
│   ├── lib/
│   │   ├── gpu/            # GPUService, providers (vast/clore/salad), host-reputation, billing
│   │   ├── makestudio/     # job-manager + provision-jobs — sau MVP
│   │   ├── lora-train/     # job-manager + provision-train — sau MVP
│   │   ├── sepay.js / transfer-code.js  # VietQR + webhook + mã NVxxxx
│   │   ├── workstation-env.js
│   │   ├── workstations.ts
│   │   ├── user-plan-inventory.js
│   │   ├── gpu-sessions.js
│   │   └── scripts/        # JS gốc từ HTML
│   ├── hooks/              # useDashboard, useUserPlans, useMakestudio…
│   └── middleware.ts       # Bảo vệ /dashboard/* (JWT verify HS256 với SUPABASE_JWT_SECRET)
├── supabase/               # SQL + MIGRATION_MANIFEST.json (runner scripts/run-migrations.mjs)
├── docker/                 # slim ComfyUI, test-gpu, makestudio-*, lora-train, salad-image
├── scripts/                # lifecycle-worker, host-intelligence-cron, start.sh, switch-env…
├── workflows/              # 5 workflow JSON stock
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
  → provider routing (Admin policy / default Vast) → rent → gate → machines row
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
| `/dashboard/makestudio` | `pages/dashboard/makestudio.tsx` | ⏸️ Sau MVP — scaffold; **chưa** gắn sidebar |

### Auth bổ sung

| Route / API | File | Ghi chú |
|-------------|------|---------|
| Google callback | `pages/api/auth/google-callback.js` | Code exchange + session |
| Sign-out all | `pages/api/auth/signout-all.js` | Invalidate mọi thiết bị |

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
| Ví Nạp Trước | `/dashboard/wallet` | ✅ Số dư + nạp (SePay QR nếu bật) + auto-renew (Combo) + lịch sử 7gd + modal nâng cấp bộ nhớ |
| Cài đặt | `/dashboard/cai-dat` | ✅ Profile, SĐT (Zalo/SMS OTP), mật khẩu, xóa backup |
| MakeStudio | `/dashboard/makestudio` | ⏸️ Sau MVP — scaffold Train/Preview/Final; chưa sidebar |

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
| Registry prod | **Docker Hub** `dieuhaukieuhanh/gpuvietnam-comfyui:v3.7` (Starter/Pro) + `:v4.4` (Studio/5090) |
| Host-intel probe | `dieuhaukieuhanh/gpu-test:v1` — không ComfyUI; health HTTP `:8080` |
| Ghi chú listen | ComfyUI: `COMFYUI_LISTEN` (image default `::`; Vast/Clore set `0.0.0.0`; Salad set `::`). gpu-test: biến `HOST` (default bake `0.0.0.0`) |
| Port | 8080 |

### Boot container (`docker/slim/scripts/start.sh`)

1. `setup-workstation.sh` — copy workflow theo `GPUVIETNAM_WORKSTATION`
2. `download-models.sh` — SDXL Base, RealVisXL V6, Real-ESRGAN 4x (skip nếu `GPUVIETNAM_SKIP_MODEL_DOWNLOAD=1`)
3. `python main.py --listen "${COMFYUI_LISTEN:-::}" --port "${PORT}" --enable-cors-header "*"`

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
| Studio | `rtx5090_1x` | 1× RTX 5090 | Clore + Vast (image `:v4.x`; Clore gate timeout dài hơn) |

**Routing provider (prod 2026-08-09):**

| Ngữ cảnh | Attempt order |
|----------|---------------|
| **SoT** — Admin → Hạ tầng → *Provider routing* | `provider_routing_policy` (default: Vast on, Clore/Salad off → attempt `vast`) |
| `GPU_VAST_ONLY` / `GPU_CLORE_ONLY` / `GPU_SALAD_ONLY` | Break-glass — đè Admin nếu set trên server |
| Clore GPU lines | 3090 / 4090 / **5090** (`CLORE_SUPPORTED_GPU_LINES`) |
| VPS unit | `GPU_ALLOW_VAST=true`; **không** pin `GPU_*_ONLY` |

---

## 9. Luồng nghiệp vụ chính

### Mua gói

```
Checkout → POST /api/payment/confirm (chuyển khoản, pending_payment)
        hoặc POST /api/payment/pay-wallet (trừ ví ngay)
→ Admin approve  hoặc  SePay webhook auto-approve
→ subscriptions.status = active
→ syncUserPlanInventory() → user_plan_inventory
```

### Nạp ví / CK tự động (SePay ✅)

```
WalletDepositForm → POST /api/user/wallet/deposit (pending_deposit + mã NVxxxx)
→ POST /api/payment/sepay-qr → VietQR (des = NVxxxx)
→ KH chuyển khoản đúng số tiền + nội dung NVxxxx
→ POST /api/payment/sepay-webhook (HMAC) → match + approve
→ (dự phòng) cron /api/cron/sepay-reconcile daily Hobby
→ Tick “đã CK” trên UI chỉ đóng form — không cộng ví
```

### Bật máy GPU (P0-A)

```
POST /api/user/start-machine
→ claim subscription / idempotency single-start
→ enqueue machine_operations (user_start_provision) → 200 { operationId }
→ VPS lifecycle-worker: lease + heartbeat + provision
→ provider order: Admin `provider_routing_policy` (default Vast) — trừ khi break-glass GPU_*_ONLY
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

**Mô hình (2026-08-08):** Email-first + Google OAuth; SĐT phụ (Dashboard) để mở khóa khuyến mại; Supabase Auth (identity) + `public.users` (profile).

| Bước | Cơ chế |
|------|--------|
| Đăng ký email | `POST /api/register` → tạo Auth user + upsert `public.users` + email verify Supabase; chặn disposable (~150 domain); rollback nếu upsert fail |
| Đăng ký/đăng nhập Google | OAuth trực tiếp → `/api/auth/google-callback` → session + trigger/profile |
| Xác thực SĐT | Dashboard → OTP Zalo ZNS → fallback Speedsms → `phone_verified=true` |
| Đăng nhập | `POST /api/auth/login` → password grant + sync role |
| Session | JWT Supabase + cookie `gpuvietnam-auth` + `gpuvietnam-token` (middleware verify JWT Web Crypto) |
| Admin | `public.users.role = 'admin'` hoặc email trong `ADMIN_EMAILS` |

### Email (2026-08-08)

| Email | Vai trò |
|---|---|
| `cskh@gpuvietnam.com` | Hiển thị trên website (footer, liên hệ, giới thiệu...) |
| `notify@gpuvietnam.com` | Email transactional: auth (xác nhận, reset password), thông báo thanh toán |
| `admin@gpuvietnam.com` | Admin email (`ADMIN_EMAILS`) |

- **Resend** làm email provider — API key server-side (`RESEND_API_KEY`), không lộ client.
- **Supabase Custom SMTP** qua Resend: `smtp.resend.com:587`, sender `GPUVietnam <notify@gpuvietnam.com>`.
- API route `/api/notify/payment` (server-side) gửi thông báo KH mới cho admin.
- Utility `src/lib/resend.js` — `sendEmail()`, `sendPaymentNotification()`.
- ✅ **Verified 2026-08-08:** Production test gửi email thành công từ `notify@gpuvietnam.com` qua Resend.

**Không dùng** trigger `on_auth_user_created` — profile sync trong API register (`supabase/fix-trigger.sql`).

### Hardening (2026-08-02)

| Lớp bảo vệ | Cơ chế |
|------------|--------|
| **Rate limit** | Register 5/IP/15min · Login 10/IP/15min · OTP send 3/phone/5min + 10/IP/hr + 60s cooldown · OTP verify 5/phone/5min + lock 15 phút |
| **Middleware** | Verify JWT HS256 signature với `SUPABASE_JWT_SECRET` (không chỉ check cookie `gpuvietnam-auth=1`) |
| **Cookie** | `Secure` flag khi HTTPS; token trong `gpuvietnam-token` |
| **Headers** | HSTS · CSP · X-Frame-Options: DENY · X-Content-Type-Options: nosniff |
| **Anti-enumeration** | Login trả về cùng 1 error message |
| **OTP** | Single-use · Brute-force lock · Cooldown resend · TTL 5 phút |
| **Password** | Strength client+server (min 8, uppercase, digit) · Confirm password · TTL 1h auto-generated password · Session invalidation on change |
| **Audit** | `auth_audit_log` — register, login, OTP, password change, signout all |
| **Sign-out all** | `POST /api/auth/signout-all` — `signOut(userId, 'global')` + nút UserMenu |

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

**Tổng: ~115 route files** trong `src/pages/api/`. Chi tiết: grep thư mục hoặc `PROGRESS.md`.

| Nhóm | Ví dụ | Ghi chú |
|------|-------|---------|
| Auth & OTP | `/api/auth/login`, `google-callback`, `signout-all`, `/api/register`, `/api/otp/*` | Email-first + Google + Zalo/SMS |
| User profile/settings | `/api/user/profile`, `settings`, `password`, `change-phone` | |
| Plans & billing | `/api/user/plans`, `active-plans`, `auto-renew` | |
| GPU machines | `/api/user/start-machine`, `stop-machine`, `change-environment` | Enqueue → VPS worker |
| Machines poll | `/api/machines/status`, `destroy`, `recent-outputs` | status = infra-only |
| Payment | `/api/payment/confirm`, `pay-wallet`, `renew`, **`sepay-qr`**, **`sepay-webhook`** | SePay ✅ |
| Wallet | `/api/user/wallet`, `wallet/deposit` | |
| Storage | `/api/storage/*`, backup routes | |
| MakeStudio | `/api/makestudio/jobs`, `[id]`, `upload-images`, `callback`, `train-callback` | ⏸️ sau MVP |
| LoRA train | `/api/lora-train/create`, `[id]`, `[id]/download` | ⏸️ sau MVP — chưa wire provision |
| Support | `/api/support/*`, `/api/admin/support/request` | |
| Admin | pending, customers, hour-grants, pricing, host-intelligence-config… | |
| Cron (Vercel) | `backup-retention` + **`sepay-reconcile`** daily Hobby trong `vercel.json`; `check-idle` / `reconcile` / `process-ops` — handler, không/ít gắn cron Hobby | |
| Cron (VPS) | Host Intelligence timer → `host-intelligence-cron.mjs`; API refresh = manual/Bearer | |
| CP runtime | `/api/cp/*`, `/api/dashboard/jobs` | Architecture v2 path |
| Public | `/api/gpu-pricing` | |

**Stub/disabled:** `POST /api/support/request` — luôn 403 (chỉ admin khởi tạo support).

---

## 13. Docker & scripts

| File | Vai trò |
|------|---------|
| `Dockerfile` / `docker/slim/` | Build image ComfyUI prod (`:v3.7` / `:v4.4`); `start.sh` đọc `COMFYUI_LISTEN` |
| `docker/test-gpu/` | Host Intelligence probe → Hub `dieuhaukieuhanh/gpu-test:v1`; bake `HOST=0.0.0.0` |
| `docker/makestudio-preview/` | Preview 720p 5s — ⏸️ sau MVP |
| `docker/makestudio-final/` | Final 1080p/2K/4K — ⏸️ sau MVP |
| `docker/lora-train/` | Kohya face LoRA → `makestudio-train-face:v1` — ⏸️ sau MVP |
| `docker-compose.yml` | Dev local GPU, port 8080, volumes models/output/workflows |
| `docker/slim/scripts/start.sh` | Entrypoint ComfyUI (listen qua env) |
| `scripts/setup-workstation.sh` | Lọc workflow từ `workflows-stock/` theo env |
| `scripts/download-models.sh` | Tải checkpoint/upscaler |
| `scripts/host-intelligence-cron.mjs` | VPS Host Intelligence (Vast ± Clore theo Admin) |
| `scripts/build/build-makestudio.sh` | Build/push MakeStudio images |
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
SUPABASE_JWT_SECRET=              # Lấy từ Dashboard → Settings → API → JWT Secret (middleware verify token)

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

# Cron
CRON_SECRET=

# Google OAuth
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Zalo ZNS OTP (fallback Speedsms)
ZALO_OA_ACCESS_TOKEN=
ZALO_OTP_TEMPLATE_ID=
SPEEDSMS_ACCESS_TOKEN=

# SePay (CK tự động — ✅ live)
SEPAY_API_TOKEN=
SEPAY_WEBHOOK_SECRET=
SEPAY_ACCOUNT_NUMBER=
SEPAY_BANK_CODE=MBBank

# MakeStudio / RunPod preview (sau MVP)
RUNPOD_SERVERLESS_PREVIEW_URL=
GPUVIETNAM_BACKUP_TOKEN=

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

### File môi trường & chuyển đổi nhanh

Dự án có 2 file cấu hình môi trường riêng biệt (không commit, nằm ngoài git):

| File | Môi trường | Supabase |
|------|-----------|----------|
| `.env.staging` | Staging test | `cczqbuuuyctiqoiruxah` |
| `.env.production` | Production | `rhtqiecieeyqjlctcvag` |

**Switch nhanh qua PowerShell:**
```powershell
.\scripts\switch-env.ps1 staging     # → test
.\scripts\switch-env.ps1 production  # → production
```

**Kiểm tra môi trường hiện tại:**
```powershell
Select-String "SUPABASE_URL" .env.local
# rhtqiecieeyqjlctcvag → Production 🚀
# cczqbuuuyctiqoiruxah → Staging 🧪
```

---

## 15. Gói giá & billing

**SoT giá bán (live):** Admin → Edit giá (`/admin?tab=gpuPricing`) → bảng `gpu_pricing_config`.
Web (trang chủ, checkout, payment, dashboard) đọc qua `/api/gpu-pricing` + `useGpuPricingConfig`.
Seed/fallback khi DB trống: `src/lib/gpu-pricing-defaults.js` (đồng bộ `GPU_PLANS` / `CHECKOUT_PLANS`).

Giá marketing mặc định (tham chiếu seed — **không** sửa giá live tại đây):

| Gói | GPU | Giá/giờ lẻ (VNĐ) | Combo1 (100+10h) | Combo2 (200+30h) |
|-----|-----|------------------|------------------|------------------|
| Starter | RTX 3090 | 15.000 | 1.500.000 | 3.000.000 |
| Pro | RTX 4090 | 20.000 | 2.000.000 | 4.000.000 |
| Studio | RTX 5090 | 35.000 | 3.500.000 | 7.000.000 |

- **Trial:** 3 giờ Starter — chống lạm dụng IP
- **Ví:** nạp trước (SePay QR/webhook auto hoặc Admin duyệt); mã CK `NVxxxx`; **không** còn bonus % nạp ví
- **Storage theo gói GPU:** SSD Starter 30 / Pro 50 / Studio 100 GB · Backup 50 / 100 / 200 GB
- **Thanh toán:** chuyển khoản (SePay auto hoặc Admin) hoặc trừ ví ngay
- **Tái tục:** wallet hoặc chuyển khoản (`plan_renew_requests`) + SePay auto

---

## 16. Đã làm vs chưa làm

### ✅ Đã triển khai

- Marketing, auth email-first + Google OAuth + Zalo/SMS OTP, hardening P0–P2
- Checkout, payment pending/approve, ví, kho gói, tái tục, auto-renew, trial
- **SePay CK tự động** (QR + webhook + mã `NVxxxx` + ops prod + test nạp ví thật)
- Dashboard tab đầy đủ (trừ GPU run trên workflow/model; MakeStudio park sau MVP)
- GPUService + **Vast + Clore + Salad** adapters; Host Intelligence (Vast on, Clore opt-in)
- **CP/Runtime v2.0** freeze + Continuity A→B evidence
- **P0-A** durable start + VPS worker — Phase F.2 smoke 7/7 PASS
- **P0-B** billing T11 PASS · **P0-C** alerts email · **Provider routing Admin** (Hạ tầng SoT, prod 2026-08-09)
- Session continuity (backup → destroy → start → restore); transparent Comfy reconnect
- Billing phiên, auto-stop theo gói đang dùng, cảnh báo 30 phút
- Storage R2 + entitlement theo gói GPU; Admin panels (duyệt, KH, giá, hạ tầng, host-intel, provider routing)
- Image prod `:v3.7` / `:v4.4` + Filmmaker mode; gpu-test `:v1`
- **SCB 4.0** + Dashboard optimistic UX

### ⏳ Đang / chờ (ưu tiên)

- **Go-Live:** **P0-D** E2E khách thật
- **Staging RC6:** Scenario 1 lại trên Vast → 2–5 → VERIFIED → promote
- Host-intel debt: passRate-on-fail; mở Clore qua Admin *Provider routing* khi sẵn sàng

### ❌ Chưa / sau MVP

- **MakeStudio** + LoRA train (scaffold giữ — không làm trước Go-Live)
- Dual Run product / warm pool
- Dashboard “Chạy workflow” E2E trên CP Job path
- Jupyter, Blender, WebRTC remote support thật

---

## 17. Thay đổi gần đây

| Hạng mục | Chi tiết |
|----------|----------|
| **MakeStudio scaffold (2026-08)** | UI/API/SQL/Docker scaffold. **Park sau MVP** — không ưu tiên trước Go-Live. |
| **SePay CK tự động (2026-08 chốt)** | `sepay.js` + `transfer-code.js` + QR + webhook HMAC + SQL `0054`; mã `NVxxxx`; match wallet/gói/renew; cron daily Hobby; ops + test nạp ví thật OK. Runbook `SEPAY_SETUP.md`. |
| **Auth Email-first + Google + Zalo (2026-08-08)** | Email chính; Google OAuth trực tiếp; Zalo ZNS OTP + Speedsms fallback; disposable email blocklist. |
| **Host Intelligence — vá + Clore (2026-08-08)** | Persist merge-by-key; fair deficit slots; available = known-good ∩ chợ; Admin card Vast + Clore. Clore cycle **đã wire**, default `clore: false`. Debt: passRate-on-fail. |
| **gpu-test HOST IPv4 (2026-08-08)** | Bake `HOST=0.0.0.0`; Hub digest `sha256:fd74e09b…`. ComfyUI vẫn `COMFYUI_LISTEN`. |
| **Provider routing Admin (2026-08-09 prod)** | Hạ tầng SoT enable + priority; `0056`; Vercel Ready; VPS bỏ `GPU_VAST_ONLY` pin. |
| **Salad adapter (2026-08-05)** | SaladClient + gate; bật qua Admin policy (default off). |
| **Auth Hardening P0+P1+P2 (2026-08-02)** | Rate limit, JWT middleware, headers, OTP lock, password strength, audit log, sign-out all |
| **P0-A Vast-only (2026-08-01)** | Smoke Phase F.2 7/7 với `GPU_VAST_ONLY` — sau đó thay bằng Admin policy (2026-08-09) |
| **CP/Runtime v2.0 + SCB 4.0** | ADR-005 + Continuity; tag `scb-4.0` ADR-001..004 closed |
| **Image prod** | `:v3.7` + `:v4.4` dual-stack; Filmmaker mode |

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

1. VPS lifecycle worker `active` + `GPU_ALLOW_VAST=true` (không pin `GPU_*_ONLY` trừ break-glass)
2. Admin Hạ tầng *Provider routing* load/save OK; worker resolve order từ Supabase
3. Host-intel timer `gpuvietnam-host-intel.timer` active; image `gpu-test:v1` (`HOST=0.0.0.0`)
4. Migrations 0049 + **0056** (`provider_routing_policy`) applied
5. Start một lần từ `gpuvietnam.com` → `operationId` → Comfy → Stop sạch
6. (Tuỳ chọn) `systemctl restart` worker giữa provision — op không mất

**Chat mới — copy nhanh:**

```
Tiếp tục GPUVietnam. Đọc docs/PROJECT_CONTEXT.md + docs/PROGRESS.md + docs/operations/LIFECYCLE_WORKER.md.
SCB 4.0 + ADR-005 freeze. Go-Live: P0-A..C ✅ → Provider routing Admin ✅ → P0-D E2E.
Start SoT = Admin Hạ tầng provider_routing_policy (default Vast). Host Intel Vast on / Clore opt-in. Image :v3.7/:v4.4.
Ưu tiên: P0-D + Staging RC6. SePay ✅. MakeStudio/LoRA ⏸️ sau MVP. Không Dual Run/warm pool.
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

## 20. Môi trường Staging & Development

### Staging Environment

Staging là môi trường test **độc lập hoàn toàn** với Production, được tạo ra tháng 7/2026 để verify bản vá RC6 (SES-1 Adapter Count):

| Thành phần | Production | Staging |
|------------|-----------|---------|
| **Vercel** | `gpuvietnam/gpuvietnam` → `gpuvietnam.com` | `gpuvietnam-staging` → `gpuvietnam-staging.vercel.app` |
| **Supabase** | `rhtqiecieeyqjlctcvag` | `cczqbuuuyctiqoiruxah` |
| **Lifecycle Worker** | `gpuvietnam-lifecycle-worker` | `gpuvietnam-lifecycle-worker-staging` |
| **GPU Routing** | Admin `provider_routing_policy` (default Vast) | Theo env staging (thường Vast) |
| **Cron** | 4 jobs (check-idle, reconcile, process-ops, backup-retention) | `crons: []` (Hobby-safe) |

**Mục đích:** Test code mới an toàn trước khi deploy Production. Đặc biệt quan trọng với các thay đổi trong Core Domain (session, billing, provision, destroy, settlement).

**Quy tắc quyết định khi nào cần test qua staging:**

| Mức độ | Phạm vi thay đổi | Ví dụ |
|--------|-----------------|-------|
| 🔴 **Bắt buộc** | Core Domain: session-lifecycle, billing, provision, destroy, payment, auth, provider adapter, DB migration | Sửa `session-start.js`, thêm provider mới, đổi billing logic |
| 🟡 **Cân nhắc** | Dashboard logic, admin panel, backup flow | Thay đổi cách tính giờ hiển thị, sửa query KH |
| 🟢 **Không cần** | CSS/copy, static pages, UI component đơn lẻ | Sửa màu, đổi chữ, thêm FAQ |

**Trạng thái hiện tại (2026-08-05):**
- 4-layer precondition gate: **PASS** (Code, Deployment, Database, Execution Infrastructure)
- Vast readiness: **PASS_HTTP_READY**
- Scenario 1 (Clean Start): **FAIL** — lỗi Clore Proxy Not Found, **không phải lỗi RC6**
- Scenarios 2-5: **BLOCKED** (stop-on-fail)

**Docs liên quan:**
- [`docs/investigations/2026-07-25-rc6-staging-environment-plan.md`](investigations/2026-07-25-rc6-staging-environment-plan.md) — Kế hoạch thiết lập
- [`docs/verification/2026-07-25-rc6-staging-verification.md`](verification/2026-07-25-rc6-staging-verification.md) — Giao thức verify 5 scenario
- [`docs/investigations/2026-07-26-staging-vast-readiness.md`](investigations/2026-07-26-staging-vast-readiness.md) — Probe Vast readiness

### LoRA Training (⏸️ sau MVP)

| Thành phần | Trạng thái | Ghi chú |
|------------|------------|---------|
| `src/lib/lora-train/job-manager.js` | ✅ | |
| `src/lib/lora-train/provision-train.js` | ✅ | Vast `rtx4090_1x` |
| `supabase/lora-train-jobs.sql` | ✅ schema | **Chưa** entry `MIGRATION_MANIFEST.json` |
| `docker/lora-train/` | ✅ | Tag dùng chung MakeStudio `makestudio-train-face:v1` |
| `src/lib/supabase-route-client.js` | ✅ tracked | `createRouteClient(req)` |
| `src/pages/api/lora-train/*` | 🟡 | Auth call signature lệch; `create.js` **chưa** gọi `startLoraTraining` |

**UI chính:** MakeStudio tab Train (+ `train-callback` có fallback bảng `lora_train_jobs`).

### MakeStudio (WIP)

| Thành phần | Trạng thái |
|------------|------------|
| UI + hook + page `/dashboard/makestudio` | ✅ scaffold — chưa sidebar |
| API jobs / upload / callback / train-callback | ✅ scaffold — bug snake↔camel create |
| SQL `makestudio_jobs` (`0053`) | ✅ trong manifest |
| Docker preview / final / train | ✅ scaffold |
| Billing / quota / E2E prod | ❌ |

### SePay (CK tự động — ✅ chốt 2026-08-08)

| Thành phần | Trạng thái |
|------------|------------|
| `sepay.js` + `transfer-code.js` + unit tests | ✅ |
| QR (`qr.sepay.vn`) + webhook + SQL `0054` | ✅ |
| Mã CK `NVxxxx` (unique pending); nội dung CK = chỉ mã | ✅ |
| Match nạp ví / mua gói / tái tục | ✅ |
| Cron `sepay-reconcile` daily Hobby trong `vercel.json` | ✅ |
| UI “tự động duyệt”; tick “đã CK” không cộng tiền | ✅ |
| Ops prod (env + HMAC + cấu trúc mã SePay `NV`+4) + test nạp ví thật | ✅ |

**Env:** `SEPAY_WEBHOOK_SECRET`, `SEPAY_API_TOKEN`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_BANK_CODE=MBBank`, `CRON_SECRET`.  
**Webhook:** `https://gpuvietnam.com/api/payment/sepay-webhook`. Runbook: [`SEPAY_SETUP.md`](operations/SEPAY_SETUP.md). Admin duyệt tay = dự phòng.

---

## 21. Roadmap — đang ở đâu, còn làm gì

> Viết bằng tiếng Việt dễ hiểu. Chi tiết kỹ thuật / ngày tháng: [`PROGRESS.md`](PROGRESS.md).

Nền tảng thuê GPU làm AI Art đã **chạy được phần lõi**: khách đăng ký, nạp tiền, bật máy, vào ComfyUI làm việc, tắt máy tính giờ. Việc còn lại chủ yếu là **chốt vận hành trước khi mở rộng khách**, và **hoàn thiện vài tính năng mới đang làm dở**.

### 1. Đưa sản phẩm ra dùng thật (ưu tiên cao nhất)

**Đã xong**
- Bật máy ổn định qua máy chủ luôn chạy (không phụ thuộc Vercel “chạy một phát rồi tắt”)
- Đang dùng chủ yếu nguồn GPU Vast
- Backup / khôi phục workspace khi đổi máy
- Hết giờ gói đang dùng thì tự tắt; cảnh báo trước ~30 phút
- Đổi máy GPU mà tab làm việc không cần F5

**Còn phải làm**
- **P0-B T11:** chạy full proof GPU (`scripts/p0b-t11-billing-proof.mjs`) — harness + unit gate đã có; runbook [`P0B_T11_BILLING_PROOF.md`](operations/P0B_T11_BILLING_PROOF.md)
- Cảnh báo khi hệ thống lỗi (ops) — P0-C
- Chạy thử trọn vẹn như khách thật — P0-D

**Chưa làm ngay:** chạy song song 2 GPU (Dual Run), giữ sẵn máy ấm (warm pool).

### 2. Môi trường thử (Staging) trước khi đẩy Production

**Đã xong**
- Có môi trường thử tách khỏi production
- Công cụ chuyển nhanh staging ↔ production

**Còn phải làm**
- Chạy lại bộ kịch bản kiểm thử (Scenario 1→5) trên Vast
- Pass hết rồi mới đưa bản vá lên production

### 3. Thanh toán chuyển khoản tự động (SePay) — ✅ chốt

**Đã xong**
- QR VietQR + webhook nhận tiền → tự duyệt (nạp ví / mua gói / tái tục)
- Mã CK `NVxxxx` (6 ký tự) — mỗi yêu cầu pending một mã; nội dung CK chỉ là mã
- Cron đối soát daily (Hobby); UI “tự động duyệt”
- Env + webhook HMAC + cấu trúc mã SePay trên dashboard đã cấu hình
- Test nạp ví thật trên production OK
- Tick “đã chuyển khoản” chỉ đóng UI — không cộng ví / không kích hoạt gói
- Admin duyệt thủ công vẫn giữ làm dự phòng

**Còn lại (tuỳ chọn sau):** auto-match nâng cấp storage nếu cần.

### 4. Chọn máy GPU tốt (Host Intelligence)

**Đã xong**
- Hệ thống tự thử máy Vast định kỳ, ghi máy tốt / máy xấu
- Có bảng Admin theo dõi
- Phần Clore đã viết xong nhưng **mặc định tắt** (bật khi Admin muốn)

**Còn phải làm**
- Sửa chỗ thống kê tỷ lệ pass khi máy fail còn thiếu
- Quyết định có bật thử Clore hay không
- Lọc chặt hơn máy Vast chỉ có ổ cứng (disk-only) dễ lỗi

### 5. MakeStudio + train LoRA — ⏸️ sau MVP

**Đã có (scaffold, park)**
- Trang Train → Preview → Final, API, Docker, SQL — giữ trong repo

**Không làm trước MVP / Go-Live**
- Fix create job, gắn menu, E2E, billing/quota, wire LoRA train
- Mở lại sau khi P0-B..D + Staging ổn

### 6. Đăng ký / đăng nhập

**Đã xong**
- Đăng ký bằng email (chính)
- Đăng nhập Google
- Thêm SĐT sau trong Dashboard (Zalo trước, SMS dự phòng)
- Chặn email rác, giới hạn spam, audit đăng nhập

**Còn phải làm**
- Theo dõi abuse trên production
- Gắn khuyến mại với SĐT đã xác thực cho ổn định

### 7. Kiến trúc “đổi máy không mất bài” (dài hạn)

**Đã xong**
- Đã chốt thiết kế; đã chứng minh được một phần continuity

**Còn phải làm**
- Hoàn bộ kiểm thử continuity
- Editor chạy được khi chưa có GPU (giai đoạn sau)
- Chạy song song 2 GPU (Dual Run) — **chưa làm**, chờ quyết định

### 8. Dashboard còn chỗ “làm đẹp / làm thật”

**Đã xong**
- Có tab Model, Workflow, Bộ nhớ, Ví, Lịch sử…

**Còn phải làm**
- Nút “Chạy workflow” / “Dùng ngay” gắn ComfyUI thật
- Hỗ trợ từ xa xem màn hình thật (WebRTC)
- Tab Admin tổng quan / doanh thu (hiện còn placeholder)

### Thứ tự nên làm (thực tế)

1. ~~P0-A..C + Provider routing Admin~~ ✅ → **P0-D** E2E khách thật
2. Staging RC6 — Scenario 1 trên Vast → 2–5 → VERIFIED
3. ~~SePay~~ ✅ chốt
4. ~~MakeStudio / LoRA~~ ⏸️ sau MVP
5. Host Intelligence tinh chỉnh + Dashboard stub

---

*Tài liệu cập nhật: 2026-08-09 — Provider routing Admin prod; P0-A..C ✅; P0-D tiếp theo. Chi tiết: `docs/PROGRESS.md`.*
