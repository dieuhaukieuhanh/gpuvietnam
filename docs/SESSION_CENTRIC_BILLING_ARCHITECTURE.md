# SESSION_CENTRIC_BILLING_ARCHITECTURE

**Kiến trúc billing chính thức — GPUVietnam**

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 2026-06-28 |
| **Trạng thái** | Official Architecture |
| **Liên quan** | [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md) · [SESSION_BASED_BILLING_FEASIBILITY.md](./SESSION_BASED_BILLING_FEASIBILITY.md) · [SESSION_BASED_BILLING_REVIEW.md](./SESSION_BASED_BILLING_REVIEW.md) · [BILLING_LOGIC_REVIEW.md](./BILLING_LOGIC_REVIEW.md) |

**Quy ước:** Tài liệu mô tả **kiến trúc và domain**. Không viết code. Không đề xuất implementation.

---

## Executive Summary

GPUVietnam áp dụng **Session-Centric Billing (SCB)**:

- **Session** (`gpu_sessions`) là đơn vị nghiệp vụ trung tâm cho thời gian sử dụng GPU.
- **Không** có billing tick (`deductPerMinute`), **không** có heartbeat billing, **không** có Usage Ledger / Event Sourcing.
- Trong lúc phiên chạy, billing **chỉ đọc** — tính **Remaining Time** bằng **một công thức duy nhất**.
- **Settlement** (trừ entitlement, ghi kết quả phiên) **chỉ** xảy ra **sau khi Destroy được GPU Provider xác minh thành công**.
- **Infrastructure Reconciliation** là domain riêng — đối chiếu hạ tầng, **không** thay thế billing và **không** trigger settlement.

Kiến trúc này **cập nhật có chủ đích** so với `ARCHITECTURE_PRINCIPLES.md` v1.1:

| Nguyên tắc cũ | Thay đổi trong SCB |
|---------------|-------------------|
| **§8** — trừ dần theo phút khi phiên active | §8 được hiểu lại: billing gắn thời gian thực; **Remaining hiển thị theo thời gian thực**; **commit entitlement chỉ tại Settlement** sau provider verify |
| **§13** — backup → billing → session → destroy | §13 được hiểu lại: backup (nếu có) → **destroy + provider verify** → **settlement** → đóng session → cập nhật trạng thái |

Mọi thay đổi nguyên tắc phải được phản ánh trong bản cập nhật `ARCHITECTURE_PRINCIPLES.md` v1.2 (ngoài phạm vi tài liệu này).

---

## 1. Architecture Overview

### 1.1 Triết lý

> **Một phiên — một công thức — một lần settlement — sau khi provider xác nhận destroy.**

Thiết kế phục vụ **một người vận hành** (Nguyên tắc 15): ít moving parts, ít SoT, ít luồng ghi billing, dễ giải thích cho user và admin.

### 1.2 Domain map

```
┌─────────────────────────────────────────────────────────────────┐
│                        PAYMENT DOMAIN                            │
│  Order → Entitlement Grant (gift / combo / wallet deposit)       │
│  Không trừ usage runtime                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                │ grants
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ENTITLEMENT DOMAIN                           │
│  user_plan_inventory · manual_hour_grants · wallet_balance     │
│  Total Entitlement (readable snapshot)                           │
└───────────────────────────────┬─────────────────────────────────┘
                                │ consumed at Settlement only
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SESSION-CENTRIC BILLING                        │
│  ┌─────────────┐   ┌──────────────────┐   ┌─────────────────┐ │
│  │ Session     │   │ Remaining Time   │   │ Settlement      │ │
│  │ Lifecycle   │──►│ (read-only,      │   │ (write once,    │ │
│  │             │   │  single formula) │   │  post-verify)   │ │
│  └──────┬──────┘   └──────────────────┘   └────────▲────────┘ │
│         │                                          │           │
└─────────┼──────────────────────────────────────────┼───────────┘
          │                                          │
          ▼                                          │
┌─────────────────────────────────────────────────┐  │
│              MACHINE / ORCHESTRATION             │  │
│  provision · status · unified destroy pipeline   │  │
└─────────────────────────┬───────────────────────┘  │
                          │                            │
                          ▼                            │
┌─────────────────────────────────────────────────┐  │
│           GPU PROVIDER ADAPTER (§30)             │  │
│  verify running · verify destroyed               │──┘
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│     INFRASTRUCTURE RECONCILIATION (riêng)        │
│  drift detection · operator alerts · repair      │
│  KHÔNG settlement · KHÔNG Remaining formula      │
└─────────────────────────────────────────────────┘
```

### 1.3 Ranh giới module (monolith)

| Module | Trách nhiệm | Không được làm |
|--------|-------------|----------------|
| **Session** | Lifecycle phiên; `started_at`, `ended_at`, trạng thái settlement | Trừ entitlement trực tiếp khi đang `running` |
| **Remaining Time** | Một hàm/domain service — projection thuần | Ghi DB entitlement; gọi provider |
| **Settlement** | Trừ gift → combo → hourly; đánh dấu session settled | Chạy trước provider verify; chạy từ reconciliation |
| **Destroy Pipeline** | Backup → provider destroy → verify → gọi settlement | Billing logic nhúng trong UI/API handler |
| **Provider Verification** | Xác nhận instance không còn tồn tại / terminated | Settlement; reconciliation drift |
| **Infrastructure Reconciliation** | So sánh provider vs DB; báo cáo / repair hạ tầng | Tính Remaining; settlement; trừ wallet |

### 1.4 Những gì SCB **không** dùng

| Loại bỏ | Lý do |
|---------|-------|
| `deductPerMinute()` | Race, đa SoT, phức tạp vận hành (`BILLING_SAFETY.md`) |
| Heartbeat billing | Ghi định kỳ trong lúc chạy — coi là biến thể tick |
| Usage Ledger / Event Sourcing | Vượt quá nhu cầu một người vận hành; rejected trong `SESSION_BASED_BILLING_REVIEW.md` SLHB |
| `duration_seconds` làm SoT | Counter song song wall-clock — nguồn lệch (`BILLING_LOGIC_REVIEW.md`) |
| Billing trong Auto Stop | Auto Stop chỉ **đọc** Remaining và **kích hoạt** destroy |
| Frontend/localStorage làm SoT Remaining | Vi phạm Nguyên tắc 20 |

---

## 2. Source of Truth

### 2.1 Nguyên tắc SoT

| Loại dữ liệu | SoT | Ghi chú |
|--------------|-----|---------|
| **Thời gian phiên billable** | `gpu_sessions.started_at` | Set khi session vào trạng thái billable (provider xác nhận running) |
| **Thời gian kết thúc billable** | `gpu_sessions.ended_at` | Set khi destroy verified; dùng cho settlement |
| **Thời lượng đã settle** | `ended_at − started_at` của session có `settlement_status = settled` | Derived; có thể cache `billable_seconds` trên session row |
| **Entitlement tổng** | Entitlement Domain snapshot | Gift + combo inventory + wallet→hours |
| **Entitlement đã tiêu thụ (committed)** | Cập nhật **chỉ** tại Settlement | `hours_used`, `manual_hour_grants.hours_used`, `wallet_balance` |
| **Remaining Time** | **Derived** — không lưu SoT | Luôn tính từ công thức §3 |
| **Trạng thái settlement** | `gpu_sessions.settlement_status` | `pending` · `settled` · `skipped` · `failed` |
| **Provider instance tồn tại** | GPU Provider Adapter (live query) | Không suy từ DB alone |
| **Drift hạ tầng** | Infrastructure Reconciliation records | Tách khỏi billing |

### 2.2 Không phải SoT

| Field / khái niệm | Vai trò mới |
|-------------------|-------------|
| `gpu_sessions.duration_seconds` | Deprecated hoặc derived cache — **không** tham gia billing math |
| `machines.billing_started_at` | Denormalized copy của `session.started_at` hoặc loại bỏ — **không** SoT độc lập |
| `subscriptions.server_status` | Runtime UI / orchestration — **không** billing math |
| `subscriptions.hours_used` (mid-session) | Aggregate đã commit — **không** phản ánh phiên đang chạy cho đến settlement |
| Frontend cache / localStorage | Display smoothing only — **cấm** dùng cho Auto Stop / Renew / Admin |

### 2.3 Phân tách Billing vs Infrastructure

| Câu hỏi | Billing trả lời | Infrastructure Reconciliation trả lời |
|---------|-----------------|----------------------------------------|
| User còn bao nhiêu giờ? | Remaining (§3) | — |
| Phiên này trừ bao nhiêu? | Settlement sau verify | — |
| Instance Vast còn chạy không? | Provider verify (destroy path) | Drift scan |
| DB nói destroyed nhưng Vast còn? | — | Báo drift; repair hạ tầng |
| Có nên trừ tiền user? | Settlement rules | **Không** — không thuộc reconciliation |

---

## 3. Remaining Time Formula

### 3.1 Công thức duy nhất (bắt buộc)

Mọi consumer — **Dashboard**, **Auto Stop**, **Renew**, **Admin** — **phải** dùng cùng một công thức:

```
RemainingHours = roundHours(
  TotalEntitlementHours
  − SettledSessionUsageHours
  − CurrentSessionBillableElapsedHours
)
```

Trong đó:

| Thành phần | Định nghĩa |
|------------|------------|
| **TotalEntitlementHours** | Tổng giờ khả dụng tại thời điểm `now`: gift (còn hạn) + combo inventory + `wallet_balance / pricePerHour` (hourly). Thứ tự đọc inventory theo policy Entitlement Domain; **không** trừ usage chưa settle. |
| **SettledSessionUsageHours** | `Σ (session.billable_seconds / 3600)` với mọi session của user có `settlement_status = settled`. |
| **CurrentSessionBillableElapsedHours** | Nếu user có đúng một session `status = running` **và** provider verify instance đang running: `(now − session.started_at) / 3600`. Ngược lại: **0**. |
| **roundHours** | Làm tròn 2 chữ số thập phân — thống nhất toàn hệ thống. |

### 3.2 Quy tắc áp dụng

| Quy tắc | Mô tả |
|---------|-------|
| **R1 — Single function** | Chỉ một module Remaining Time trong domain layer (Nguyên tắc 20). API/UI import — không reimplement. |
| **R2 — Read-only** | Tính Remaining **không** ghi entitlement, **không** ghi session. |
| **R3 — No tick dependency** | Remaining **không** phụ thuộc `duration_seconds`, tick counter, hay ledger events. |
| **R4 — Running gate** | `CurrentSessionBillableElapsed` chỉ > 0 khi session billable **và** provider xác nhận instance running. Tránh charge ảo khi DB lệch. |
| **R5 — Renew dùng cùng công thức** | Auto-renew threshold so sánh `RemainingHours` — **không** dùng `hours_total − hours_used` thuần. |
| **R6 — Admin dùng cùng công thức** | Màn admin hiển thị Remaining giống user — tránh hai con số. |

### 3.3 Out of credit (Auto Stop input)

```
isOutOfCredit = (RemainingHours <= 0)
             OR (planType = hourly AND walletBalance <= 0)
```

Công thức `isOutOfCredit` **derive từ** Remaining — không có nguồn riêng.

### 3.4 Over-run trước destroy

Khi Remaining ≤ 0 nhưng destroy chưa hoàn tất, `CurrentSessionBillableElapsed` **vẫn tăng** theo thời gian thực cho đến `ended_at`. Settlement **cap** theo entitlement tại thời điểm settle (policy: `min(billable_seconds, entitlement_seconds_available_at_settlement)`). Đây là **chính sách billing**, không phải reconciliation.

---

## 4. Session Lifecycle

### 4.1 Trạng thái session

```
                    ┌──────────────┐
                    │   pending    │  Session row tạo; chưa billable
                    └──────┬───────┘
                           │ provider verify RUNNING
                           ▼
                    ┌──────────────┐
         ┌─────────│   running    │◄── started_at set
         │         └──────┬───────┘
         │                │ destroy initiated
         │                ▼
         │         ┌──────────────┐
         │         │   closing    │  ended_at chưa final; chưa settled
         │         └──────┬───────┘
         │                │ provider verify DESTROYED
         │                ▼
         │    ┌─────────────────────────────┐
         │    │  closed + settlement_status │
         │    │  settled | skipped | failed │
         │    └─────────────────────────────┘
         │
         └──── repair / cancel ──► interrupted (no settlement)
```

### 4.2 Sự kiện lifecycle

| Giai đoạn | Session | Billing write? |
|-----------|---------|----------------|
| User start / provision | `pending` | **Không** |
| Provider running confirmed | `running`, `started_at = now` | **Không** — chỉ Remaining read |
| Phiên đang chạy | `running` | **Không** |
| Destroy bắt đầu | `closing` | **Không** |
| Provider destroy verified | `ended_at` set, settlement chạy | **Có** — Settlement (§6) |
| Settlement xong | `closed`, `settlement_status` | Kết thúc |
| Provision fail / cancel / orphan repair | `interrupted`, `skipped` | **Không** |

### 4.3 Quan hệ Session ↔ Machine ↔ Subscription

| Thực thể | Vai trò (Nguyên tắc 3, 4) |
|----------|---------------------------|
| **Subscription** | Quyền sử dụng, metadata gói — không đồng nghĩa máy online |
| **Machine** | Orchestration ephemeral — provision đến destroy |
| **Session** | **Đơn vị billing** — thời gian và settlement |

Một user **tối đa một** session `running` (Nguyên tắc 5).

### 4.4 Workspace (restart-only)

Workspace metadata gắn session lúc `running`. Đổi workspace (`change-environment`) chỉ metadata subscription — **không** tạo session mới; session hiện tại giữ template lúc start. Nguyên tắc 2 không đổi.

---

## 5. Auto Stop Lifecycle

### 5.1 Vai trò

Auto Stop là **chính sách sản phẩm** (Nguyên tắc 14): kết thúc phiên khi hết credit hoặc idle quá lâu. Trong SCB, Auto Stop **chỉ**:

1. **Đọc** Remaining Time (§3).
2. **Đọc** idle state (ComfyUI queue — logic idle giữ nguyên).
3. **Kích hoạt** unified destroy pipeline khi điều kiện thỏa.

Auto Stop **không** gọi Settlement, **không** trừ entitlement, **không** gọi Infrastructure Reconciliation.

### 5.2 Luồng quyết định

```
checkAutoStop(machine)
    │
    ├─ machine.status ≠ running → skip
    │
    ├─ RemainingTime() → isOutOfCredit?
    │       yes → destroy(out_of_credit)
    │
    ├─ idle state (queue empty ≥ threshold)
    │       idle ≥ warn → notify
    │       idle ≥ stop → destroy(idle_timeout)
    │
    └─ else → continue (read-only return metrics)
```

**Không có** bước `deductPerMinute` hoặc bất kỳ billing write nào.

### 5.3 Trigger

| Trigger | Tần suất | Ghi billing? |
|---------|----------|--------------|
| Status poll (client) | ~10s boot / ~30s running | **Không** — chỉ Remaining + có thể gọi checkAutoStop |
| Cron idle check | Mỗi 5 phút | **Không** |
| Frontend out-of-hours | Khi Remaining ≤ 0 | **Không** — gọi destroy API |

### 5.4 Idle vs billing

Idle timer **độc lập** Remaining. Idle stop vẫn đi destroy pipeline → provider verify → settlement cho toàn bộ `started_at`..`ended_at` (bao gồm idle period) — trừ khi chính sách sản phẩm thay đổi sau này (ghi rõ trong điều khoản).

---

## 6. Settlement Lifecycle

### 6.1 Nguyên tắc cốt lõi

> **Settlement chỉ chạy sau Provider Verification xác nhận destroy thành công.**

Điều này **đảo thứ tự** so với code hiện tại (`stopBilling` trước `destroyInstance`) và **sửa** rủi ro: trừ user khi instance Vast vẫn chạy, hoặc không trừ khi destroy chưa xác minh.

### 6.2 Thứ tự destroy pipeline (SCB)

```
Unified Destroy(reason)
    │
    1. Backup (nếu policy áp dụng)          ← Backup domain độc lập (§12)
    │
    2. Session → closing
    │
    3. Provider destroy request
    │
    4. Provider Verification → DESTROYED       ← Gate bắt buộc (§7)
    │
    5. Session.ended_at = verified_at
    │
    6. Settlement (một lần)                    ← §6.3
    │
    7. Machine → destroyed; subscription offline
```

Nếu bước 3–4 **thất bại**: session quay `running` (hoặc giữ `closing` với retry); **không** settlement; Remaining tiếp tục tính elapsed.

### 6.3 Nội dung Settlement (conceptual)

| Bước | Mô tả |
|------|-------|
| **Tính billable** | `billable_seconds = ended_at − started_at` (seconds, floor ≥ 0) |
| **Cap entitlement** | `charge_seconds = min(billable_seconds, entitlement_available_seconds)` |
| **Allocate** | gift → combo → hourly (giữ policy hiện tại) |
| **Commit** | Cập nhật `hours_used` / grant / wallet + wallet_transaction (hourly) |
| **Đánh dấu** | `settlement_status = settled`, lưu breakdown trên session |
| **Idempotent** | Settlement key = `session_id` — gọi lại không double charge (Nguyên tắc 29) |

### 6.4 Settlement skipped

| Trường hợp | `settlement_status` |
|------------|---------------------|
| Provision fail trước billable | `skipped` — không `started_at` |
| Orphan repair / interrupted | `skipped` |
| Admin comp / policy waive | `skipped` với lý do audit |
| Provider destroy verified nhưng billable = 0 | `skipped` |

### 6.5 Settlement failed

Nếu commit entitlement lỗi **sau** provider verify:

- `settlement_status = failed`
- Session có `ended_at` (instance đã destroy — user không dùng GPU)
- **Retry settlement** idempotent — **không** destroy lại provider
- Operator alert (Nguyên tắc 24)

---

## 7. Provider Verification

### 7.1 Vai trò

Provider Verification là **gate** giữa orchestration và billing. Mọi tích hợp GPU qua Adapter (Nguyên tắc 30).

### 7.2 Trạng thái verify

| Verify type | Khi gọi | Pass condition |
|-------------|---------|----------------|
| **RUNNING** | Session chuyển `pending → running` | Provider báo instance running / ready |
| **DESTROYED** | Trước Settlement | Provider báo destroyed / 404 / not found — equivalent terminated |

### 7.3 Hành vi khi verify fail

| Verify | Fail | Hành vi |
|--------|------|---------|
| RUNNING | Timeout / error | Session không billable; retry provision hoặc fail |
| DESTROYED | Instance vẫn running | **Không settlement**; retry destroy + verify |
| DESTROYED | API error | **Không settlement**; retry — operator có thể can thiệp |

### 7.4 Tách khỏi Reconciliation

Provider Verification phục vụ **một instance trong destroy path**. Infrastructure Reconciliation (§8) quét **toàn bộ** drift — hai module **không** gọi lẫn nhau.

---

## 8. Infrastructure Reconciliation

### 8.1 Mục đích

Đảm bảo **hạ tầng thực tế** khớp **trạng thái orchestration** — phục vụ chi phí provider và vận hành. **Không** thay thế billing.

### 8.2 Phạm vi

| Scan | Mô tả |
|------|-------|
| **Zombie local** | DB `running` nhưng provider không có instance |
| **Orphan provider** | Provider có instance không map user/machine hợp lệ |
| **Stale closing** | Session `closing` quá lâu không verify |
| **Destroyed mismatch** | DB destroyed nhưng provider running (drift nghiêm trọng) |

### 8.3 Hành động reconciliation

| Drift | Hành động | Settlement? |
|-------|-----------|-------------|
| Zombie local | Repair session/machine; có thể `interrupted` + skip | Chỉ nếu destroy verify sau đó |
| Orphan provider | Operator destroy provider instance | **Không** tự động settlement user |
| Stale closing | Retry destroy + verify → settlement path | Theo §6 |
| Destroyed mismatch | Alert operator; repair provider hoặc DB | Settlement **chỉ** qua destroy pipeline chuẩn |

### 8.4 Tần suất và operator

- Job định kỳ (cron) + admin manual trigger.
- Báo cáo đơn giản: danh sách drift, tuổi, user, instance_id.
- **Một người** có thể xử lý trong admin — không cần team SRE (Nguyên tắc 24).

### 8.5 Ranh giới cứng

Infrastructure Reconciliation **cấm**:

- Tính hoặc ghi Remaining Time
- Gọi Settlement trực tiếp
- Trừ wallet / hours_used ngoài destroy pipeline đã verify

---

## 9. Failure Recovery

### 9.1 Ma trận recovery

| Sự cố | Session state | Billing | Recovery |
|-------|---------------|---------|----------|
| App restart mid-session | `running` | Remaining đúng (read-only) | Tiếp tục; không replay tick |
| Destroy API fail | `running` / `closing` | Chưa settle | Retry destroy |
| Provider destroy OK, verify chưa chạy | `closing` | Chưa settle | Retry verify |
| Verify OK, settlement fail | `closing` / `failed` | Partial possible | **Retry settlement** idempotent |
| Settlement OK, DB machine update fail | `settled` | Committed | Retry status update only |
| Browser close | `running` | Remaining trên server | Cron auto-stop |
| Orphan session | `interrupted` | `skipped` | `repairUserBillingState` mở rộng |
| Reconciliation phát hiện drift | varies | **Không tự settle** | Operator / repair job |

### 9.2 Không replay tick

SCB **không** có khái niệm “missed minutes”. Recovery = **retry destroy/verify/settlement** — không rebuild từ ledger.

### 9.3 Idempotency (Nguyên tắc 29)

| Thao tác | Idempotency key |
|----------|-----------------|
| Start session / machine | user active session guard |
| Destroy | machine_id + session_id |
| Provider verify destroyed | instance_id |
| Settlement | session_id |

---

## 10. Audit Strategy

### 10.1 Mục tiêu (Nguyên tắc 24)

Một operator trả lời trong **một màn hình**:

- Phiên này chạy bao lâu?
- Trừ bao nhiêu giờ / bao nhiêu VND?
- Từ nguồn entitlement nào?
- Destroy đã verify chưa?
- Settlement status gì?

**Không** cần audit theo phút — **cần** audit theo **phiên**.

### 10.2 Audit artifacts (không event sourcing)

| Artifact | Nội dung |
|----------|----------|
| **Session row** | `started_at`, `ended_at`, `billable_seconds`, `settlement_status`, `settlement_at`, reason destroy |
| **Settlement breakdown** | Fields hoặc JSON trên session: gift_hours, combo_hours, wallet_vnd, cap applied |
| **Wallet transaction** | Một record / session hourly settled |
| **hour_grant_logs** | Admin grant actions — giữ nguyên |
| **Provider verify record** | `verified_destroyed_at`, `provider_instance_id` — trên session hoặc machine |

### 10.3 Reconciliation audit (tách biệt)

Infrastructure Reconciliation lưu **reconciliation_runs** và **drift_items** — **không** gộp vào session settlement.

### 10.4 Dispute resolution

| User hỏi | Trả lời từ |
|----------|------------|
| “Còn bao nhiêu giờ?” | Remaining (§3) — cùng công thức admin |
| “Phiên X trừ bao nhiêu?” | Session settled row |
| “Sao tắt lúc A mà ended_at B?” | Destroy pipeline: backup + verify timeline |
| “Vast còn chạy không?” | Provider verify + reconciliation drift |

**Cấm** dùng frontend cache làm bằng chứng billing.

---

## 11. Design Invariants

Các invariant **bắt buộc** — vi phạm = bug kiến trúc:

| ID | Invariant |
|----|-----------|
| **INV-1** | Một user có tối đa một session `running`. |
| **INV-2** | Remaining Time = **duy nhất** công thức §3 cho Dashboard, Auto Stop, Renew, Admin. |
| **INV-3** | **Không** billing write khi session `running`. |
| **INV-4** | **Không** `deductPerMinute`, heartbeat billing, usage ledger. |
| **INV-5** | Settlement **chỉ** sau Provider Verification DESTROYED pass. |
| **INV-6** | Mỗi session có **tối đa một** settlement committed (`settlement_status = settled`). |
| **INV-7** | Infrastructure Reconciliation **không** gọi Settlement. |
| **INV-8** | Billing Domain **không** scan toàn bộ provider — chỉ verify instance trong destroy path. |
| **INV-9** | `ended_at − started_at` là nguồn billable duy nhất — **không** `duration_seconds` SoT. |
| **INV-10** | Destroy mọi lý do hội tụ **một pipeline** (Nguyên tắc 13 — SCB ordering). |
| **INV-11** | Payment/Entitlement grant **không** phụ thuộc settlement timing (Nguyên tắc 9–11). |
| **INV-12** | Backup failure **không** block provider destroy theo policy hiện tại — settlement vẫn sau verify. |

---

## 12. Migration Strategy

Theo Nguyên tắc 18 — **additive, từng bước, rollback được**. Chỉ mô tả **phase**, không implementation.

### Phase 0 — Chuẩn bị tài liệu

- Ban hành SCB (tài liệu này).
- Cập nhật `ARCHITECTURE_PRINCIPLES.md` §8, §13 cho khớp SCB.

### Phase 1 — Remaining Time thống nhất

- Một module Remaining (§3) thay thế mọi công thức rời.
- Auto-renew, dashboard, admin dùng chung.
- **Chưa** đổi settlement order.

### Phase 2 — Tắt billing tick

- Loại bỏ `deductPerMinute` khỏi poll và cron.
- Auto Stop read-only.
- `duration_seconds` ngừng cập nhật cho billing.

### Phase 3 — Provider verify gate

- Destroy pipeline: verify destroyed **trước** settlement.
- Session states: `closing`, `settlement_status`.

### Phase 4 — Settlement session-centric

- Settlement một lần / session sau verify.
- `hours_used` / wallet commit tại settlement only.

### Phase 5 — Infrastructure Reconciliation tách domain

- Job drift + admin report.
- **Không** liên kết settlement.

### Phase 6 — Deprecation cleanup

- Loại bỏ `billing_started_at` SoT (nếu redundant).
- `duration_seconds` chỉ derived/display legacy.

### Rollback

Mỗi phase có thể rollback **độc lập** nếu chưa xóa code cũ — Phase 2 rollback = bật lại tick (không khuyến nghị dài hạn).

### Migration data

Sessions cũ có `duration_seconds` ≠ wall-clock: policy **freeze legacy** — chỉ session mới theo SCB; hoặc one-time admin reconcile — quyết định vận hành, không kỹ thuật trong tài liệu này.

---

## Phụ lục A — So sánh với tài liệu trước

| Chủ đề | Feasibility | Review (SLHB) | **SCB (official)** |
|--------|-------------|---------------|---------------------|
| Session trung tâm | ✅ | ✅ | ✅ |
| No deductPerMinute | ✅ | ✅ | ✅ |
| Heartbeat / ledger | ❌ | ✅ đề xuất | **❌ cấm** |
| Settlement timing | Session close (destroy) | Checkpoint + close | **Sau provider verify only** |
| Remaining formula | Một công thức | BillingProjection | **§3 — bắt buộc** |
| Reconciliation | Nhắc ngắn | Module bắt buộc | **Domain riêng §8** |
| Operator complexity | Thấp | Trung bình | **Thấp** |

---

## Phụ lục B — Tham chiếu code hiện tại (baseline)

Tài liệu này **không** mô tả code hiện tại. Baseline verified:

| Hiện trạng | Tài liệu |
|------------|----------|
| Per-minute tick | `BILLING_LOGIC_REVIEW.md` |
| Safety / race | `BILLING_SAFETY.md` |
| Destroy order billing trước provider | `BILLING_LOGIC_REVIEW.md` §3 — **SCB thay đổi** |

---

*GPUVietnam Session-Centric Billing Architecture v1.0 — Official. Không viết code. Không đề xuất implementation.*
