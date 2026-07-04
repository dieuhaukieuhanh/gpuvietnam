# GPUVietnam — Technical Debt Register

> Sổ quản lý Technical Debt của GPUVietnam.  
> Đây **không** phải TODO list, Bug list, hay Refactor list.

**Ngày:** 2026-06-28  
**Liên quan:** [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) · [TARGET_ARCHITECTURE_DRAFT.md](./TARGET_ARCHITECTURE_DRAFT.md) · [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md) · [EXTENSION_POINTS.md](./EXTENSION_POINTS.md)

---

# Technical Debt Philosophy

> Không phải mọi Technical Debt đều cần được trả.

GPUVietnam ưu tiên:

- Đơn giản.
- Ổn định.
- Một người vận hành.
- Không tối ưu hóa sớm.

Một Technical Debt chỉ nên được xử lý khi:

- Chi phí duy trì khoản nợ lớn hơn chi phí sửa.
- Hoặc bắt đầu ảnh hưởng trải nghiệm khách hàng.
- Hoặc cản trở mở rộng hệ thống.
- Hoặc vi phạm Architecture Principles.

---

# Debt Categories

GPUVietnam phân loại Technical Debt thành bốn nhóm.

## Accepted Debt

Technical Debt được chấp nhận có chủ đích vì phù hợp với giai đoạn phát triển hiện tại.

Không cần xử lý nếu chưa ảnh hưởng đến Business hoặc Architecture Principles.

---

## Growth Debt

Technical Debt chỉ cần xử lý khi hệ thống đạt đến quy mô người dùng, doanh thu hoặc mức độ sử dụng nhất định.

---

## Operational Debt

Technical Debt làm tăng chi phí vận hành, công sức hỗ trợ hoặc khả năng xảy ra sự cố trong quá trình vận hành.

---

## Architectural Debt

Technical Debt có khả năng cản trở việc mở rộng hệ thống hoặc làm sai lệch các Architecture Principles đã được xác lập.

---

## Table of Contents

1. [Manual Payment Approval](#manual-payment-approval)
2. [Single GPU Provider (Vast)](#single-gpu-provider-vast)
3. [Workspace Catalog Static](#workspace-catalog-static)
4. [Feature Registry Not Separated](#feature-registry-not-separated)
5. [Simple Notification System](#simple-notification-system)
6. [Basic Monitoring](#basic-monitoring)
7. [Authentication Limited to OTP / Email](#authentication-limited-to-otp--email)
8. [Backup Depends on SSH](#backup-depends-on-ssh)
9. [No Payment Gateway Integration](#no-payment-gateway-integration)
10. [Minimal Wallet](#minimal-wallet)
11. [Incomplete Order Domain](#incomplete-order-domain)
12. [Observability for One Operator](#observability-for-one-operator)
13. [Minimal Admin Capability](#minimal-admin-capability)
14. [Single Storage Provider Choice](#single-storage-provider-choice)
15. [No Automation / Integration](#no-automation--integration)
16. [Technical Debt Matrix](#technical-debt-matrix)
17. [Overall Assessment](#overall-assessment)
18. [Debt Management Rules](#debt-management-rules)

---

## Manual Payment Approval

### Description

Thanh toán chuyển khoản yêu cầu operator duyệt thủ công trước khi kích hoạt gói, gia hạn, nạp ví, hoặc storage upgrade.

### Current Design

Luồng: user tạo pending → admin approve/reject qua panel. Không có đối soát ngân hàng tự động. CK là first-class path theo Principle 23.

### Why It Exists

Phù hợp thị trường VN, giai đoạn MVP, một operator — không cần tích hợp gateway phức tạp sớm.

### Why It Is Accepted

Chi phí vận hành thấp ở quy mô nhỏ; kiểm soát gian lận/chuyển nhầm tốt; align Principle 15, 23.

### Risks

- Bottleneck khi volume pending tăng.
- Trễ kích hoạt gói (UX).
- Operator single point of failure.
- Sai sót duyệt nhầm khi mệt/tải cao.

### Business Impact

**Medium** (tăng lên **High** khi >50 pending/tuần)

### Technical Impact

**Low**

### Architecture Principles

15, 23, 27, 28

### Trigger To Fix

- **>500 payments/tháng** cần duyệt tay, hoặc
- Thời gian duyệt trung bình **>30 phút** ảnh hưởng conversion, hoặc
- Operator không đủ bandwidth xử lý queue trong ngày làm việc

### Estimated Difficulty

**Medium** (bổ sung gateway/đối soát — không thay core subscription)

### Priority

**500 users**

### Debt Category

**Accepted**

### Domain Core Impact

**No**

---

## Single GPU Provider (Vast)

### Description

Production chỉ rent GPU qua một provider (Vast.ai); không có failover provider thứ hai.

### Current Design

GPU Provider abstraction tồn tại; runtime chỉ wire Vast. Provision, health, destroy, SSH backup gắn đặc thù Vast.

### Why It Exists

Vast đủ cho MVP ComfyUI; abstraction đã có sẵn cho tương lai; tránh chi phí tích hợp sớm.

### Why It Is Accepted

Align Principle 6 (abstraction) + Principle 17 (không tối ưu sớm); một operator quản một integration.

### Risks

- Outage Vast → không provision được máy.
- Thay đổi pricing/API Vast → ảnh hưởng toàn bộ.
- Vendor lock-in vận hành (dù có abstraction).

### Business Impact

**High** khi Vast outage kéo dài; **Medium** bình thường

### Technical Impact

**Medium**

### Architecture Principles

6, 7, 30, 32

### Trigger To Fix

- **>2 outage Vast/năm** ảnh hưởng SLA, hoặc
- **>100 users** active đồng thời peak, hoặc
- Chuẩn bị **>3 GPU Providers** theo roadmap sản phẩm

### Estimated Difficulty

**High** (provider thứ hai + backup adapter)

### Priority

**500 users** (standby) · **2000 users** (multi-provider theo feature)

### Debt Category

**Growth**

### Domain Core Impact

**No** (nếu giữ GPU Provider contract)

---

## Workspace Catalog Static

### Description

Danh sách Workspace (ComfyUI variants, Jupyter, Blender, …) hardcode; thay đổi copy/metadata cần deploy.

### Current Design

Catalog tĩnh; 3/6 workspace backend provision được. Restart-only; subscription vs machine template tách biệt.

### Why It Exists

Ít workspace ổn định; marketing copy thay đổi không thường xuyên giai đoạn đầu.

### Why It Is Accepted

Align Principle 2, 17; đủ cho 3 ComfyUI env; Extension Point Workspace Registry đánh giá **Partial**.

### Risks

- Marketing/ops không tự cập nhật catalog.
- Thêm workspace = deploy thay vì cấu hình.
- Lệch UI (6 mục) vs backend (3 mục) gây nhầm lẫn.

### Business Impact

**Low** · **Medium** khi **>5 workspaces** hoặc đổi catalog hàng tuần

### Technical Impact

**Low**

### Architecture Principles

1, 2, 26, 17

### Trigger To Fix

- **>5 workspaces** cần quản lý, hoặc
- Non-dev cần sửa catalog **>2 lần/tháng**, hoặc
- Mở rộng LLM/Agent workspace (Feature mới)

### Estimated Difficulty

**Medium**

### Priority

**500 users**

### Debt Category

**Growth**

### Domain Core Impact

**No**

---

## Feature Registry Not Separated

### Description

Feature (đơn vị kinh doanh) chưa có registry riêng; implicit qua plan, workstation UI, trial, grants.

### Current Design

Gói GPU (Starter/Pro/Studio) + billing mode proxy cho feature. Workspace là implementation layer (Principle 26).

### Why It Exists

Sản phẩm giai đoạn đầu chỉ bán GPU session ComfyUI; chưa có API/marketplace riêng.

### Why It Is Accepted

Principle 26/27 là hướng tương lai; mô hình hiện tại đủ bán gói giờ.

### Risks

- Khó bán SKU mới (API credits, marketplace) mà không nhân bản logic plan.
- Pricing/feature mapping rải rác.
- Order-first (Principle 27) khó thống nhất.

### Business Impact

**Medium** khi mở sản phẩm mới · **Low** hiện tại

### Technical Impact

**Medium**

### Architecture Principles

26, 27, 10, 19

### Trigger To Fix

- Ra mắt **feature thứ 2** ngoài GPU session (API, marketplace, …), hoặc
- **>3 loại SKU** cần pricing/Order riêng

### Estimated Difficulty

**Medium**

### Priority

**500 users**

### Debt Category

**Architectural**

### Domain Core Impact

**No** (mở rộng domain phụ; không đổi machine lifecycle)

---

## Simple Notification System

### Description

Thông báo chủ yếu in-app; SMS dùng OTP; Zalo/email settings có nhưng delivery external chưa đầy đủ.

### Current Design

Bảng notifications + helpers theo event. Không outbox/worker. Cross-cutting (Principle 21).

### Why It Exists

User chủ yếu dùng dashboard; một operator không cần multi-channel phức tạp sớm.

### Why It Is Accepted

Principle 21 — core không phụ thuộc delivery; in-app đủ cho idle warning, payment success cơ bản.

### Risks

- User không mở dashboard → miss idle warning / hết credit.
- Không có email/Zalo transactional ổn định.
- Operator không nhận alert proactive.

### Business Impact

**Medium** (churn khi máy tắt bất ngờ · miss payment confirm)

### Technical Impact

**Low**

### Architecture Principles

21, 14, 30

### Trigger To Fix

- **>500 users** và tỷ lệ idle auto-stop khiếu nại tăng, hoặc
- Yêu cầu **Zalo/email** transactional cho payment/backup events

### Estimated Difficulty

**Medium**

### Priority

**500 users**

### Debt Category

**Growth**

### Domain Core Impact

**No**

---

## Basic Monitoring

### Description

Observability chủ yếu console log + admin UI; thiếu APM, structured log tập trung, metrics, alerting.

### Current Design

Vercel logs; debug checkpoint trong status path (ARCHITECTURE_REVIEW §17.5). Cron trả JSON. Không Sentry/Datadog.

### Why It Exists

Một operator debug trực tiếp; quy mô nhỏ; tránh chi phí tool sớm.

### Why It Is Accepted

Principle 15, 17, 24 — observability phục vụ một người, không đội SRE.

### Risks

- Lỗi production khó tái hiện.
- Không phát hiện billing tick lag sớm.
- Không alert khi provision fail hàng loạt.

### Business Impact

**Medium** khi incident kéo dài · **Low** giai đoạn đầu

### Technical Impact

**Medium**

### Architecture Principles

15, 24, 18

### Trigger To Fix

- **>100 users** và incident **>2 lần/tháng** không root cause trong 1 giờ, hoặc
- **>20 máy running** peak cần metrics

### Estimated Difficulty

**Low–Medium**

### Priority

**100 users**

### Debt Category

**Operational**

### Domain Core Impact

**No**

---

## Authentication Limited to OTP / Email

### Description

Auth: Supabase email/password + OTP SMS; dashboard guard cookie boolean; chưa OAuth; session binding yếu.

### Current Design

API dùng JWT Bearer. Middleware dashboard chỉ check cookie flag. Phone verification qua SpeedSMS.

### Why It Exists

OTP phù hợp VN; Supabase Auth nhanh triển khai; chưa cần social login.

### Why It Is Accepted

Đủ cho MVP; Principle 17; rủi ro cookie bypass chỉ ảnh hưởng UI shell (API vẫn JWT).

### Risks

- Cookie `gpuvietnam-auth=1` có thể bypass UI dashboard (API vẫn protected).
- Không MFA/OAuth → friction hoặc security gap tùy segment.
- Support/end import module sai (ARCHITECTURE_REVIEW §17.5) — lỗi vận hành support.

### Business Impact

**Low–Medium**

### Technical Impact

**Medium** (middleware) · **Low** (OAuth thiếu)

### Architecture Principles

15, 30, 32, 20

### Trigger To Fix

- **>100 users** hoặc phát hiện **truy cập dashboard trái phép**, hoặc
- B2B yêu cầu Google/Microsoft SSO

### Estimated Difficulty

**Medium**

### Priority

**100 users**

### Debt Category

**Operational**

### Domain Core Impact

**No**

---

## Backup Depends on SSH

### Description

Backup trước destroy dùng SSH vào host Vast + tar + upload R2; chưa có backup adapter abstract.

### Current Design

Unified destroy gọi backup khi running; failure vẫn destroy theo policy. Log `backup_logs`.

### Why It Exists

Vast expose SSH; không có snapshot API chuẩn; R2 đủ cho archive.

### Why It Is Accepted

Principle 12 — backup tách billing; Principle 31 — user owns data; đủ cho ComfyUI folders.

### Risks

- Provider không SSH → backup không chạy.
- Network/SSH flake → mất data user.
- Backup sync trong destroy → timeout edge case.

### Business Impact

**High** khi backup fail liên tục · **Medium** bình thường

### Technical Impact

**Medium**

### Architecture Principles

12, 13, 22, 30, 31

### Trigger To Fix

- Thêm **GPU Provider thứ 2** không có SSH tương đương, hoặc
- **>5% backup fail rate** trong 30 ngày, hoặc
- Khiếu nại mất output **>3 case/tháng**

### Estimated Difficulty

**Medium–High**

### Priority

**500 users** (adapter) · **Now** nếu backup fail rate cao (vận hành, không đổi kiến trúc)

### Debt Category

**Architectural**

### Domain Core Impact

**No**

---

## No Payment Gateway Integration

### Description

Chưa tích hợp PayOS, Stripe, VietQR auto; thanh toán gateway không phải kênh production.

### Current Design

Manual transfer + wallet internal. Payment Domain independent (Principle 28) — gateway chưa có adapter.

### Why It Exists

Admin duyệt CK đủ giai đoạn đầu; tránh phí gateway + compliance sớm.

### Why It Is Accepted

Principle 11 — payment không phụ thuộc gateway; hệ thống hoạt động không gateway.

### Risks

- Khách không quen CK / muốn QR instant.
- Không scale nạp ví tự động.
- Đối thủ có checkout nhanh hơn.

### Business Impact

**Medium** · **High** khi **>2000 users** cần instant top-up

### Technical Impact

**Low–Medium** (adapter additive)

### Architecture Principles

11, 28, 29, 30, 32

### Trigger To Fix

- **>500 payments/tháng** wallet top-up, hoặc
- Conversion checkout giảm vì **không có QR/gateway**, hoặc
- **>2000 users**

### Estimated Difficulty

**Medium**

### Priority

**2000 users** (hoặc **500 users** nếu top-up volume cao)

### Debt Category

**Growth**

### Domain Core Impact

**No**

---

## Minimal Wallet

### Description

Ví nội bộ: balance + transactions; thiếu idempotency RPC formal; chưa gateway top-up; logic purchase tuần tự.

### Current Design

`wallet_balance` trên user; `wallet_transactions`; deposit pending admin approve; pay-wallet instant cho gói.

### Why It Exists

Đủ mua gói nhanh không CK; đơn giản một operator reconcile.

### Why It Is Accepted

Principle 17; TARGET_ARCHITECTURE ghi idempotency là cải thiện vận hành, chưa bắt buộc kiến trúc mới.

### Risks

- Double-charge khi retry/double-click.
- Race condition hiếm khi concurrent requests.
- Khó audit tranh chấp số dư.

### Business Impact

**Medium** (trust · refund dispute)

### Technical Impact

**Medium**

### Architecture Principles

9, 11, 27, 29, 28

### Trigger To Fix

- **>100 users** dùng wallet mua gói, hoặc
- **≥1 incident** double-charge/refund, hoặc
- **>500 payments/tháng** qua wallet

### Estimated Difficulty

**Medium**

### Priority

**Now** (nếu incident) · **100 users** (preventive)

### Debt Category

**Operational**

### Domain Core Impact

**No**

---

## Incomplete Order Domain

### Description

Chưa có entity Order thống nhất; giao dịch phân tán: subscription pending, plan_renew_requests, storage_upgrades, wallet deposit.

### Current Design

Mỗi loại có bảng/luồng riêng; admin gom pending queue. Principle 27 (Order-first) — hướng tương lai; Extension Order **Now** priority.

### Why It Exists

Single operator duyệt từng loại ổn; tránh over-model sớm (TARGET_ARCHITECTURE: no unified orders đến 500 users).

### Why It Is Accepted

Accepted debt có chủ đích; Payment/Subscription vẫn tách (Principles 10, 27).

### Risks

- Khó đối soát cross-product.
- Thêm SKU mới = thêm bảng pending riêng.
- Order reference không nhất quán.

### Business Impact

**Medium** khi đa sản phẩm · **Low** hiện tại

### Technical Impact

**Medium**

### Architecture Principles

27, 28, 10, 26, 19

### Trigger To Fix

- **>3 loại sản phẩm** bán qua payment (GPU + storage + API…), hoặc
- **>500 payments/tháng**, hoặc
- Admin pending queue **>30 items/ngày** thường xuyên

### Estimated Difficulty

**Medium–High**

### Priority

**500 users**

### Debt Category

**Architectural**

### Domain Core Impact

**No**

---

## Observability for One Operator

### Description

Thiếu audit trail tập trung, structured event timeline, và operator alerting — observability thiết kế cho một người nhưng chưa đủ công cụ.

### Current Design

Admin panels rời; hour_grant_logs, admin_machine_logs phân tán; không unified audit view.

### Why It Exists

Một operator nhớ context; volume thấp; tránh xây SIEM sớm.

### Why It Is Accepted

Principle 15, 24 — không thiết kế cho đội SRE.

### Risks

- Không truy vết “ai duyệt gì khi nào” nhanh.
- Khó debug billing dispute sau vài tuần.
- Operator burnout khi scale.

### Business Impact

**Low–Medium**

### Technical Impact

**Medium**

### Architecture Principles

15, 24, 18, 23

### Trigger To Fix

- **>100 users**, hoặc
- **>1 billing dispute/tháng** cần audit, hoặc
- Operator **>2h/ngày** tìm log thủ công

### Estimated Difficulty

**Low–Medium**

### Priority

**100 users**

### Debt Category

**Operational**

### Domain Core Impact

**No**

---

## Minimal Admin Capability

### Description

Admin binary role; không RBAC; pending queue chưa unified inbox; support WebRTC placeholder; không CRM/ticketing.

### Current Design

Approve/reject, grants, machine toggle, pricing edit, customer list/export. `ADMIN_SECRET` fallback.

### Why It Exists

Một operator làm tất cả; Principle 15 — không multi-admin sớm.

### Why It Is Accepted

Align Architecture Philosophy; đủ MVP vận hành VN.

### Risks

- Queue lộn xộn khi pending tăng.
- Không delegate khi operator vắng.
- Support remote chưa hoàn chỉnh.

### Business Impact

**Medium** khi scale ops · **Low** hiện tại

### Technical Impact

**Low**

### Architecture Principles

15, 23, 24, 27

### Trigger To Fix

- **>500 users**, hoặc
- Pending **>20 items/ngày** ổn định, hoặc
- Có **nhân sự vận hành thứ 2**

### Estimated Difficulty

**Low–Medium**

### Priority

**500 users**

### Debt Category

**Operational**

### Domain Core Impact

**No**

---

## Single Storage Provider Choice

### Description

Object storage production chỉ Cloudflare R2; chưa multi-bucket strategy/lifecycle; metadata SSD/backup trên DB.

### Current Design

S3-compatible client → R2 cho backup archives. Extension Storage Provider đánh giá **Ready** (dễ đổi adapter).

### Why It Exists

R2 rẻ, S3 API, đủ backup; một operator một bucket.

### Why It Is Accepted

Principle 32 — adapter có thể thay; Principle 17.

### Risks

- R2 outage → backup/upload fail.
- Chi phí storage tăng không có lifecycle.
- Lock-in Cloudflare (mitigated bởi S3 API).

### Business Impact

**Medium** khi backup volume lớn · **Low** giai đoạn đầu

### Technical Impact

**Low**

### Architecture Principles

12, 22, 30, 32

### Trigger To Fix

- Backup storage **>1TB**, hoặc
- Cần **multi-region**, hoặc
- **>2000 users** với retention policy phức tạp

### Estimated Difficulty

**Low**

### Priority

**2000 users** (lifecycle) · **500 users** (monitoring cost)

### Debt Category

**Growth**

### Domain Core Impact

**No**

---

## No Automation / Integration

### Description

Chưa có webhook, Zapier, n8n, Slack/Telegram integration cho sự kiện hệ thống. Extension Integration: chưa triển khai.

### Current Design

None — mọi tích hợp manual qua admin hoặc in-app.

### Why It Exists

Một operator; không B2B automation; Principle 17.

### Why It Is Accepted

Không cản trở core GPU session; Principle 30 khi cần sẽ qua adapter.

### Risks

- Không tự động hóa marketing/ops.
- Enterprise khách yêu cầu webhook → chưa có.
- Operator làm lặp tay export/sync.

### Business Impact

**Low** · **Medium** khi B2B/enterprise

### Technical Impact

**Low**

### Architecture Principles

30, 32, 15, 19

### Trigger To Fix

- **>2000 users**, hoặc
- **≥3 enterprise khách** yêu cầu webhook, hoặc
- Tích hợp CRM/Discord community bắt buộc

### Estimated Difficulty

**Medium**

### Priority

**2000 users**

### Debt Category

**Growth**

### Domain Core Impact

**No**

---

# Technical Debt Matrix

| Debt | Accepted | Priority | Trigger To Fix | Business Impact |
|---|---|---|---|---|
| Manual Payment Approval | Yes | 500 users | >500 payments/tháng hoặc duyệt >30 phút | Medium |
| Single GPU Provider (Vast) | Yes | 500 users | Outage lặp / >100 users peak | High (outage) |
| Workspace Catalog Static | Yes | 500 users | >5 workspaces | Low–Medium |
| Feature Registry Not Separated | Yes | 500 users | Feature thứ 2 ngoài GPU session | Medium |
| Simple Notification System | Yes | 500 users | Idle/payment miss feedback | Medium |
| Basic Monitoring | Yes | 100 users | >2 incidents/tháng không RCA nhanh | Medium |
| Authentication Limited to OTP / Email | Yes | 100 users | Dashboard bypass / SSO demand | Low–Medium |
| Backup Depends on SSH | Yes | 500 users | Provider #2 / >5% backup fail | High (fail) |
| No Payment Gateway Integration | Yes | 2000 users | >500 top-ups/tháng | Medium–High |
| Minimal Wallet | Partial | Now / 100 users | Double-charge / >100 wallet users | Medium |
| Incomplete Order Domain | Yes | 500 users | >3 SKU / >500 payments/tháng | Medium |
| Observability for One Operator | Yes | 100 users | Billing dispute / >100 users | Low–Medium |
| Minimal Admin Capability | Yes | 500 users | >20 pending/ngày | Medium |
| Single Storage Provider Choice | Yes | 2000 users | >1TB backup / lifecycle need | Low–Medium |
| No Automation / Integration | Yes | 2000 users | Enterprise webhook demand | Low–Medium |

**Chú thích Accepted:**

- **Yes** — chủ đích chấp nhận theo Architecture Philosophy.
- **Partial** — chấp nhận mô hình nhưng có rủi ro vận hành cần xử lý sớm hơn nếu incident xảy ra.

---

# Overall Assessment

### Tổng số Technical Debt

**15** khoản được đăng ký trong tài liệu này (không bao gồm bug/incident lẻ từ ARCHITECTURE_REVIEW §17.5 — those là operational fixes, không phải structural debt trong scope sổ này).

### Accepted Debt

| Phân loại | Số lượng |
|---|---|
| **Accepted (Yes)** | **14** |
| **Accepted with caveats (Partial)** | **1** (Minimal Wallet) |
| **Not accepted / must fix regardless of scale** | **0** trong danh sách — mọi khoản đều có lý do chấp nhận giai đoạn hiện tại |

Tất cả 15 khoản đều **không yêu cầu sửa Domain Core** (phiên GPU, billing per-minute, destroy unified, restart-only workspace) khi xử lý đúng Extension Point / adapter pattern.

### Cần xử lý sớm (Priority: Now)

| Số lượng | Khoản |
|---|---|
| **1** (conditional) | **Minimal Wallet** — khi đã có incident double-charge hoặc retry payment; hoặc preventive khi wallet adoption tăng |

Các khoản khác **không** thuộc Priority Now theo đánh giá hiện tại — align TARGET_ARCHITECTURE (tránh tối ưu sớm).

### Chờ >100 users

| Số lượng | Khoản |
|---|---|
| **4** | Basic Monitoring · Authentication Limited · Observability for One Operator · Minimal Wallet (preventive) |

### Chờ >500 users

| Số lượng | Khoản |
|---|---|
| **9** | Manual Payment Approval · Single GPU Provider · Workspace Catalog Static · Feature Registry · Simple Notification · Backup SSH adapter · Incomplete Order Domain · Minimal Admin · (Payment Gateway nếu top-up volume cao) |

### Chờ >2000 users

| Số lượng | Khoản |
|---|---|
| **3** | No Payment Gateway (default) · Single Storage Provider (lifecycle) · No Automation / Integration |

*(Payment Gateway có thể kéo về 500 users nếu trigger volume top-up đạt trước.)*

### Kết luận

GPUVietnam mang **Technical Debt có chủ đích**, phù hợp **một operator**, **monolith**, và **Principles 15, 17, 23**. Phần lớn nợ **Accepted** — không cần trả cho đến khi trigger cụ thể (volume, incident, sản phẩm mới) đạt ngưỡng.

**Không có khoản nào** trong danh sách 15 buộc phải rewrite Domain Core; xử lý tương lai nằm ở **Payment/Order/Feature domain**, **Provider adapters**, **observability**, và **admin/ops tooling** — đúng hướng EXTENSION_POINTS và Design Rules.

Vi phạm Principles cần theo dõi riêng nếu debt kéo dài quá trigger: ví dụ **Minimal Wallet** + Principle **29** (Idempotency), **Authentication** + session integrity, **Backup SSH** + Principle **31** (data ownership).

---

# Debt Management Rules

GPUVietnam không cố gắng loại bỏ toàn bộ Technical Debt.

Technical Debt chỉ nên được xử lý khi đáp ứng ít nhất một trong các điều kiện sau:

- Làm giảm trải nghiệm khách hàng.
- Làm tăng đáng kể chi phí vận hành.
- Cản trở khả năng mở rộng của hệ thống.
- Vi phạm Architecture Principles.
- Chi phí duy trì khoản nợ lớn hơn chi phí sửa chữa.

Nếu chưa đáp ứng các điều kiện trên, Technical Debt được phép tồn tại.

Việc giữ lại một Technical Debt có chủ đích không được xem là một thiếu sót, mà là một quyết định kiến trúc phù hợp với giai đoạn phát triển của GPUVietnam.

---

*GPUVietnam Technical Debt Register — mô tả hiện trạng và điều kiện xử lý; không thay thế ARCHITECTURE_PRINCIPLES.md.*
