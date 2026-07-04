# CODING_RULES

**Coding Standard chính thức — GPUVietnam**

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 2026-06-28 |
| **Trạng thái** | Official |
| **Phạm vi** | Nguyên tắc lập trình — **không** bao gồm style (eslint, prettier, formatting) |

**Liên quan:** [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md) · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) · [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md) · [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md)

---

## Mục đích

Tài liệu này định nghĩa **quy tắc bắt buộc** khi viết code GPUVietnam. Mọi PR, feature, và bugfix phải tuân thủ. Vi phạm được coi là **defect kiến trúc**, không phải preference cá nhân.

**Triết lý tóm gọn:**

> Domain logic sống ở domain layer. API điều phối. UI hiển thị. Supabase là SoT persistence. Session là trung tâm billing.

---

## Phạm vi áp dụng

| Áp dụng | Không áp dụng |
|---------|----------------|
| `src/lib/**` — domain modules | Indent, semicolon, quote style |
| `src/pages/api/**` — API handlers | Prettier config |
| `src/components/**` — UI | CSS naming convention |
| `supabase/**` — schema | Commit message format |
| Cron / background jobs | |

---

## Quy tắc

### Rule 1 — Không vi phạm ARCHITECTURE_PRINCIPLES.md

**Nguyên tắc:** Mọi quyết định code phải **tuân thủ** hoặc **giải thích rõ và cập nhật tài liệu** khi ngoại lệ có chủ đích (Principle 25).

**Bắt buộc:**
- Đọc [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md) trước khi thêm module mới.
- Billing tuân Session-Centric Billing (SCB) — xem [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) cho §8 và §13 đã được hiểu lại.
- Không hot-swap workspace (Principle 2), không multi-machine per user (Principle 5), không gọi Vast trực tiếp từ domain core (Principle 6, 30).

**Cấm:**
- “Fix nhanh” phá separation Subscription / Session / Machine.
- Thêm payment logic vào billing module hoặc ngược lại mà không qua domain boundary.

**Khi nghi ngờ:** Nguyên tắc trong tài liệu kiến trúc **thắng** code cũ.

---

### Rule 2 — Không duplicate business logic

**Nguyên tắc:** Một quy tắc nghiệp vụ chỉ được **định nghĩa một lần** trong domain layer.

**Bắt buộc:**
- Logic dùng chung → gọi cùng một hàm/module domain.
- Auto-renew, Auto Stop, Dashboard API, Admin — **không** copy công thức riêng.

**Cấm:**
- Tính giờ còn lại ở API A và API B bằng hai công thức khác nhau.
- Copy-paste priority gift → combo → hourly vào nhiều file.
- Frontend “mirror” backend formula để “cho nhanh”.

**Kiểm tra:** Nếu sửa một quy tắc mà phải sửa ≥ 2 file không liên quan orchestration → **vi phạm**.

---

### Rule 3 — Remaining Time chỉ được tính tại một service

**Nguyên tắc:** `RemainingHours` theo công thức SCB §3 — **một module duy nhất** (IMPLEMENTATION_PLAN_SCB M2: `remaining-time`).

```
RemainingHours = TotalEntitlement − SettledSessionUsage − CurrentSessionBillableElapsed
```

**Bắt buộc:**
- Dashboard, Auto Stop, Renew, Admin — **chỉ import** Remaining service.
- `isOutOfCredit` derive từ Remaining service — không có nguồn riêng.

**Cấm:**
- `hours_total − hours_used` làm Remaining khi user có session đang chạy.
- Client-side countdown trừ elapsed khỏi giờ (Rule 5, 9).
- `effectiveHoursRemaining` tính lại ở handler API riêng.

**SoT Remaining:** Derived tại runtime — **không** lưu column DB làm SoT.

---

### Rule 4 — Không đọc Provider trực tiếp ngoài Provider Adapter

**Nguyên tắc:** Mọi tích hợp GPU Provider qua adapter (Principle 30). Domain core **không** import Vast client trực tiếp.

**Bắt buộc:**
- Verify RUNNING / DESTROYED — qua `provider-verify` module (IMPLEMENTATION_PLAN_SCB M4).
- `machines.js`, billing, session lifecycle gọi abstraction — không gọi HTTP Vast trực tiếp.

**Cấm:**
- Import `vast-client` trong `billing.js`, React component, hoặc API handler.
- Suy instance đã destroy chỉ từ `machines.status = destroyed` mà không verify live (Rule 13).
- Infrastructure Reconciliation gọi settlement vì thấy provider 404 (domain tách biệt).

**Ngoại lệ duy nhất:** Code **nằm trong** provider adapter implementation (`vast-provider`, `gpu/index.js` wiring).

---

### Rule 5 — Không tính Billing trong UI

**Nguyên tắc:** Billing **không** chạy trong frontend (Principle 20).

**Bắt buộc:**
- UI hiển thị `remainingHours`, `sessionStartedAt`, `settlementStatus` từ API response.
- Countdown timer = render elapsed từ `startedAt` **chỉ để hiển thị** — giá trị giờ còn lại lấy từ API poll, không tự trừ entitlement.

**Cấm:**
- `sessionStartHours − elapsed/3600` trên client làm số chính thức.
- Gọi logic trừ wallet / hours trong component.
- Frontend quyết định “hết giờ” độc lập API (có thể trigger destroy **sau khi** API confirm Remaining ≤ 0).

---

### Rule 6 — UI không chứa business rules

**Nguyên tắc:** Component React chỉ điều phốn UX — không phải nơi quyết định nghiệp vụ (Principle 20).

**Bắt buộc:**
- Enable/disable nút “Mở phiên” dựa trên **API flags** (`canStart`, `subscriptionStatus`), không tự suy điều kiện phức tạp.
- Validation nghiệp vụ (đủ giờ, gói active, một phiên) — backend.

**Cấm:**
- Hardcode threshold idle 55/60 phút trong UI để quyết định destroy (backend Auto Stop owns).
- Duplicate plan priority gift/combo trong checkout UI beyond display.
- Admin approve logic trong component (gọi API — API gọi domain).

**Cho phép UI:** Format hiển thị, i18n, layout, optimistic UX **không** thay đổi entitlement.

---

### Rule 7 — Một API chỉ có một trách nhiệm

**Nguyên tắc:** API handler điều phối — không trở thành “god endpoint” (Principle 20).

**Bắt buộc:**
- `GET /api/machines/status` — sync status, trả Remaining, **có thể** trigger Auto Stop — **không** settlement, **không** trừ entitlement.
- `POST /api/machines/destroy` — destroy pipeline — **không** renew subscription.
- Payment approve API — **không** start machine.

**Cấm:**
- Status poll ghi `hours_used` (vi phạm SCB + Rule 11).
- Dashboard/me vừa repair billing vừa process payment.
- Một route làm orchestration + domain math + provider call lẫn lộn không qua lib.

**Pattern đúng:** Handler → validate auth → gọi 1–2 domain functions → map response.

---

### Rule 8 — Không tạo singleton state ngoài Supabase

**Nguyên tắc:** Persistence và shared state qua **database** (và idempotent re-read). Monolith single deploy — **không** in-memory SoT (Principle 16, 29).

**Bắt buộc:**
- Session, machine, entitlement state — Supabase rows.
- Retry-safe: mọi worker/cron đọc lại DB, không tin cache process.

**Cấm:**
- Module-level `Map` lưu billing progress / Remaining cho user.
- Global variable đếm “đã charge phút này”.
- In-memory lock thay DB constraint (trừ transient debounce UX — không billing).

**Cho phép:** Request-scoped variables; React component state **chỉ UI** (Rule 9).

---

### Rule 9 — Không dùng localStorage làm Source of Truth

**Nguyên tắc:** Client storage **không** là bằng chứng billing hay entitlement (SCB INV, OPERATIONAL_STATE_MACHINE OP-13).

**Bắt buộc:**
- Billing anchor, hours remaining, session start — **từ API/DB**.
- localStorage chỉ được dùng cho preference UX (theme, collapse panel) — **không** billing.

**Cấm:**
- Cache `billingStartedAt` / `sessionStartHoursRemaining` để tính Remaining khi API lỗi.
- User dispute dựa trên localStorage snapshot.
- Admin không được đọc localStorage user.

**F5 / refresh:** UI hiển thị đúng server state — có thể “nhảy” — **đúng** hơn drift client.

---

### Rule 10 — Không tạo utility nếu logic thuộc Domain

**Nguyên tắc:** Không hide business logic trong `utils/` generic (Principle 20, 17).

**Bắt buộc:**
- Billing → `src/lib/gpu/` (remaining-time, settlement, session-lifecycle).
- Payment → `src/lib/wallet-deposit.js`, `plan-renew-request.js`, v.v.
- Provider → `src/lib/gpu/provider-verify.js`.
- Reconciliation → `src/lib/infrastructure/`.

**Cấm:**
- `utils/billing.ts` với `deductHours()`.
- `helpers/time.js` chứa entitlement priority allocation.
- Shared `formatX` utility file trộn format + business cap logic.

**Phân biệt:**
| Thuộc domain | Thuộc utility thật |
|--------------|-------------------|
| Remaining formula | Format giờ hiển thị 2 decimal |
| Settlement allocate | Parse ISO date |
| Session state transition | String slugify |

---

### Rule 11 — Session là đơn vị nghiệp vụ duy nhất của Billing

**Nguyên tắc:** SCB — billing gắn `gpu_sessions`, không per-minute tick, không machine counter SoT (SESSION_CENTRIC_BILLING_ARCHITECTURE §1).

**Bắt buộc:**
- Billable time = `started_at` … `ended_at` trên session.
- Entitlement commit **chỉ** tại Settlement gắn `session_id`.
- Machine `billing_started_at` / `duration_seconds` — denormalize hoặc deprecated; **không** SoT billing math.

**Cấm:**
- `deductPerMinute()` hoặc heartbeat billing (IMPLEMENTATION_PLAN_SCB M5).
- Trừ `hours_used` trong lúc session `running`.
- Billing trên `machines` row without session link.
- Per-machine billing counter làm SoT.

**Đúng:** Session `running` → Remaining read-only → Session `closed` + Settlement → entitlement write.

---

### Rule 12 — Settlement phải Idempotent

**Nguyên tắc:** Gọi settle nhiều lần **một kết quả** (Principle 29, OPERATIONAL_STATE_MACHINE OP-7).

**Bắt buộc:**
- Idempotency key = `session_id` (SCB §9.3).
- Retry settlement sau `failed` — không double charge wallet / hours.
- `settlement_status = settled` → mọi lần gọi sau là no-op.

**Cấm:**
- `hours_used += X` blind read-modify-write không check settled.
- Hai concurrent destroy cùng settle một session không guard.
- Tạo hai wallet_transactions cho cùng session hourly.

**Kiểm tra:** Gọi `settleSession()` 2 lần liên tiếp — entitlement delta chỉ một lần.

---

### Rule 13 — Provider Verification phải hoàn thành trước Settlement

**Nguyên tắc:** OPERATIONAL_STATE_MACHINE OP-1, SCB §6 — **không settlement** nếu instance chưa verify destroyed.

**Bắt buộc:**
- Destroy pipeline order: backup → closing → provider destroy → **verify DESTROYED** → `ended_at` → settlement (IMPLEMENTATION_PLAN_SCB M7).
- Ghi `verified_destroyed_at` trước hoặc cùng settlement gate.

**Cấm:**
- `stopBilling()` / settlement trước `destroyInstance()`.
- Settlement khi provider vẫn báo `running`.
- Tin `machines.status = destroyed` local khi Vast còn instance — verify bắt buộc.

**Rollback:** Verify fail → session có thể về `running`; **không** settlement.

---

### Rule 14 — Không được bypass Operational State Machine

**Nguyên tắc:** Mọi transition phải khớp [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md) — không shortcut state.

**Bắt buộc:**
- Session: `pending` → `running` → `closing` → `closed` | `interrupted`.
- Machine: thêm `closing` trước `destroyed`.
- Settlement: `awaiting_verify` → `pending` → `settled` | `skipped` | `failed`.
- Unified destroy pipeline cho mọi lý do (user, idle, out_of_credit, admin).

**Cấm:**
- Nhảy `running` → `closed` bỏ qua `closing` + verify.
- Admin SQL set `settlement_status=settled` không qua domain (trừ emergency ops có audit).
- Tạo session `running` khi subscription `pending_payment`.
- Reconciliation tự ý settle (cross-domain forbidden).

**Khi sửa code:** Đối chiếu Allowed / Forbidden transitions trong OPERATIONAL_STATE_MACHINE.

---

### Rule 15 — Mọi thay đổi Domain phải cập nhật tài liệu nếu ảnh hưởng kiến trúc

**Nguyên tắc:** Tài liệu kiến trúc là SoT triết lý (Principle 25). Code lệch tài liệu = bug process.

**Bắt buộc cập nhật tài liệu khi:**
- Thêm/sửa state machine transition.
- Đổi Remaining formula hoặc settlement policy.
- Thêm domain mới hoặc ranh giới module.
- Sửa destroy pipeline order.
- Thêm ngoại lệ Architecture Principles.

**Tài liệu cần xem:**
| Thay đổi | Cập nhật |
|----------|----------|
| Billing / Session | `SESSION_CENTRIC_BILLING_ARCHITECTURE.md` |
| States / transitions | `OPERATIONAL_STATE_MACHINE.md` |
| Triết lý sản phẩm | `ARCHITECTURE_PRINCIPLES.md` |
| Implementation scope | `IMPLEMENTATION_PLAN_SCB.md` |
| Extension / adapter | `EXTENSION_POINTS.md` |

**Cấm:**
- Merge code thay đổi entitlement logic mà không cập nhật doc tương ứng.
- “Doc sau” với thay đổi kiến trúc — doc **cùng PR** hoặc trước.

**Không cần doc:** Bugfix thuần kỹ thuật không đổi behavior nghiệp vụ (typo, crash null check) — ghi rõ trong PR nếu cần.

---

## Ma trận Rule × Layer

| Rule | Domain `lib/` | API | UI | Cron |
|------|---------------|-----|-----|------|
| 1 Principles | ● | ● | ● | ● |
| 2 No duplicate | ● | ○ | ○ | ● |
| 3 Remaining service | ● | ○ | — | ○ |
| 4 Provider adapter | ● | ○ | — | ○ |
| 5 No billing UI | — | — | ● | — |
| 6 No business UI | — | ○ | ● | — |
| 7 Single API duty | — | ● | — | ○ |
| 8 No singleton SoT | ● | ○ | — | ● |
| 9 No localStorage SoT | — | — | ● | — |
| 10 No utils domain | ● | ○ | — | — |
| 11 Session billing | ● | ○ | — | ● |
| 12 Settlement idempotent | ● | ○ | — | — |
| 13 Verify before settle | ● | ○ | — | — |
| 14 State machine | ● | ● | ○ | ● |
| 15 Update docs | ● | ● | ○ | ● |

● = áp dụng trực tiếp · ○ = áp dụng gián tiếp · — = ít / không áp dụng

---

## Checklist trước khi merge

Dùng cho self-review và code review:

- [ ] **R1** Tuân ARCHITECTURE_PRINCIPLES + SCB
- [ ] **R2** Không duplicate business logic đã có trong domain
- [ ] **R3** Remaining chỉ qua Remaining service
- [ ] **R4** Provider chỉ qua adapter / provider-verify
- [ ] **R5–R6** UI không tính billing / business rules
- [ ] **R7** API handler mỏng, một trách nhiệm
- [ ] **R8** Không in-memory billing state
- [ ] **R9** Không localStorage SoT
- [ ] **R10** Logic mới trong domain module, không utils
- [ ] **R11** Billing gắn session; không tick
- [ ] **R12** Settlement idempotent
- [ ] **R13** Verify destroyed trước settlement
- [ ] **R14** State transitions khớp OPERATIONAL_STATE_MACHINE
- [ ] **R15** Doc kiến trúc cập nhật nếu đổi domain

---

## Vi phạm thường gặp (anti-patterns)

| Anti-pattern | Rule vi phạm |
|--------------|--------------|
| `deductPerMinute` trong status poll | 1, 11, 14 |
| Dashboard client trừ giờ theo timer | 2, 3, 5, 9 |
| `getHoursRemaining(subscription)` cho Auto-renew | 2, 3 |
| `stopBilling` trước Vast destroy | 13, 14 |
| Import Vast API trong billing.js | 4 |
| `utils/deduct.ts` | 10, 11 |
| Map global “sessionsBeingBilled” | 8 |
| localStorage billing anchor | 9 |
| Status API vừa sync vừa approve payment | 7 |
| Reconciliation gọi settle | 4, 11, 14 |
| Sửa settlement cap không cập nhật doc | 15 |

---

## Quan hệ với Implementation Plan

[IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) mô tả **thứ tự triển khai** để codebase tuân các rule này. Coding Rules là **chuẩn vĩnh viễn** sau khi SCB hoàn tất — không thay thế architecture docs.

| Module (plan) | Rules chính |
|---------------|-------------|
| `remaining-time.js` (M2) | 2, 3 |
| `session-lifecycle.js` (M3) | 11, 14 |
| `provider-verify.js` (M4) | 4, 13 |
| `settlement.js` (M6) | 11, 12, 13 |
| Destroy pipeline (M7) | 13, 14 |
| Frontend (M11) | 5, 6, 9 |

---

## Cập nhật tài liệu

Chỉ sửa CODING_RULES khi **bổ sung hoặc làm rõ nguyên tắc lập trình** — không duplicate nội dung architecture. Mọi thay đổi ghi version và ngày ở đầu file.

Khi rule mới mâu thuẫn ARCHITECTURE_PRINCIPLES — **sửa Principles trước**, rồi cập nhật CODING_RULES (Rule 15).

---

*GPUVietnam Coding Rules v1.0 — Official. Nguyên tắc lập trình, không style guide.*
