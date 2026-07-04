# SESSION_BASED_BILLING_FEASIBILITY

Tài liệu **thiết kế và đánh giá khả thi** mô hình **Session-Based Billing** so với toàn bộ nghiệp vụ billing hiện có của GPUVietnam.

**Quy ước:**
- Mô tả mô hình đề xuất và so sánh với **hiện trạng code** (xem `docs/BILLING_LOGIC_REVIEW.md`, `docs/BILLING_SAFETY.md`).
- **Không đề xuất implementation.**
- **Không sửa code.**
- Phần chưa xác minh từ code ghi **UNKNOWN**.

---

## 1. Mô hình đề xuất — Session-Based Billing

### 1.1 Nguyên tắc

| Nguyên tắc | Ý nghĩa |
|------------|---------|
| Billing **không** cập nhật theo phút | Không có tick định kỳ ghi ledger trong lúc phiên chạy |
| **Không** có `deductPerMinute()` | Loại bỏ cơ chế charge incremental theo phút |
| **Không** có `duration_seconds` là nguồn sự thật | Thời lượng phiên suy ra từ timestamp, không từ counter cộng dồn |
| Một Session chỉ có `started_at`, `ended_at` | Session là đơn vị kế toán thời gian |
| Tổng thời gian sử dụng = tổng từ các Session | Usage aggregate từ lịch sử session + phiên đang mở |
| Dashboard: `Remaining = Total Entitlement − Closed Sessions Used − Current Session Elapsed` | Remaining là **derived**, không phụ thuộc counter per-minute |
| Auto Stop **chỉ tính toán (read-only)** | Không ghi billing mỗi phút khi kiểm tra hết credit / idle |

### 1.2 Khái niệm cốt lõi

```
Total Entitlement     = tổng quyền sử dụng khả dụng (combo / gift / wallet→giờ)
Closed Sessions Used  = Σ (ended_at − started_at) của các session đã đóng, quy đổi giờ
Current Session Elapsed = now − started_at của session đang running (nếu có)
Remaining             = Total Entitlement − Closed Sessions Used − Current Session Elapsed
```

**Session đóng:** khi destroy machine, auto-stop, hoặc settle orphan — ghi `ended_at`, áp dụng deduction credit **một lần** cho toàn bộ thời lượng phiên (suy ra từ `started_at` / `ended_at`).

**Session đang chạy:** chỉ có `started_at`; `ended_at = null`; elapsed tính read-only cho dashboard và auto-stop.

### 1.3 So sánh với mô hình hiện tại

| Khía cạnh | Hiện tại (verified) | Session-Based (đề xuất) |
|-----------|---------------------|-------------------------|
| Charge trong lúc chạy | `deductPerMinute()` — full minute chunks | **Không** — zero write |
| Theo dõi đã charge | `gpu_sessions.duration_seconds` (counter) | **Không dùng làm SoT** — derive từ timestamps |
| Settlement | `stopBilling()` — remainder giây lẻ | Session close — một lần từ `ended_at − started_at` |
| Remaining runtime | `effectiveHoursRemaining = totalHours − unbilledHours` (`unbilled = billable − duration_seconds`) | Công thức dashboard ở §1.1 |
| Auto Stop prelude | `deductPerMinute()` rồi `getBillingStatus()` | Chỉ `getBillingStatus()` read-only |
| Race deduct concurrent | **UNSAFE** (poll + cron) — `BILLING_SAFETY.md` | **Giảm** — không còn concurrent tick writes |
| Billing anchor | `machines.billing_started_at` | **Có thể** gắn với `gpu_sessions.started_at` — xem §3 |

### 1.4 Mâu thuẫn với Architecture Principles

`docs/ARCHITECTURE_PRINCIPLES.md` **Nguyên tắc 8** (v1.1):

> Billing luôn gắn với thời gian sử dụng thực, tính theo đơn vị thời gian **rời rạc (phút)**. Giờ/quota bị **trừ dần** trong khi phiên active.

Session-Based Billing **mâu thuẫn trực tiếp** với nguyên tắc 8: không trừ dần theo phút, không billing tick. Nếu áp dụng mô hình mới, nguyên tắc 8 cần **sửa hoặc ghi ngoại lệ có chủ đích** — nằm ngoài phạm vi tài liệu này.

Nguyên tắc 8 **vẫn tương thích** về mặt ý nghĩa sản phẩm: billing gắn thời gian sử dụng thực — chỉ khác **thời điểm ghi** (cuối session vs mỗi phút).

---

## 2. Domain Model — Thay đổi cần thiết (khái niệm)

Đánh giá **ở mức domain**, không phải implementation.

| Thực thể / Field | Hiện tại | Session-Based |
|------------------|----------|---------------|
| `gpu_sessions.started_at` | Có — anchor billing | **SoT** thời gian phiên |
| `gpu_sessions.ended_at` | Set khi finalize | **SoT** kết thúc; bắt buộc khi session đóng |
| `gpu_sessions.duration_seconds` | SoT giây đã charge | **Derived hoặc deprecated** — không SoT |
| `machines.billing_started_at` | SoT mốc charge | **Redundant hoặc denormalized** copy của `session.started_at` |
| `subscriptions.hours_used` | Tăng incremental qua `applyBillingDeduction` | **Derived từ closed sessions** hoặc cập nhật **một lần** khi session đóng |
| `manual_hour_grants.hours_used` | Tương tự subscription | Tương tự — settlement tại session close |
| `users.wallet_balance` | Trừ incremental theo phút (hourly) | Trừ **một lần** khi session đóng |
| `wallet_transactions` | Insert mỗi lần `chargeWalletForHours` | **Ít bản ghi hơn** — một (hoặc vài) tx / session thay vì nhiều tx / phút |
| `user_plan_inventory.hours_remaining` | Sync từ `hours_total − hours_used` | Vẫn derived; nguồn usage đổi sang session aggregate |
| Per-minute billing module | `deductPerMinute`, `getUnbilledSeconds` | **Loại bỏ** khỏi domain |

**Ledger mới (khái niệm):** Session là đơn vị audit. Mỗi session đóng = một sự kiện settlement duy nhất cho thời lượng `(ended_at − started_at)`.

---

## 3. Đánh giá theo nghiệp vụ

Ký hiệu:
- **Hỗ trợ:** ✅ Có / ⚠️ Có với điều kiện / ❌ Không / ❓ UNKNOWN
- **Domain:** Có / Một phần / Không
- **Mất tính năng:** None / Có (mô tả)
- **Edge case:** Liệt kê rủi ro mới hoặc thay đổi hành vi

---

### 3.1 Subscription

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có.** Subscription (quyền sử dụng, `hours_total`, metadata phiên) tách khỏi session theo nguyên tắc 3 — mô hình mới không phá separation đó. |
| **Có cần thay đổi Domain không?** | **Có.** `subscriptions.hours_used` hiện là SoT combo usage, tăng qua `deductHoursFromInventoryPlan()` mỗi tick/stop. Session-Based cần định nghĩa lại: `hours_used` = usage từ **closed sessions** gắn subscription đó, hoặc sync một lần khi session đóng. |
| **Có mất tính năng nào không?** | **Có (hành vi):** Trừ giờ **incremental trong DB** trong lúc phiên chạy — thay bằng trừ **một lần** khi đóng session. UI dashboard vẫn countdown nhờ công thức `Remaining` (đã có hướng tương tự ở frontend). |
| **Edge case** | • **Renew / mua gói mới** trong lúc session đang chạy: `Total Entitlement` tăng ngay; `Remaining` nhảy lên — hợp lý nếu công thức thống nhất.<br>• **Auto-renew** (`auto-renew.js`) dùng `hours_total − hours_used` trên subscription — **lệch** nếu `hours_used` chưa gồm phiên đang chạy; cần trừ `Current Session Elapsed` hoặc dùng cùng công thức Remaining.<br>• **Multi inventory** (`user_plan_inventory`): thứ tự gift → combo → hourly vẫn cần khi **allocate** usage của một session đóng — logic priority không biến mất, chỉ dời thời điểm áp dụng.<br>• **`server_status`** (online/offline/provisioning) không tham gia billing math — **không đổi**. |

---

### 3.2 Gift Hours

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có.** Gift (`manual_hour_grants`) là nguồn entitlement riêng, priority cao nhất khi deduct. |
| **Có cần thay đổi Domain không?** | **Có.** `manual_hour_grants.hours_used` hiện incremental; chuyển sang cập nhật khi session đóng (allocate gift trước combo/wallet). |
| **Có mất tính năng nào không?** | **Không** về mặt sản phẩm (admin cấp giờ, user tiêu thụ). **Có** về audit granularity: không còn ledger entry theo phút cho gift. |
| **Edge case** | • Gift **hết hạn** (`expires_at`) giữa session: cần quy tắc — tính toàn session theo entitlement lúc **start** hay **close**? Hiện tại deduct đọc inventory **tại thời điểm charge** — hành vi có thể khác.<br>• **Revoke grant** khi session đang chạy: read-only Remaining phải phản ánh grant mới.<br>• Admin **hour_grant_logs** (`hour-grants.js`) ghi thao tác grant — **độc lập** session billing; không mất. |

---

### 3.3 Combo Hours

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có.** Combo qua `subscriptions` + `user_plan_inventory` (`plan_type` combo). |
| **Có cần thay đổi Domain không?** | **Có.** Giống Subscription — settlement session-end; `syncUserPlanInventory()` vẫn cần nhưng nguồn `hours_used` đổi. |
| **Có mất tính năng nào không?** | **Có (hành vi billing):** Làm tròn **phút đủ** trong lúc chạy (`floor(unbilled/60)*60`) — Session-Based charge **đúng elapsed** (giây/phút lẻ) tại close → user có thể bị charge **nhiều hơn một chút** so với pattern "chỉ full phút cho đến stop". |
| **Edge case** | • **Combo bonus / renew bonus** (`computeRenewQuote`) — entitlement side, không ảnh hưởng session math.<br>• **`expires_at` subscription** mid-session: tương tự gift expiry.<br>• Session ghi `billing` / `plan` metadata — combo1 vs combo2 vẫn lưu trên `gpu_sessions` row. |

---

### 3.4 Wallet Hours

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ⚠️ **Có với điều kiện.** Hourly trừ `wallet_balance` + `wallet_transactions`; công thức VND `Math.round(hours * pricePerHour)` vẫn áp dụng được **một lần** tại session close. |
| **Có cần thay đổi Domain không?** | **Có.** Không còn nhiều `wallet_transactions` type `payment` trong lúc chạy; một settlement / session. `getBillingStatus` hourly path đổi từ `unbilledHours` sang `Current Session Elapsed`. |
| **Có mất tính năng nào không?** | **Có:** Lịch sử giao dịch ví **theo phút** (nếu coi là tính năng) — thay bằng **theo phiên**. Dashboard wallet page hiển thị ít dòng hơn nhưng rõ ràng hơn. |
| **Edge case** | • **Wallet cạn** mid-session: auto-stop read-only `Remaining <= 0` hoặc `walletBalance <= 0` — vẫn cần destroy; **không** deduct DB từng phút → user có thể "nợ" thời gian nếu auto-stop trễ (cron 5 phút, poll 30s) — **tương tự rủi ro hiện tại** nhưng settlement cuối session phải xử lý `appliedCharge = min(balance, walletCharge)`.<br>• **Làm tròn VND:** một lần ở cuối session vs nhiều lần round — **tổng có thể lệch vài VND** so với per-minute.<br>• **Auto top-up** (`user-settings`) — entitlement side; sau top-up Remaining tăng ngay (read-only). |

---

### 3.5 Renew

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ⚠️ **Có với điều kiện.** `processPlanRenew`, `approvePlanRenewRequest`, proactive renew — thêm entitlement, **không** phụ thuộc billing tick. |
| **Có cần thay đổi Domain không?** | **Một phần.** `evaluateAutoRenew` / `getHoursRemaining` đọc `subscription.hours_total − hours_used` **không** trừ phiên đang chạy — **lệch** với công thức Remaining mới. Cần thống nhất metric "giờ còn lại" trên toàn hệ thống. |
| **Có mất tính năng nào không?** | **Không** về renew / bonus / chuyển khoản. |
| **Edge case** | • Renew khi `server_status = online`: entitlement tăng; session hiện tại **không** tự chia lại usage đã elapsed — hợp lý.<br>• **Auto-renew threshold** (5–20h): nếu chỉ nhìn `hours_used` DB mà không trừ current session → renew **sớm** hoặc **muộn**.<br>• **Manual transfer renew** (`auto_renew_method = transfer`) — không ảnh hưởng session model. |

---

### 3.6 Auto Stop

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có — phù hợp nguyên tắc đề xuất.** `checkAutoStop` hiện gọi `deductPerMinute` trước `getBillingStatus` (`auto-stop.js`) — mô hình mới **bỏ bước ghi**, chỉ read-only tính Remaining. |
| **Có cần thay đổi Domain không?** | **Có (nhỏ).** `isOutOfCredit(billing)` giữ nguyên ý nghĩa; input `effectiveHoursRemaining` tính theo công thức session. |
| **Có mất tính năng nào không?** | **Không.** Out-of-credit destroy vẫn hoạt động. |
| **Edge case** | • **Độ trễ phát hiện hết giờ:** cron 5 phút + poll 30s — user có thể vượt entitlement vài phút trước destroy; **không deduct DB trong lúc đó** → settlement cuối session phải cap theo entitlement thực (giống `min(available, need)` hiện tại).<br>• **Frontend** cũng destroy khi `outOfHours` (`DashboardOverview.tsx`) — cần cùng công thức Remaining.<br>• Bỏ `deductPerMinute` trong auto-stop **giảm race** poll+cron — cải thiện so với `BILLING_SAFETY.md`. |

---

### 3.7 Idle Stop

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có.** Idle (`idle_started_at`, ComfyUI queue, 55/60 phút) **độc lập** billing tick. |
| **Có cần thay đổi Domain không?** | **Không** cho idle logic. Chỉ bỏ `deductPerMinute` ở đầu `checkAutoStop`. |
| **Có mất tính năng nào không?** | **Không.** |
| **Edge case** | • Idle destroy vẫn gọi `destroyUserMachine` → session close + settlement — **một lần** charge cho toàn idle period (verified destroy path gọi `stopBilling` today).<br>• Queue unreachable → **không stop** (verified) — billing session vẫn chạy elapsed; Remaining tiếp tục giảm read-only. |

---

### 3.8 Restart-only Workspace

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có.** Nguyên tắc 2: workspace đổi sau khi kết thúc phiên. `change-environment.js` chỉ cập nhật `subscriptions.env_*`; `requiresRestart: true` khi machine online. |
| **Có cần thay đổi Domain không?** | **Không.** |
| **Có mất tính năng nào không?** | **Không.** |
| **Edge case** | • Session record lưu `template` lúc **start billing** — phiên cũ giữ env cũ; phiên mới sau restart có env mới — **đúng semantics**.<br>• User đổi env rồi **không** restart: subscription metadata đổi nhưng ComfyUI env thực tế không đổi — **không liên quan billing** (verified). |

---

### 3.9 Machine Destroy

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có — tự nhiên hơn.** Destroy = đóng session (`ended_at`) + settlement một lần. Hiện tại: `stopBilling()` + `finalizeGpuSession()` + `clearMachineBillingFields()`. |
| **Có cần thay đổi Domain không?** | **Có.** Thay cặp tick+remainder bằng single settlement từ timestamps. `duration_seconds` không còn vai trò reconcile tick vs stop. |
| **Có mất tính năng nào không?** | **Không** về destroy / backup / Vast teardown. **Có** pattern `skipBilling` / `settleWithoutCharge` — vẫn cần path **không charge** (provision fail, orphan) — domain giữ, implementation khác. |
| **Edge case** | • **`skipBilling: true`** (provision error, stale) — session `interrupted`, `ended_at` set, **không** allocate usage — verified orphan path.<br>• **Double destroy** idempotent — `BILLING_SAFETY.md` **SAFE**; session-based càng rõ: session đã có `ended_at` → skip settlement.<br>• **Partial failure** sau deduct credit nhưng trước `ended_at` — rủi ro giảm vì **một** transaction settlement thay vì tick + stop.<br>• **`computeBillableDurationSeconds` cap** qua `machine.created_at` — hiện có; session model cần quy tắc tương đương (không bill trước running / cap boot). |

---

### 3.10 Manual Payment

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có.** Payment domain tách billing (nguyên tắc 9–11): `pending_payment` → admin approve, wallet deposit approve, plan renew approve — **chỉ tăng entitlement**. |
| **Có cần thay đổi Domain không?** | **Không** cho luồng thanh toán. **Một phần** cho hiển thị "giờ còn lại" sau approve nếu user đang có session — dùng công thức Remaining thống nhất. |
| **Có mất tính năng nào không?** | **Không.** |
| **Edge case** | • Approve subscription khi user đang online: entitlement tăng; current session elapsed không reset — **đúng**.<br>• Wallet deposit mid-session: balance tăng; hourly Remaining tăng ngay (read-only). |

---

### 3.11 Billing Audit

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ⚠️ **Có — cải thiện khả năng audit session**, nhưng **thay đổi** hình thái audit wallet/combo. |
| **Có cần thay đổi Domain không?** | **Có.** Hiện không có bảng "billing audit" thống nhất; có:<br>• `hour_grant_logs` — admin gift audit<br>• `wallet_transactions` — nạp + **payment mỗi deduct** (hourly)<br>• `subscriptions.hours_used` — aggregate combo<br>Session-Based: **session row + một settlement event** là audit trail chính cho usage. |
| **Có mất tính năng nào không?** | **Có (granularity):** Không còn audit **theo phút** trên wallet/combo ledger. Admin không truy vết "phút X trừ bao nhiêu" — chỉ **theo phiên**. |
| **Edge case** | • **Reconcile:** `hours_used` aggregate vs `Σ session usage` — cần invariant rõ; hiện `duration_seconds` có thể lệch wall-clock (`gpu-sessions.js` đã fallback `ended_at − started_at`).<br>• **Orphan session** closed no charge — vẫn cần audit status `interrupted`. |

---

### 3.12 Session History

| Tiêu chí | Đánh giá |
|----------|----------|
| **Có hỗ trợ không?** | ✅ **Có — mô hình phù hợp nhất.** `GET /api/user/sessions`, `mapSessionRow()` — duration hiển thị đã fallback `ended_at − started_at` khi thiếu `duration_seconds`. |
| **Có cần thay đổi Domain không?** | **Một phần.** `duration_seconds` trở thành optional/cache; **SoT** = timestamps. `buildLiveSessionFromSubscription` dùng `activated_at` — **lệch** với `billing_started_at` / session thực — **UNKNOWN** mức độ trên production; session-based nên thống nhất live session từ `gpu_sessions` running row. |
| **Có mất tính năng nào không?** | **Không.** Metrics (VRAM, output) không phụ thuộc billing tick. |
| **Edge case** | • **Running session** trong history: elapsed = `now − started_at` (verified `mapSessionRow`).<br>• **Pagination** với live row synthetic (`sessions.js`) — logic giữ; nguồn live nên là DB session running thay vì subscription heuristic.<br>• Session **không có `ended_at`** (crash trước finalize): repair/orphan — cần quy tắc usage (0 hoặc cap đến last heartbeat) — **UNKNOWN** policy. |

---

## 4. Tổng hợp

### 4.1 Ma trận hỗ trợ

| Nghiệp vụ | Hỗ trợ | Domain change | Mất tính năng |
|-----------|--------|---------------|---------------|
| Subscription | ✅ | Có | Trừ giờ incremental DB trong lúc chạy |
| Gift Hours | ✅ | Có | Audit theo phút (nếu có) |
| Combo Hours | ✅ | Có | Làm tròn full-phút trong lúc chạy |
| Wallet Hours | ⚠️ | Có | Lịch sử ví theo phút |
| Renew | ⚠️ | Một phần | — |
| Auto Stop | ✅ | Nhỏ | — |
| Idle Stop | ✅ | Không | — |
| Restart-only Workspace | ✅ | Không | — |
| Machine Destroy | ✅ | Có | — |
| Manual Payment | ✅ | Không / một phần display | — |
| Billing Audit | ⚠️ | Có | Granularity theo phút |
| Session History | ✅ | Một phần | — |

### 4.2 Lợi ích mô hình (so với hiện trạng)

| Lợi ích | Căn cứ |
|---------|--------|
| **Single SoT thời gian** | `started_at` / `ended_at` thay dual SoT (`billing_started_at` + `duration_seconds`) |
| **Giảm race double-charge** | Không `deductPerMinute` concurrent — `BILLING_SAFETY.md` §4–§5 |
| **Dashboard công thức rõ** | Khớp hướng UI đã dùng (`sessionStartHours − elapsed`) |
| **Session history nhất quán** | Duration = wall-clock, không lệch counter |
| **Auto Stop đúng nguyên tắc read-only** | Bỏ side-effect billing trong idle/credit check |

### 4.3 Rủi ro / trade-off chính

| Rủi ro | Mô tả |
|--------|--------|
| **Mâu thuẫn nguyên tắc 8** | Architecture Principles v1.1 yêu cầu billing theo phút trừ dần |
| **Settlement một lần** | Lỗi tại session close ảnh hưởng toàn phiên — cần idempotency mạnh hơn (nguyên tắc 29 vẫn áp dụng) |
| **Metric "giờ còn lại" phân mảnh** | `auto-renew`, `dashboard/me`, `getBillingStatus`, frontend cache — phải cùng công thức Remaining |
| **Over-run trước destroy** | Không ghi DB trong lúc chạy → elapsed read-only có thể vượt entitlement vài phút; settlement phải cap |
| **Làm tròn khác per-minute** | Combo giây lẻ + wallet VND tổng session ≠ tổng nhiều lần round nhỏ |
| **Entitlement expiry mid-session** | Cần policy rõ — hiện deduct đọc inventory **tại charge** |

### 4.4 Edge case xuyên suốt (chưa có policy rõ trong đề xuất)

1. **Phiên đang chạy, server crash trước khi ghi `ended_at`** — usage và Remaining **UNKNOWN** cho đến khi repair.
2. **Hai nguồn "live session"** — `gpu_sessions` running vs `buildLiveSessionFromSubscription` — cần một nguồn.
3. **`machines.billing_started_at` vs `gpu_sessions.started_at`** — có thể lệch nếu giữ cả hai; session-based nên một anchor.
4. **Concurrent destroy + status poll** — destroy idempotent (**SAFE**); settlement chỉ một lần nếu guard `ended_at IS NULL`.
5. **Trial / hourly / combo mix** — priority allocation khi **đóng** session dài — cần giữ thứ tự gift → combo → hourly.
6. **Cron không chạy** (ngoài Vercel) — auto-stop trễ; read-only Remaining vẫn đúng trên poll client.

---

## 5. Kết luận khả thi

| Câu hỏi | Kết luận |
|---------|----------|
| Mô hình Session-Based Billing **có khả thi** với nghiệp vụ hiện có? | **Có** — tất cả 12 nghiệp vụ đều **có thể** được phục vụ; không có nghiệp vụ nào **bị loại bỏ hoàn toàn**. |
| Mức thay đổi Domain | **Trung bình–cao** ở lớp billing/settlement và metric Remaining; **thấp** ở payment, idle, workspace, destroy lifecycle. |
| Tính năng mất rõ ràng nhất | Billing **incremental theo phút** (DB + wallet tx granularity); hành vi làm tròn **full-phút trong lúc chạy**. |
| Cải thiện rõ ràng nhất | An toàn concurrent (`BILLING_SAFETY`), đơn giản SoT thời gian, khớp session history và dashboard countdown. |
| Blocker | **Mâu thuẫn Architecture Principles §8** — cần quyết định sản phẩm trước khi coi là mô hình chính thức. |

---

## 6. Tham chiếu code (hiện trạng)

| Chủ đề | File |
|--------|------|
| Per-minute billing | `src/lib/gpu/billing.js` — `deductPerMinute`, `stopBilling`, `getBillingStatus` |
| Auto stop + deduct | `src/lib/gpu/auto-stop.js` — `checkAutoStop` |
| Destroy + billing | `src/lib/machines.js` — `destroyUserMachine` |
| Session history | `src/pages/api/user/sessions.js`, `src/lib/gpu-sessions.js` |
| Auto renew metric | `src/lib/auto-renew.js` — `getHoursRemaining` |
| Gift audit | `src/pages/api/admin/hour-grants.js` — `hour_grant_logs` |
| Workspace restart-only | `src/pages/api/user/change-environment.js` |
| Schema session | `supabase/gpu-sessions.sql` |
| Review hiện trạng | `docs/BILLING_LOGIC_REVIEW.md`, `docs/BILLING_SAFETY.md` |
| Architecture | `docs/ARCHITECTURE_PRINCIPLES.md` §8, §29 |

---

*Tài liệu đánh giá khả thi. Không đề xuất implementation. Không mô tả code cần viết.*
