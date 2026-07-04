# BILLING_SAFETY

Tài liệu trả lời câu hỏi:

> **Hệ thống Billing hiện tại có thể bị tính thiếu, tính thừa hoặc double charge không?**

Mọi kết luận dựa trên code hiện có (`src/lib/gpu/billing.js`, `machines.js`, `auto-stop.js`, API routes, schema SQL) và `docs/BILLING_LOGIC_REVIEW.md`.  
**Không suy đoán.** Phần chưa chứng minh ghi **UNKNOWN**.

**Quy ước đánh giá:** `SAFE` | `UNSAFE` | `UNKNOWN`

---

## 1. Billing Safety Philosophy

### Triết lý sản phẩm (ARCHITECTURE_PRINCIPLES.md)

Nguyên tắc 8: Billing gắn **thời gian sử dụng thực**, trừ dần theo phút khi phiên active.  
Nguyên tắc 29: Start / Stop / Destroy **phải idempotent** khi retry.

### Hiện trạng code (verified)

| Mục tiêu an toàn | Hiện trạng |
|------------------|------------|
| Không double charge | **Thiết kế hướng tới** qua `gpu_sessions.duration_seconds` + `remainder` tại stop; **không có lock/transaction** — xem §4–§5 |
| Không mất thời gian sử dụng | **Phần lớn** remainder được charge tại `stopBilling()`; có path **cố ý không charge** (`skipBilling`, `settleWithoutCharge`) — xem §9 |
| Không trừ quá giờ thực tế | **Tuần tự** thì công thức khớp billable duration; **đồng thời** hoặc **wallet hết** có thể lệch — xem §8–§9 |
| Khôi phục sau restart | State lưu DB (`duration_seconds`, `hours_used`, `wallet_balance`); billing tiếp tục khi poll/cron chạy lại — **SAFE** về persistence |
| Một sự kiện không charge nhiều lần | **Chưa chứng minh** dưới concurrency — **UNKNOWN / UNSAFE** tùy tình huống |

---

## 2. Source of Truth

### Có một hay nhiều SoT?

**Nhiều field phối hợp**, không có single atomic ledger:

| Concern | Source of Truth | Ghi chú |
|---------|-----------------|---------|
| **Running time (billable)** | `machines.billing_started_at` + `machines.created_at` | `computeBillableDurationSeconds()` |
| **Giây đã charge trong phiên** | `gpu_sessions.duration_seconds` | Comment: "already-billed seconds (per-minute ticks)" |
| **Giờ combo/gift đã dùng** | `subscriptions.hours_used` / `manual_hour_grants.hours_used` | Ghi bởi `deductHoursFromInventoryPlan()` |
| **Wallet đã trừ (hourly)** | `users.wallet_balance` + `wallet_transactions` | `chargeWalletForHours()` |
| **Credit khả dụng lúc runtime** | `user_plan_inventory` (+ wallet cho hourly) | Đọc khi `applyBillingDeduction()` |
| **Remaining hours (display/API)** | **Derived** | `summarizeAvailableCredit()`: `effectiveHoursRemaining = totalHours − unbilledHours` |

### Phân tích

- **Running time** và **đã charge** tách làm 2 SoT: wall-clock billable vs `duration_seconds`.
- **Hours used** (subscription) và **duration_seconds** (session) **không được cập nhật trong một transaction** — có thể lệch tạm nếu một bước fail (§8).
- `subscriptions.server_status` **không** tham gia billing math — chỉ runtime UI/reconcile.

**Kết luận:** Billing dùng **mô hình đa SoT có cơ chế reconcile logic** (`unbilled = billable − duration_seconds`), không phải một bảng ledger duy nhất.

---

## 3. Idempotency Analysis

### `deductPerMinute()`

| Lần gọi | Kết quả (tuần tự) | Kết quả (đồng thời) |
|---------|-------------------|---------------------|
| Lần 1 | Charge `floor(unbilled/60)*60`, tăng `duration_seconds` | — |
| Lần 2 ngay sau (tuần tự) | `unbilled` giảm → charge ít hơn hoặc skip (`under_one_minute`) | **UNKNOWN / UNSAFE** — cả hai có thể đọc cùng `duration_seconds` |

**Đánh giá tuần tự:** **SAFE** (thiết kế dựa trên `duration_seconds`).  
**Đánh giá concurrent:** **UNSAFE** — không có lock, compare-and-set, hay transaction (§4–§5).

---

### `stopBilling()`

| Lần gọi | Kết quả |
|---------|---------|
| Lần 1 (running, session running) | Charge `remainderSeconds = totalDuration − duration_seconds`; `clearMachineBillingFields()` |
| Lần 2 | `billing_started_at` đã null → return `{ skipped: true, hoursUsed: 0 }` |

**Đánh giá tuần tự:** **SAFE** — anchor cleared sau lần đầu.  
**Đánh giá concurrent (2× stopBilling trước clear):** **UNSAFE** — **UNKNOWN** mức độ thực tế; không có mutex.

**Path đặc biệt:** Nếu `session.status !== 'running'` → clear billing **không charge remainder** → có thể **under-charge** (§7).

---

### `checkAutoStop()` (`auto-stop.js`)

| Lần gọi | Kết quả |
|---------|---------|
| Lần 1 | Có thể `deductPerMinute` → có thể `destroyMachineWithBackup` |
| Lần 2 sau destroy | `machine.status !== 'running'` → `{ action: 'skipped' }` |

**Đánh giá billing:** **SAFE** (destroy path idempotent qua `getActiveMachineForUser`).  
**Hàm itself:** **Không idempotent** (side effects khác nhau: warn / idle / stop) — không liên quan double charge trực tiếp.

---

### `destroyUserMachine()` / `destroyMachineWithBackup()`

| Lần gọi | Kết quả |
|---------|---------|
| Lần 1 | `stopBilling()` (nếu running + billing_started_at) → destroy → `status = destroyed` |
| Lần 2 | `getActiveMachineForUser()` không thấy row active → `{ destroyed: false }`; **không** gọi `stopBilling` lại |

**Đánh giá:** **SAFE** cho double billing trên cùng phiên (verified `machines.js`).

---

### `startBilling()`

| Lần gọi | Kết quả |
|---------|---------|
| Lần 2+ khi đã có valid `billing_started_at` + linked session | `{ alreadyStarted: true }` — không tạo session mới |

**Đánh giá:** **SAFE** — không nhân đôi billing anchor cho cùng machine/session hợp lệ.

---

## 4. Race Condition Analysis

### Các luồng có thể chạm billing cùng lúc

| Luồng | Ghi billing? |
|-------|--------------|
| Status poll (`GET /api/machines/status`) | `startBilling`, `deductPerMinute`, `checkAutoStop` |
| Cron (`/api/cron/check-idle`) | `deductPerMinute`, `checkAutoStop` → destroy |
| Manual stop (`POST /api/machines/destroy`) | `stopBilling` |
| Auto stop (trong poll hoặc cron) | `stopBilling` qua destroy |

### Cơ chế đồng bộ trong code

| Cơ chế | Có trong code? |
|--------|----------------|
| DB transaction (multi-table) | **Không** — grep `billing.js`: không có `transaction`, `.rpc()` billing |
| Row lock (`FOR UPDATE`) | **Không** |
| Optimistic locking (version column) | **Không** |
| Compare-and-set trên `duration_seconds` | **Không** — `updateSessionBilledSeconds` ghi giá trị tuyệt đối từ read cũ + delta |
| Application mutex | **Không** |

### Các cặp race

| Cặp | Cùng update subscription/wallet/session? | Đánh giá |
|-----|------------------------------------------|----------|
| **Poll + Cron** (`deductPerMinute` × 2) | Có thể cùng `applyBillingDeduction` + `duration_seconds` | **UNSAFE** (concurrent) / **UNKNOWN** (tần suất thực tế) |
| **Poll + Stop** | `deductPerMinute` vs `stopBilling` | **UNSAFE** nếu overlap — cả hai đọc `duration_seconds` trước khi kia ghi |
| **AutoStop + Manual Stop** | Cả hai gọi `destroyUserMachine` | **SAFE** — destroy lần 2 không charge lại |
| **Poll + AutoStop destroy** | Có thể double destroy attempt | **SAFE** cho billing (idempotent destroy) |
| **Cron + checkAutoStop từ poll** | Cùng `checkAutoStop` | **SAFE** destroy; **UNSAFE** nếu cả hai chạy `deductPerMinute` trước destroy |

**Subscription `hours_used`:** Cập nhật qua read-modify-write (`select hours_used` → `update hours_used + X`) — **UNSAFE** under concurrent `applyBillingDeduction`.

---

## 5. Billing Tick Safety

### `deductPerMinute()` có thể chạy đồng thời?

**Có** — từ status poll (~10s/30s) và cron (5 phút) **không có cơ chế loại trừ**.

### Điều gì ngăn double charge?

**Chỉ logic tuần tự:**

```
unbilledSeconds = billableDuration(now) − duration_seconds
billSeconds = floor(unbilledSeconds / 60) * 60
applyBillingDeduction(billSeconds)
duration_seconds += chargedSeconds
```

Comment trong code (`billing.js` ~1615): *"Uses gpu_sessions.duration_seconds to track already-billed time — no overlap with stopBilling."*

- **stopBilling vs deductPerMinute (tuần tự):** **SAFE** — remainder = total − already billed.
- **deductPerMinute vs deductPerMinute (đồng thời):** **Không có** cơ chế ngăn — **UNSAFE**.

### Partial failure giữa deduct và cập nhật duration

Flow: `applyBillingDeduction` **trước** → `updateSessionBilledSeconds` **sau**.

Nếu credit đã trừ nhưng `duration_seconds` chưa tăng → lần tick sau `unbilled` vẫn cao → **có thể trừ credit lần nữa** cho cùng khoảng thời gian.

**Đánh giá:** **UNSAFE** (failure mode) / **UNKNOWN** (xác suất trong production).

---

## 6. `billing_started_at`

### Được update ở đâu?

| Thao tác | Hàm | Giá trị |
|----------|-----|---------|
| **SET** | `linkMachineToBillingSession()` | `startedAt` từ session (`gpu_sessions.started_at`) |
| **NULL** | `clearMachineBillingFields()` | `null` (+ clear `gpu_session_id`, `billing_inventory_id`) |

### Gọi `linkMachineToBillingSession` từ

- `startBilling()` — khi machine `running` lần đầu (hoặc reuse session).

### Gọi `clearMachineBillingFields` từ

- `stopBilling()` — sau settle
- `settleLinkedSessionWithoutCharge()` — boot cancel / stale
- `startBilling()` — khi anchor stale (trước khi set lại)
- `stopBilling()` — khi session không còn `running`

### Reset / overwrite?

- **Reset về null:** có — mỗi lần stop/settle/clear stale.
- **Overwrite:** Nếu stale → clear rồi set anchor mới từ session mới — **không** tìm thấy logic ghi đè anchor hợp lệ đang active (có `alreadyStarted` guard).

### Số session billing đồng thời

- `startBilling()` gọi `closeOrphanRunningSessions()` trước khi tạo/link session.
- `getActiveMachineForUser()` — `limit(1)` machine active per user.

**Invariant (verified):** Một user **thiết kế** một machine active; một billing anchor trên machine đó khi đang charge.

---

## 7. `stopBilling()`

### Dùng field nào?

| Bước | Field |
|------|-------|
| Tổng thời gian billable | `machines.billing_started_at` (+ `machine.created_at` cap) → `computeBillableDurationSeconds()` |
| Đã charge | `gpu_sessions.duration_seconds` via `getBilledSeconds(session)` |
| Remainder | `totalDurationSeconds − alreadyBilledSeconds` |
| Trừ credit | `applyBillingDeduction(remainderSeconds)` → `hours_used` / wallet |

**Không** dùng trực tiếp `hours_used` để tính remainder — **SAFE** cho công thức single-threaded.

### Có thể charge trùng thời gian đã charge?

| Kịch bản | Đánh giá |
|----------|----------|
| Tuần tự: tick rồi stop | **SAFE** — remainder chỉ phần chưa trong `duration_seconds` |
| Đồng thời: tick + stop | **UNSAFE** — cả hai có thể dùng cùng snapshot `duration_seconds` |
| Stop khi session đã không `running` | **Không charge remainder** — clear billing → **under-charge** có thể xảy ra (verified `billing.js` ~1797–1815) |

---

## 8. Transaction Analysis

### Các update trong một lần charge

`applyBillingDeduction()` (một lần gọi):

1. Read `user_plan_inventory` / `users.wallet_balance`
2. Update `subscriptions.hours_used` HOẶC `manual_hour_grants.hours_used` HOẶC `users.wallet_balance`
3. Insert `wallet_transactions` (hourly)
4. (Tuỳ caller) Update `gpu_sessions.duration_seconds`

**Tất cả là các Supabase call riêng lẻ — không bọc transaction.**

### Rủi ro (mô tả, không đề xuất sửa)

| Rủi ro | Hậu quả có thể |
|--------|----------------|
| Credit trừ xong, `duration_seconds` fail | Tick sau charge lại → **over-charge** credit |
| `duration_seconds` tăng, credit fail | **Under-charge** credit; `unbilled` thấp hơn thực tế |
| Concurrent deduction | **Double charge** credit hoặc **lost update** trên `hours_used` |

**Không có** rollback tự động giữa các bảng.

---

## 9. Failure Recovery

| Sự kiện | Charge thiếu? | Charge thừa? | Mất dữ liệu? |
|---------|----------------|--------------|--------------|
| **Server restart (app)** | Không (state DB giữ) | **UNKNOWN** nếu restart giữa deduct/update | Không billing state |
| **Cron restart / trễ** | Unbilled tích lũy; charge batch phút đủ khi chạy lại; stop vẫn settle remainder | **UNKNOWN** concurrent với poll | Không |
| **API timeout (client)** | Client retry destroy/status — destroy idempotent | **UNKNOWN** duplicate concurrent requests | Không |
| **Vast timeout / destroy fail** | `destroyUserMachine` vẫn `stopBilling` trước khi Vast destroy; local `status=destroyed` | **UNKNOWN** nếu Vast vẫn chạy và billing local đã clear | Local session finalized; **UNKNOWN** Vast-side |
| **DB timeout mid-charge** | **UNSAFE** partial (§8) | **UNSAFE** partial | **UNKNOWN** |
| **Stop fail (HTTP 500)** | Machine vẫn running → billing tiếp tục qua poll/cron | Retry stop → một lần `stopBilling` | Không nếu chưa destroy |
| **Destroy fail trước stopBilling** | **UNKNOWN** — phụ thuộc exception point | — | — |
| **`skipBilling: true`** | **Có — by design** (provision error, non-running stale destroy) | Không | Session có thể `interrupted` duration 0 |

### `repairUserBillingState()` (`dashboard/me.js`, `start-machine.js`)

- Đóng orphan sessions (no charge).
- Clear billing trên machine `creating`/`starting` có `billing_started_at`.

**Recovery:** **Partial** — không replay missing charges.

---

## 10. Edge Cases

| Trường hợp | Đánh giá | Lý do (code) |
|------------|----------|--------------|
| **Double Start** | **SAFE** | `alreadyOnline`; provisioning không stale → không provision lại |
| **Double Stop** | **SAFE** | Destroy lần 2: `destroyed: false`, không `stopBilling` lại |
| **Poll + Cron** | **UNSAFE** (concurrent deduct) / **UNKNOWN** (thực tế) | Không lock §4–§5 |
| **Poll + Stop** | **UNSAFE** nếu overlap | deduct vs stopBilling §7 |
| **AutoStop + Manual Stop** | **SAFE** | Destroy idempotent |
| **Destroy retry** | **SAFE** | Không active machine → không double stopBilling |
| **Browser refresh** | **SAFE** (backend) | Frontend cache không ghi billing backend |
| **Browser close** | **SAFE** (backend billing tiếp) | Poll dừng; cron vẫn chạy (**UNKNOWN** nếu không deploy cron) |
| **Logout** | **UNKNOWN** | Không tìm thấy handler logout → destroy |
| **Network disconnect** | **SAFE** (backend) | Giống browser close; máy vẫn chạy → billing tiếp |

### Under-charge by design (verified)

- `settleMachineBillingWithoutCharge()` / `closeSessionWithoutCharge()` — duration 0, no plan charge.
- Hourly wallet empty: `appliedCharge = min(balance, walletCharge)`; `unchargedSeconds` còn lại trong `applyBillingDeduction`.
- `stopBilling` khi session không `running` — không charge remainder.

### Over-charge risk (verified mechanism)

- Concurrent `deductPerMinute` — **UNSAFE**.
- Partial failure credit-before-duration — **UNSAFE**.

---

## 11. Invariants

Chỉ liệt kê invariant **chứng minh được từ code**:

| Invariant | Verified? |
|-----------|-----------|
| `deductPerMinute` chỉ chạy khi `machine.status === 'running'` và có `billing_started_at` | **Có** |
| Tick running chỉ charge ≥ 60s unbilled (`MINUTE_BILLING_SECONDS`) | **Có** |
| `stopBilling` remainder = total billable − `duration_seconds` (single-threaded) | **Có** |
| Sau `stopBilling` thành công: `billing_started_at = null` | **Có** (`clearMachineBillingFields`) |
| `destroyUserMachine` lần 2 không gọi lại `stopBilling` | **Có** |
| `startBilling` không tạo session thứ hai nếu `alreadyStarted` | **Có** |
| `wallet_balance` không âm qua `chargeWalletForHours` | **Có** — `appliedCharge = min(balance, walletCharge)` |
| Orphan `gpu_sessions` running không link machine → closed no charge | **Có** — `closeOrphanRunningSessions` |
| `duration_seconds` update dùng `Math.max(0, floor(...))` | **Có** — không chứng minh monotonic nếu ghi đè sai giá trị |
| Một user một active machine row (query `limit(1)`) | **Có** — **UNKNOWN** nếu DB có 2 row do bug ngoài code |

**Không chứng minh được:**

- `duration_seconds` luôn tăng monotonic dưới mọi failure mode.
- Một phiên chỉ có đúng một lần `stopBilling` charge remainder (concurrent stop).
- Tổng `hours_used` delta ≡ billable seconds / 3600 (rounding + wallet partial).

---

## 12. Overall Safety Assessment

### Billing Safety tổng thể

**★★★☆☆ (3/5)**

Thiết kế **remainder + duration_seconds** đúng hướng cho luồng **tuần tự**. Thiếu cơ chế **atomicity / concurrency control** cho tick và deduction.

### Đánh giá chi tiết

| Hạng mục | Mức | Giải thích ngắn |
|----------|-----|-----------------|
| **Double Charge Risk** | **Medium–High** | Concurrent `deductPerMinute`; deduct+stop overlap; partial failure credit-before-duration |
| **Data Loss Risk** | **Low–Medium** | DB persist OK; session có thể `duration_seconds: 0` khi settle without charge; finalize overwrite |
| **Race Condition Risk** | **High** (deduct concurrent) / **Medium** (destroy overlap) | Không lock/transaction |
| **Recovery Capability** | **Medium** | `repairUserBillingState`, orphan cleanup; không replay charge |
| **Idempotency** | **Medium** | Destroy/stop/start **SAFE** tuần tự; tick/deduct **không** an toàn concurrent |

### Trả lời trực tiếp câu hỏi mục tiêu

| Câu hỏi | Kết luận |
|---------|----------|
| **Tính thiếu?** | **Có thể** — `skipBilling`, settle without charge, wallet hết, `stopBilling` skip khi session không running, rounding/floor (verified paths) |
| **Tính thừa?** | **Có thể** — concurrent tick, partial failure, concurrent stop+deduct (**UNSAFE** mechanisms) |
| **Double charge?** | **Có thể** trong race poll+cron hoặc deduct trước duration update fail; **không** trong double destroy tuần tự (verified **SAFE**) |

---

## 13. Open Questions

Những điểm **chưa chứng minh** từ code:

1. Tần suất thực tế request đồng thời `deductPerMinute` (poll + cron cùng giây) trên production.
2. Hành vi Supabase/Postgres khi hai client cùng `update duration_seconds` — last-write-wins hay conflict?
3. Xác suất và hậu quả **partial failure** giữa `applyBillingDeduction` và `updateSessionBilledSeconds`.
4. User **logout** có destroy machine không.
5. Instance Vast còn chạy sau khi local DB `destroyed` + billing cleared — ai billing?
6. Cron có chạy ngoài Vercel không (chỉ thấy `vercel.json`).
7. `stopBilling` return `durationSeconds: 0` khi `alreadySettled` — ảnh hưởng `finalizeGpuSession` vs credit đã tick trước đó.
8. Có thể có **>1** machine active row per user nếu data manual/bug DB?
9. Idempotency key / dedup cho payment callback vs runtime billing (ngoài scope nhưng liên quan nguyên tắc 29).
10. ARCHITECTURE_PRINCIPLES §29 yêu cầu idempotent — **mức độ code đáp ứng** chưa audit formal toàn bộ Start/Stop/Destroy paths ngoài billing.

---

## Tham chiếu code chính

| File | Vai trò safety |
|------|----------------|
| `src/lib/gpu/billing.js` | `deductPerMinute`, `stopBilling`, `applyBillingDeduction`, `duration_seconds` |
| `src/lib/gpu/auto-stop.js` | `checkAutoStop`, trigger destroy |
| `src/lib/machines.js` | `destroyUserMachine`, single active machine |
| `src/pages/api/machines/status.js` | Poll tick + auto-stop trigger |
| `src/pages/api/cron/check-idle.js` | Cron tick |
| `docs/BILLING_LOGIC_REVIEW.md` | Logic reference |
| `docs/ARCHITECTURE_PRINCIPLES.md` | Nguyên tắc idempotency (triết lý) |

---

*Tài liệu review-only. Không đề xuất implementation, refactor, hay kiến trúc mới.*
