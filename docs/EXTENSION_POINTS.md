# GPUVietnam — Extension Points

> Mô tả các điểm mở rộng kiến trúc của GPUVietnam trong tương lai.  
> Tài liệu chỉ mô tả **kiến trúc**, không mô tả implementation hay đề xuất refactor.

**Ngày:** 2026-06-28  
**Liên quan:** [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) · [TARGET_ARCHITECTURE_DRAFT.md](./TARGET_ARCHITECTURE_DRAFT.md) · [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md)

---

## Table of Contents

1. [GPU Provider](#gpu-provider)
2. [Payment Provider](#payment-provider)
3. [Order](#order)
4. [Workspace Registry](#workspace-registry)
5. [Feature Registry](#feature-registry)
6. [Storage Provider](#storage-provider)
7. [Notification Provider](#notification-provider)
8. [Authentication Provider](#authentication-provider)
9. [AI Assistant](#ai-assistant)
10. [Backup Provider](#backup-provider)
11. [Billing Strategy](#billing-strategy)
12. [Monitoring / Observability](#monitoring--observability)
13. [Admin Capability](#admin-capability)
14. [Integration](#integration)
15. [Extension Readiness Matrix](#extension-readiness-matrix)
16. [Overall Assessment](#overall-assessment)
17. [Design Rules](#design-rules)

---

## GPU Provider

### Purpose

Cung cấp tài nguyên GPU tạm thời (rent instance, health check, destroy) cho phiên làm việc. Là lớp hạ tầng compute, tách biệt khỏi billing, subscription, workspace và backup.

### Current Design

Một abstraction GPU Provider bọc bởi GPU Service. Production chỉ có một provider active (Vast.ai). Domain core (start/stop phiên, billing, auto-stop) giao tiếp qua contract chung: provision instance, poll status, destroy instance, health/queue qua endpoint runtime (ComfyUI).

Luồng chọn GPU: map gói → GPU line → tìm offer theo region/fallback → rent container image cố định.

### Future Expansion

- Provider dự phòng (failover thủ công hoặc theo feature flag).
- Provider theo feature (ví dụ video cần VRAM cao hơn, chọn pool khác).
- Provider theo region/market (VN-first latency vs global pool).
- Multi-step provisioning (queue khi hết GPU) mà vẫn một phiên active/user.

### Current Providers

| Provider | Vai trò |
|---|---|
| **Vast.ai** | Provider duy nhất production — rent GPU, SSH host, ComfyUI endpoint |

### Possible Future Providers

| Provider | Ghi chú kiến trúc |
|---|---|
| **Akash** | Decentralized GPU; cần adapter riêng lifecycle/SSH |
| **Salad** | Consumer GPU pool; khác SLA uptime |
| **GPUMart** | Marketplace GPU châu Á |
| **TensorDock** | Bare-metal / VM style |
| **Aethir** | Decentralized compute network |
| **RunPod, Lambda, CoreWeave** | Các marketplace tương tự Vast |

### Breaking Risk

**Medium** — thay provider có thể khác SSH, image, port, API status; không nên ảnh hưởng billing/subscription nếu giữ contract.

### Priority

**500 users** (provider thứ hai / DR) · **2000 users** (multi-provider theo feature nếu cần)

### Architecture Principles liên quan

6, 7, 13, 29, 30, 31, 32

---

## Payment Provider

### Purpose

Xử lý **thanh toán** cho Order (mua gói, nạp ví, storage, renew). Gateway là kênh; Domain Payment quyết định trạng thái thanh toán độc lập gateway.

### Current Design

Đa kênh không gateway bắt buộc:

- **Manual Transfer** — tạo pending, admin duyệt → kích hoạt subscription / credit ví.
- **Wallet** — trừ số dư nội bộ, kích hoạt ngay.
- Các luồng phân tán: subscription pending, plan renew request, storage upgrade, wallet deposit — chưa có entity Order thống nhất (nguyên tắc Order-first là hướng tương lai).

Payment không ràng buộc subscription logic; admin là first-class path.

### Future Expansion

- Payment Gateway adapter (PayOS, Stripe, VietQR) chỉ cho **nạp ví** hoặc **xác nhận Order**.
- Webhook callback idempotent → cập nhật Order/Payment state.
- Đối soát tự động transfer_note (bổ sung, không thay admin sớm).
- Multi-currency (USD) qua gateway; VND vẫn ưu tiên manual.

### Current Providers

| Provider | Vai trò |
|---|---|
| **Manual Transfer** | Chuyển khoản + admin approve/reject |
| **Wallet (internal)** | Số dư `wallet_balance`, instant debit |

### Possible Future Providers

| Provider | Ghi chú |
|---|---|
| **PayOS** | VietQR, phù hợp VN |
| **Stripe** | Thẻ quốc tế |
| **VietQR / ngân hàng API** | Đối soát CK |
| **MoMo, ZaloPay** | Ví điện tử VN |
| **Crypto** | Tùy chọn muộn, rủi ro vận hành cao |

### Breaking Risk

**Low–Medium** — thêm gateway là additive; rủi ro Medium nếu gộp logic gateway vào subscription thay vì Payment Domain.

### Priority

**Now** — củng cố wallet + manual (idempotency) · **2000 users** — gateway nạp ví (tùy volume)

### Architecture Principles liên quan

9, 10, 11, 27, 28, 29, 30, 32

---

## Order

### Purpose

Order là điểm khởi đầu của mọi giao dịch có giá trị trong hệ thống.

### Current Design

Hiện tại Order chủ yếu phục vụ mua gói GPU và kích hoạt Subscription.

### Future Expansion

Order có thể mở rộng để hỗ trợ:

- Wallet Top-up
- Storage
- Backup
- API Credits
- Workflow Marketplace
- Plugin Marketplace
- Enterprise Services

### Current Providers

- GPU Subscription

### Possible Future Providers

- Wallet
- Storage
- Backup
- API Credit
- Marketplace

### Breaking Risk

**Low**

### Priority

**Now**

### Related Principles

Ưu tiên liên kết Principle 27 (Order-first) và các Principle liên quan.

---

## Workspace Registry

### Purpose

Đăng ký **cách triển khai kỹ thuật** của Feature trên GPU: loại runtime (ComfyUI, Jupyter, …), slug, workflow bundle, container env. Workspace **không** phải đơn vị kinh doanh (Principle 26).

### Current Design

Catalog **tĩnh** (6 mục marketing/UI). Chỉ 3 workspace ComfyUI được backend hỗ trợ provision. Mô hình **restart-only**:

- Subscription lưu lựa chọn cho phiên **tiếp theo**.
- Machine lưu workspace đã áp dụng khi phiên **đang/đã** chạy.
- Đổi workspace khi máy online → chỉ cập nhật lựa chọn; user phải stop + start.

Một phiên chỉ một workspace (Principle 1).

### Future Expansion

- Registry có thể cấu hình (DB/admin) thay catalog cứng — vẫn restart-only.
- Workspace mới = Feature mới + Docker image + env vars + workflow pack.
- AI Video / AI Audio / AI 3D / LLM / Agent — mỗi loại một template boot, không hot-swap.
- Workspace “custom” (id 6 hiện tại) — quy trình riêng, không auto-provision.

### Current Providers

| Workspace (triển khai) | Feature gần đúng |
|---|---|
| ComfyUI — Character & Art | AI Image |
| ComfyUI — Commerce & Product | AI Image / Product |
| ComfyUI — Video AI | AI Video (hạn chế) |
| Jupyter — ML/DL | Training / LLM (UI only, chưa provision) |
| Blender — Render | AI 3D (UI only) |
| Custom (Zalo) | Tùy chỉnh |

### Possible Future Providers

| Workspace type | Feature map |
|---|---|
| **AI Image** | ComfyUI variants |
| **AI Video** | ComfyUI + video nodes / dedicated image |
| **AI Audio** | Audio pipeline container |
| **AI 3D** | Blender / 3D render stack |
| **LLM** | Inference server (vLLM, Ollama) |
| **Agent** | Agent runtime + tool hooks |

### Breaking Risk

**Low** — thêm workspace mới nếu tuân restart-only và một workspace/phiên.

### Priority

**100 users** — mở rộng ComfyUI catalog · **500 users** — registry cấu hình · **2000 users** — LLM/Agent workspace

### Architecture Principles liên quan

1, 2, 26, 30, 31

---

## Feature Registry

### Purpose

Đăng ký **đơn vị kinh doanh** — sản phẩm/dịch vụ GPUVietnam bán cho khách (Image Generation, Video, API access, …). Feature map tới workspace, pricing, quota, và Order line item.

### Current Design

Feature chưa có registry riêng; implicit qua:

- Gói GPU (Starter / Pro / Studio) + billing mode (hourly, combo).
- Workstation UI như proxy marketing feature.
- Trial, hour grants, plan inventory như biến thể quota.

Workspace là implementation layer; plan là proxy feature gần nhất hiện tại.

### Future Expansion

- Feature catalog: id, tên, pricing rules, allowed workspaces, GPU line.
- Feature → Order → Subscription/Inventory (Principle 27).
- Cross-sell: API credits, Prompt Library premium, Workflow marketplace.
- Feature flags theo gói / trial.

### Current Providers

| Feature (implicit) | Nguồn |
|---|---|
| **GPU Session (ComfyUI)** | Subscription + workspace |
| **Trial** | Trial activation |
| **Hour grants** | Admin manual grant |
| **Storage upgrade** | Storage module |
| **Renew** | Plan renew flow |

### Possible Future Providers

| Feature | Mô tả |
|---|---|
| **Image Generation** | Session ComfyUI |
| **Video Generation** | Session + VRAM policy |
| **Training** | Long-run / different billing note |
| **API** | Metered API key, không session GPU cổ điển |
| **Prompt Library** | Content/catalog, có thể không cần GPU session |
| **Workflow Marketplace** | Digital goods + optional run |

### Breaking Risk

**Medium** — giới thiệu Feature registry + Order thống nhất đòi hỏi map legacy subscription; không bắt buộc đổi machine/billing core nếu làm additive.

### Priority

**500 users** — feature catalog rõ · **2000 users** — API / marketplace features

### Architecture Principles liên quan

26, 27, 10, 19, 20

---

## Storage Provider

### Purpose

Lưu trữ object bền vững: backup archives, user artifacts metadata, có thể mở rộng SSD catalog. Tách khỏi ephemeral GPU instance.

### Current Design

- **Cloudflare R2** (S3-compatible) cho backup archives trước destroy.
- Metadata file SSD/backup trong database (`storage_files`, quota trên user).
- Upload/download qua abstraction S3 client.

GPU instance disk là tạm; durable storage qua provider bên ngoài.

### Future Expansion

- Multi-bucket (backup vs user-upload vs CDN assets).
- Lifecycle policy (retention theo gói).
- Provider failover (sync bucket).
- Per-user prefix isolation.

### Current Providers

| Provider | Vai trò |
|---|---|
| **Cloudflare R2** | Backup archives (production) |
| **Supabase PostgreSQL** | Metadata, không blob lớn |

### Possible Future Providers

| Provider | Ghi chú |
|---|---|
| **AWS S3** | Chuẩn industry |
| **Backblaze B2** | Chi phí thấp |
| **MinIO** | Self-hosted |
| **Wasabi, GCS** | Alternative S3 API |
| **Supabase Storage** | Gộp stack nếu đủ quota |

### Breaking Risk

**Low** — S3-compatible adapter; đổi provider chỉ ảnh hưởng lớp storage integration.

### Priority

**100 users** — lifecycle policy · **2000 users** — multi-region / failover

### Architecture Principles liên quan

12, 22, 30, 31, 32

---

## Notification Provider

### Purpose

Phân phối sự kiện tới user và operator: payment, idle warning, backup, billing low hours. Cross-cutting — không phải lõi nghiệp vụ (Principle 21).

### Current Design

- **In-app** — bảng notifications, bell UI.
- **SMS (SpeedSMS)** — OTP đăng ký/xác thực; chưa rõ broadcast marketing.
- User notification settings (Zalo/email flags) — delivery external **Partial**.
- Event helpers gắn domain (payment success, idle, auto-stop, backup).

### Future Expansion

- Notification outbox + worker; template per event type.
- Multi-channel fan-out (in-app + email + Zalo + Telegram).
- Operator alerts (admin) tách user alerts.
- Digest / rate limit cho 1 operator.

### Current Providers

| Provider | Vai trò |
|---|---|
| **In-app** | Primary user notifications |
| **SMS (SpeedSMS)** | OTP |

### Possible Future Providers

| Provider | Kênh |
|---|---|
| **Email (SMTP / Resend / SendGrid)** | Transactional |
| **Zalo OA** | VN user base |
| **Telegram Bot** | Dev/power users |
| **Firebase / OneSignal** | Push mobile (nếu có app) |
| **Webhook** | Integration partner |

### Breaking Risk

**Low** — thêm provider qua adapter; core không phụ thuộc delivery thành công.

### Priority

**500 users** — outbox + email/Zalo · **2000 users** — operator alerting

### Architecture Principles liên quan

21, 30, 15, 24

---

## Authentication Provider

### Purpose

Xác thực danh tính user và admin. Tách khỏi subscription/payment.

### Current Design

- **Supabase Auth** — email/password, JWT Bearer cho API.
- **OTP SMS** — xác minh phone qua SpeedSMS + bảng OTP.
- Dashboard UI guard qua cookie flag (yếu hơn JWT — cần củng cố theo target draft).
- Admin: JWT + role `admin` hoặc shared secret header.

### Future Expansion

- Social login (Google, GitHub, Microsoft) qua Supabase OAuth providers.
- MFA TOTP.
- Session binding server-side cho dashboard.
- SSO enterprise (muộn, 2000+ users B2B).

### Current Providers

| Provider | Vai trò |
|---|---|
| **Supabase Auth (email/password)** | Primary login |
| **OTP (SMS)** | Phone verification |

### Possible Future Providers

| Provider | Ghi chú |
|---|---|
| **Google OAuth** | Supabase built-in |
| **GitHub OAuth** | Dev audience |
| **Microsoft / Azure AD** | Enterprise |
| **Apple Sign-In** | Mobile web |
| **Magic link email** | Passwordless |

### Breaking Risk

**Low–Medium** — OAuth additive; Medium nếu đổi identity provider khỏi Supabase (Principle 32).

### Priority

**100 users** — session middleware · **500 users** — Google OAuth · **2000 users** — SSO (nếu B2B)

### Architecture Principles liên quan

15, 30, 32, 20

---

## AI Assistant

### Purpose

Hỗ trợ user self-serve: FAQ, hướng dẫn sản phẩm, gợi ý prompt/workflow, giải thích billing — **read-only**, không điều khiển GPU/payment trực tiếp.

### Current Design

**Không có** module AI Assistant trong kiến trúc hiện tại. Support remote session (WebRTC) là placeholder; không phải conversational AI.

### Future Expansion

- FAQ bot (static docs + search).
- Prompt Helper / Workflow Helper (gợi ý dựa catalog).
- Billing Helper (giải thích giờ còn lại, vì sao máy tắt).
- Admin copilot (read-only customer lookup) — cẩn trọng Principle 15 (1 operator).
- Guardrails: không start/stop machine, không approve payment.

### Current Providers

| Provider | Vai trò |
|---|---|
| *(none)* | Chưa triển khai |

### Possible Future Providers

| Capability | Mô tả |
|---|---|
| **FAQ** | Docs + keyword |
| **Documentation** | Link ARCHITECTURE / user guides |
| **Prompt Helper** | Template gợi ý the Feature |
| **Workflow Helper** | Gợi ý workflow theo Workspace |
| **Billing Helper** | Explain quota, idle policy |
| **LLM backend** | OpenAI / Claude / local — qua adapter |

### Breaking Risk

**Low** — additive surface; rủi ro Medium nếu bot được quyền write ops.

### Priority

**2000 users** hoặc khi support ticket > ngưỡng vận hành · **Not Planned** cho core MVP

### Architecture Principles liên quan

15, 20, 21, 26, 29 (idempotent nếu có tool calls)

---

## Backup Provider

### Purpose

Sao lưu dữ liệu user trên instance trước khi destroy phiên. Độc lập billing và payment (Principle 12).

### Current Design

Luồng unified destroy:

1. Backup (nếu running + có reason) — SSH vào host, tar folders, upload object storage.
2. Billing stop → session finalize → GPU destroy.

Backup log lưu metadata (archives JSON, size, reason). Restore là luồng riêng user-facing.

Backup failure không chặn destroy theo policy sản phẩm (có notify).

### Future Expansion

- Backup adapter abstraction (SSH+tar vs snapshot API vs agent daemon).
- Incremental backup (muộn).
- Retry queue + timeout policy.
- Backup provider tách bucket/provider khác storage catalog.

### Current Providers

| Provider | Vai trò |
|---|---|
| **SSH + tar (Vast host)** | Capture folders on instance |
| **Cloudflare R2** | Durable archive destination |

### Possible Future Providers

| Provider | Ghi chú |
|---|---|
| **Provider snapshot API** | Nếu GPU vendor hỗ trợ volume snapshot |
| **Restic / Borg** | Incremental qua SSH |
| **In-instance agent** | Sidecar upload trực tiếp S3 |
| **Cross-region replica** | DR |

### Breaking Risk

**Medium** — provider GPU khác có thể không có SSH giống Vast; cần adapter per GPU Provider.

### Priority

**100 users** — retry policy · **500 users** — backup adapter interface rõ · **2000 users** — lifecycle/retention

### Architecture Principles liên quan

12, 13, 22, 30, 31

---

## Billing Strategy

### Purpose

Quy tắc trừ quota/tính phí trong khi phiên GPU active. Gắn thời gian sử dụng thực (Principle 8), tách payment (Principle 9).

### Current Design

- **Per-minute deduction** khi machine running + billing started.
- Nguồn quota: subscription hours, plan inventory, hourly wallet, trial, manual grants.
- Session record (`gpu_sessions`) + machine billing fields.
- Tick từ status poll và cron idle (dual path hiện tại).
- Auto-stop khi hết credit hoặc idle timeout.

Không có billing strategy plug-in; logic tập trung một module.

### Future Expansion

- Billing ledger append-only (audit).
- Cron làm primary tick (giảm phụ thuộc client poll).
- Strategy variants **trong cùng triết lý phút**: cap daily, burst allowance — vẫn không đổi Principle 8 nếu không thêm model mới.
- API metering (Feature API) — strategy riêng cho non-session feature.

### Current Providers

| Strategy | Mô tả |
|---|---|
| **Per-minute session billing** | Duy nhất production |
| **Wallet drain (hourly plan)** | Kết hợp khi plan hourly |

### Possible Future Providers

| Strategy | Ghi chú |
|---|---|
| **Per-minute (default)** | Giữ làm canonical |
| **Prepaid block** | Đã có qua combo hours |
| **API token metering** | Feature API tương lai |
| **Flat session minimum** | Policy product, cần Principle exception |

### Breaking Risk

**High** nếu đổi từ per-minute sang model khác — vi phạm Principle 8. **Low** nếu thêm ledger/audit giữ nguyên deduction.

### Priority

**Now** — idempotency tick · **500 users** — ledger + cron primary · **2000 users** — API metering (feature riêng)

### Architecture Principles liên quan

8, 9, 14, 29, 3, 4

---

## Monitoring / Observability

### Purpose

Giúp **một operator** quan sát hệ thống: ai đang chạy, lỗi provision, billing anomaly, backup fail (Principle 24).

### Current Design

- Console logging rải rác (một số debug trong status path).
- Admin panels: customers, pending requests, infrastructure, machine toggle.
- Cron check-idle trả JSON kết quả.
- Không có APM/metrics stack chuẩn; không centralized trace.

### Future Expansion

- Structured logs (event, userId, machineId).
- Error tracking (Sentry).
- Metrics: active machines, provision latency, billing tick lag.
- Admin audit timeline (ai duyệt gì).
- Alerting nhẹ (email/Telegram cho operator only).

### Current Providers

| Provider | Vai trò |
|---|---|
| **Vercel logs** | Hosting logs |
| **Console** | Ad-hoc debug |
| **Admin UI** | Operational visibility |

### Possible Future Providers

| Provider | Ghi chú |
|---|---|
| **Sentry** | Error tracking |
| **Axiom / Logtail / Datadog** | Log aggregation |
| **Grafana Cloud / Uptime** | Metrics & uptime |
| **Supabase dashboard** | DB metrics |
| **Custom admin audit table** | Internal |

### Breaking Risk

**Low** — additive instrumentation.

### Priority

**100 users** — structured logs · **500 users** — Sentry + admin audit · **2000 users** — metrics/alerting

### Architecture Principles liên quan

15, 24, 18, 16

---

## Admin Capability

### Purpose

Khả năng vận hành của **một operator**: duyệt thanh toán, grant giờ, toggle máy, pricing, support, customer lookup.

### Current Design

- Admin role binary (`admin` vs `user`).
- Pending queue aggregate: subscriptions, wallet deposits, renew, storage.
- Actions: approve/reject, hour grants, machine toggle/destroy, GPU/storage pricing edit.
- Shared secret fallback cho automation.
- Remote support session (DB + UI placeholder).

Không multi-admin RBAC; không approval chain.

### Future Expansion

- Unified inbox + SLA view.
- Audit log mọi admin action.
- Read-only admin delegate (muộn, nếu có nhân sự thứ 2).
- Automated suggestions (không auto-approve CK sớm).
- Infrastructure view: GPU rent decisions, region fallback stats.

### Current Providers

| Capability | Mô tả |
|---|---|
| **Manual approval** | CK, renew, storage, wallet |
| **Hour grants** | Admin tặng giờ |
| **Machine control** | Toggle/stop user machine |
| **Pricing config** | GPU + storage pricing DB |
| **Customer CRM-lite** | List, stats, export |

### Possible Future Providers

| Capability | Ghi chú |
|---|---|
| **Approval workflows** | Chỉ khi >1 operator |
| **External CRM sync** | HubSpot, Notion |
| **Ticketing** | Zendesk bridge |
| **Read-only auditor role** | Compliance |

### Breaking Risk

**Low** — mở rộng admin additive; **Medium** nếu introduce RBAC phức tạp sớm (Principle 15).

### Priority

**Now** — pending inbox · **100 users** — audit · **500 users** — operational dashboards · **2000 users** — delegate role (optional)

### Architecture Principles liên quan

15, 23, 24, 27, 18

---

## Integration

### Purpose

Cho phép GPUVietnam tích hợp với các hệ thống bên ngoài mà không ảnh hưởng Domain Core.

### Current Design

Chưa triển khai.

### Future Expansion

Ví dụ:

- Webhook
- n8n
- Zapier
- Make
- Discord
- Telegram
- Slack

### Current Providers

None

### Possible Future Providers

Các nền tảng Automation và Messaging.

### Breaking Risk

**Low**

### Priority

**2000 users**

### Related Principles

Principle 30, Principle 32

---

# Extension Readiness Matrix

Đánh giá mức sẵn sàng kiến trúc **hiện tại** cho mở rộng tương lai (không phải lộ trình triển khai).

| Extension | Ready | Partial | Not Planned | Notes |
|---|---|---|---|---|
| **GPU Provider** | ✓ | | | Abstraction có; production chỉ Vast. Provider thứ hai cần adapter SSH/image/status. |
| **Payment Provider** | | ✓ | | Manual + Wallet hoạt động; chưa có Payment Domain/Order thống nhất; gateway chưa có. |
| **Workspace Registry** | | ✓ | | Restart-only rõ; catalog static; 3/6 workspace provision được. |
| **Feature Registry** | | ✓ | | Principle 26/27 định hướng; implicit qua plan/workstation; chưa registry riêng. |
| **Storage Provider** | ✓ | | | S3-compatible R2; đổi provider thấp rủi ro. |
| **Notification Provider** | | ✓ | | In-app + SMS OTP; Zalo/email settings có, delivery chưa đầy đủ. |
| **Authentication Provider** | | ✓ | | Supabase + OTP; OAuth/SSO chưa; dashboard cookie guard yếu. |
| **AI Assistant** | | | ✓ | Chưa có module; support WebRTC placeholder khác scope. |
| **Backup Provider** | | ✓ | | Flow unified; gắn SSH+Vast+R2; chưa abstract backup adapter. |
| **Billing Strategy** | ✓ | | | Per-minute canonical; ledger/API metering là mở rộng additive. |
| **Monitoring / Observability** | | ✓ | | Admin UI có; thiếu structured log/APM/audit tập trung. |
| **Admin Capability** | ✓ | | | Đủ 1 operator; RBAC multi-admin không planned sớm. |

**Chú thích:**

- **Ready** — có boundary rõ, thêm instance/provider mới chủ yếu ở lớp tích hợp.
- **Partial** — concept có, contract hoặc coverage chưa đủ.
- **Not Planned** — chưa nằm trong kiến trúc hiện tại; thêm là greenfield additive.

---

# Overall Assessment

Câu hỏi: Khi bổ sung **GPU Provider mới**, **Payment Gateway mới**, **Workspace mới**, hoặc **Feature mới** — có phải sửa **Domain Core** hay không?

**Domain Core** (trong ngữ cảnh GPUVietnam) gồm các khái niệm và luồng không được phá vỡ:

- Phiên GPU (Machine lifecycle): start → running → destroy unified.
- Billing per-minute gắn session.
- Subscription / quota độc lập payment.
- Restart-only workspace; một workspace / phiên; một phiên active / user.
- Order → Payment → Subscription (hướng Principle 27 — một phần chưa tách entity).

---

## GPU Provider mới

**Có phải sửa Domain Core?** **Không** — nếu provider mới implement đúng GPU Provider contract.

**Vị trí tác động (lớp tích hợp, không phải core):**

| Lớp | Tác động |
|---|---|
| GPU Provider adapter | Rent, status, destroy, health endpoint mapping |
| GPU selection policy | Region, VRAM filter, fallback — có thể cần tune per vendor |
| Backup Provider | SSH/path khác → Backup adapter (Partial hiện tại) |
| Container image | Image pull registry per workspace |

**Lý do không đụng core:** Principle 6, 30 — billing, subscription, destroy orchestration gọi abstraction, không gọi Vast trực tiếp.

**Rủi ro:** Medium nếu provider không có SSH tương đương — Backup Provider phải mở rộng, vẫn không đổi billing/session model.

---

## Payment Gateway mới

**Có phải sửa Domain Core?** **Không** — nếu gateway chỉ là Payment Provider adapter.

**Có thể cần mở rộng Payment Domain (chưa phải core phiên GPU):**

| Lớp | Tác động |
|---|---|
| Payment Provider adapter | Webhook, redirect, signature verify |
| Order / Payment state | Principle 27 — hướng tương lai; hiện map vào subscription/deposit pending |
| Idempotency | Callback trùng — Principle 29 |

**Không sửa:** Subscription activation rules, billing, machine lifecycle (Principles 9, 10, 11, 28).

**Lý do:** Gateway chỉ chuyển trạng thái “đã trả tiền”; core kích hoạt quyền vẫn qua domain subscription/wallet.

**Rủi ro:** Medium nếu implement gateway logic trực tiếp trong subscription approve path thay vì Payment Domain.

---

## Workspace mới

**Có phải sửa Domain Core?** **Không** — nếu tuân restart-only và một workspace/phiên.

**Vị trí tác động:**

| Lớp | Tác động |
|---|---|
| Workspace Registry | Entry mới: slug, feature map, marketing metadata |
| Container boot template | Docker image + env vars khi start phiên |
| Validation | Cho phép provision hay chỉ UI (như Jupyter hiện tại) |
| Feature Registry (Partial) | Map workspace → feature kinh doanh |

**Không sửa:** Machine state machine, billing per-minute, destroy order, one session rule.

**Lý do:** Workspace là implementation của Feature trên GPU (Principle 26); thêm workspace = thêm template boot, không đổi phiên model.

**Rủi ro:** Low. High chỉ khi yêu cầu hot-swap workspace (vi phạm Principle 2).

---

## Feature mới

**Có phải sửa Domain Core?** **Phụ thuộc loại feature** — phân hai nhóm:

### Nhóm A — Feature dùng GPU Session (Image, Video, Training, …)

**Không sửa Domain Core phiên.**

Tác động tại:

| Lớp | Tác động |
|---|---|
| Feature Registry | Catalog, pricing, quota rules |
| Workspace Registry | Runtime triển khai |
| Order / Payment | Line item mới (Principle 27 — Partial) |
| Plan / Inventory | Map quota cho feature |

Machine + billing + destroy **giữ nguyên**.

### Nhóm B — Feature không dùng session GPU (API metering, Prompt Library, marketplace)

**Không sửa core phiên GPU**, nhưng **mở rộng domain billing/payment**:

| Lớc | Tác động |
|---|---|
| Billing Strategy | Thêm strategy (API token) — song song per-minute session |
| Feature Registry | Bắt buộc rõ ràng |
| Order | SKU mới |

Đây là **mở rộng domain** (billing/payment/feature), **không** rewrite machine lifecycle.

---

## Tóm tắt

| Mở rộng | Sửa Domain Core (phiên + billing phút + destroy)? | Chủ yếu tác động ở đâu |
|---|---|---|
| **GPU Provider mới** | **Không** | GPU Provider adapter; có thể Backup adapter |
| **Payment Gateway mới** | **Không** | Payment Provider adapter; Order state (Partial) |
| **Workspace mới** | **Không** | Workspace Registry + container template |
| **Feature mới (session)** | **Không** | Feature Registry + Workspace + pricing/Order |
| **Feature mới (non-session)** | **Không** (core phiên) | Feature Registry + Billing Strategy mới |

**Kết luận:** Kiến trúc GPUVietnam **đã thiết kế cho mở rộng qua Provider/Registry/Adapter** (Principles 19, 30, 32). Domain Core phiên GPU ổn định; hầu hết thay đổi tương lai nằm ở **lớp tích hợp** và **domain phụ** (Payment, Feature, Order) đang **Partial** — cần hoàn thiện dần theo Principle 27 mà **không** thay triết lý restart-only, billing per-minute, hay monolith vận hành một người.

---

# Design Rules

Một Extension Point được xem là thiết kế tốt nếu:

- Có thể thêm Provider mới mà không sửa Domain Core.
- Có thể thay thế Provider hiện tại mà không thay đổi Business Logic.
- Có thể bổ sung Provider mới mà không cần thay đổi Database Schema.
- Có thể mở rộng theo từng giai đoạn phát triển.
- Không làm thay đổi các Architecture Principles đã được xác lập.

Đây là tiêu chí đánh giá chất lượng của mọi Extension Point trong GPUVietnam.

---

*Tài liệu Extension Points — tham chiếu kiến trúc GPUVietnam, không thay thế ARCHITECTURE_PRINCIPLES.md.*
