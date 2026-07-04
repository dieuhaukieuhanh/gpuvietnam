# SESSION_BASED_BILLING_REVIEW

**Vai trò:** Principal Software Architect — phản biện độc lập  
**Đối tượng:** Mô hình Session-Based Billing (`docs/SESSION_BASED_BILLING_FEASIBILITY.md`)  
**Căn cứ:** `BILLING_LOGIC_REVIEW.md`, `BILLING_SAFETY.md`, `ARCHITECTURE_PRINCIPLES.md`  
**Quy ước:** Không bảo vệ mô hình đề xuất. Không viết code. Không mô tả implementation chi tiết.

---

## 1. Tóm tắt phản biện

Tài liệu feasibility kết luận Session-Based Billing **“khả thi”** và **“cải thiện an toàn concurrent”**. Phản biện này cho rằng:

1. Mô hình **đơn giản hóa quá mức** vấn đề billing thực tế — thay race per-minute bằng **single point of failure** tại session close.
2. Công thức `Remaining = Total Entitlement − Closed Sessions Used − Current Session Elapsed` **không loại bỏ đa SoT**; chỉ **dời** sự phức tạp sang settlement và reconciliation.
3. Auto Stop read-only **không giải quyết** rò rỉ chi phí provider (Vast) khi destroy thất bại — thậm chí **làm rõ hơn** khoảng “GPU chạy miễn phí trên DB”.
4. Mô hình **mâu thuẫn** nguyên tắc 8 (ARCHITECTURE_PRINCIPLES) và **chưa đáp ứng** nguyên tắc 24 (observability một người vận hành) cho tranh chấp billing.
5. **Không nên** áp dụng nguyên văn Session-Based làm kiến trúc cuối. Kiến trúc đề xuất cuối tài liệu là **hybrid ledger + session lifecycle** — giữ session làm đơn vị nghiệp vụ, **không** bỏ ghi nhận usage có kiểm soát trong lúc phiên chạy.

---

## 2. Phản biện theo chủ đề

### 2.1 Điểm yếu cấu trúc

| Điểm yếu | Phân tích |
|----------|-----------|
| **“Single SoT thời gian” là ảo tưởng** | `started_at` / `ended_at` chỉ là SoT **thời lượng phiên**. `Total Entitlement` vẫn trải trên `subscriptions`, `manual_hour_grants`, `user_plan_inventory`, `wallet_balance` — **bốn nguồn** như hiện tại. Feasibility **không** hợp nhất entitlement ledger. |
| **Settlement một lần = blast radius lớn** | Hiện tại lỗi partial giữa `applyBillingDeduction` và `duration_seconds` có thể over-charge từng phút (`BILLING_SAFETY.md` §8). Session-Based: lỗi tại close có thể **sai toàn phiên** (hàng trăm phút) trong một lần ghi. |
| **Không có transaction vẫn là vấn đề** | Feasibility giảm race bằng cách bỏ tick — **đúng cho concurrent deduct**. Nhưng settlement cuối session vẫn cập nhật `hours_used`, `wallet_balance`, `wallet_transactions`, `gpu_sessions.ended_at` — **cùng pattern multi-table không atomic** hiện tại. |
| **Derived Remaining không có owner** | Công thức Remaining phải chạy ở: dashboard API, status poll, auto-stop, auto-renew, frontend cache (`BILLING_LOGIC_REVIEW.md` §15). Feasibility **cảnh báo** nhưng **không** giải quyết — đây là lỗi kiến trúc **tái phát**, không biến mất. |
| **`hours_used` vs Σ sessions** | Feasibility đề xuất `hours_used` derived hoặc sync khi close — **hai nguồn** có thể lệch vĩnh viễn nếu sync fail. Hiện tại đã lệch giữa `duration_seconds` và `hours_used`; session model **đổi chỗ lệch**, không xóa. |
| **Read-only enforcement yếu** | Không ghi DB trong lúc chạy nghĩa là **không có reservation** credit. Entitlement chỉ là “lời hứa” tính toán — không có bằng chứng ledger cho từng phút user đã tiêu thụ nếu tranh chấp. |

### 2.2 Trường hợp thất bại (failure modes)

#### A. Crash / partial write tại session close

**Kịch bản:** `destroyUserMachine` trừ wallet thành công → crash trước khi ghi `ended_at`.

| Hậu quả | Mức độ |
|---------|--------|
| Credit đã trừ, session vẫn `running` | **Nghiêm trọng** — Remaining read-only có thể **trừ hai lần** nếu destroy retry settle lại |
| `ended_at` ghi xong, credit chưa trừ | **Nghiêm trọng** — under-charge; reconciliation phát hiện muộn |
| Machine `destroyed`, session chưa finalize | **Trung bình** — orphan; `repairUserBillingState` đóng no-charge (verified) → **mất doanh thu** |

Feasibility §4.3 nói partial failure **giảm** vì một transaction — **sai nếu không có DB transaction thực**. Code hiện **không có** (`BILLING_SAFETY.md` §8).

#### B. App restart giữa phiên (không destroy)

| Mô hình | Hành vi |
|---------|---------|
| **Hiện tại** | `duration_seconds` + `hours_used` persist; tick tiếp tục — **SAFE persistence** (verified) |
| **Session-Based** | Không tick → read-only elapsed vẫn đúng **nếu** `started_at` đúng. **Nhưng** không có checkpoint ledger → không biết “đã commit bao nhiêu” nếu close fail nhiều lần |

Restart app **không phải** vấn đề lớn; vấn đề là **restart giữa settlement**.

#### C. Destroy fail, Vast vẫn chạy

`BILLING_LOGIC_REVIEW.md` §9: destroy Vast lỗi → local vẫn `status = destroyed`. `BILLING_SAFETY.md` §13 câu hỏi 5: **UNKNOWN** ai billing instance Vast còn sống.

Session-Based: nếu local đã ghi `ended_at` + settle nhưng Vast chạy → **GPUVietnam trả tiền Vast, user không bị charge thêm** (session đóng). Ngược lại: Vast destroy OK nhưng settle fail → user **dùng GPU miễn phí** trên sổ sách.

**Đây là failure mode provider-level mà Session-Based không cải thiện — có thể che giấu** vì không còn tick để phát hiện “máy chạy nhưng session đã đóng”.

#### D. Auto-stop read-only + destroy loop fail

`checkAutoStop` phát hiện `out_of_credit` → gọi destroy. Nếu destroy HTTP 500 lặp lại:

- Session-Based: elapsed tiếp tục tăng read-only; **DB không reflect usage** cho đến khi destroy thành công.
- User tiếp tục dùng GPU trên Vast **quá entitlement** — cuối session cap `min(available, need)` → **một bên thiệt** (user bị charge max cap dù dashboard đã 0, hoặc business nuốt over-run).

#### E. Orphan session không `ended_at`

Feasibility §4.4: **UNKNOWN policy**. Hiện tại `closeOrphanRunningSessions` → `interrupted`, duration 0, no charge (verified).

Session-Based: nếu orphan có `started_at` nhưng không close → `Current Session Elapsed` trong Remaining **có thể block user vĩnh viễn** (Remaining âm ảo) hoặc **không block** nếu repair xóa session — **hai hành vi khác nhau, chưa định nghĩa**.

### 2.3 Giới hạn mở rộng

| Hướng mở rộng | Session-Based | Lý do hạn chế |
|---------------|---------------|---------------|
| **Feature-based pricing** (Nguyên tắc 26) | ❌ Yếu | Session chỉ đo wall-clock; không gắn Order/Feature usage trong phiên |
| **Order-first** (Nguyên tắc 27) | ❌ Yếu | Usage không liên kết Order ID; khó audit “Order X đã tiêu bao nhiêu” |
| **Multi GPU provider** (Nguyên tắc 6, 32) | ⚠️ | Billing anchor = app timestamp; provider B có thể có invoice riêng → **reconciliation bắt buộc** với API provider, không chỉ `ended_at − started_at` |
| **Pricing theo GPU tier động** | ⚠️ | Session metadata `plan`/`gpu_config` tại start — đổi giá mid-session không reflect |
| **Partial refund / admin comp** | ❌ | Settlement một lần — hoàn một phần phiên cần **adjustment ledger** riêng, không có trong mô hình |
| **Billing pause** (maintenance, lỗi provider) | ❌ | Không có khái niệm “billable window” trong session — chỉ start/end |
| **API / Agent billing ngoài ComfyUI session** | ❌ | Một session = một máy GPU; feature mới có thể không map 1:1 |
| **Enterprise invoicing / export** | ⚠️ | Một dòng / session — thiếu line-item theo thời gian nếu khách hàng yêu cầu |

Feasibility đánh giá **12 nghiệp vụ hiện có** — **không** đánh giá roadmap Nguyên tắc 26–27. Đó là **giới hạn mở rộng nghiêm trọng** nếu coi tài liệu feasibility là target architecture.

### 2.4 Vấn đề vận hành (một người — Nguyên tắc 15, 24)

| Vấn đề | Mô tả |
|--------|--------|
| **Không trả lời nhanh “phút X trừ bao nhiêu”** | Operator phải giải thích cả phiên — khó với user kỹ tính |
| **Reconciliation job trở thành bắt buộc** | Không còn tick ledger để đối chiếu từng bước; **bắt buộc** job `Σ sessions ↔ hours_used ↔ wallet` — thêm gánh nặng vận hành, feasibility **không** đề cập |
| **`repairUserBillingState` không replay** | Verified: partial recovery, không replay charge (`BILLING_SAFETY.md` §9). Session-Based **phụ thuộc nặng hơn** vào repair vì không có incremental state |
| **Metric phân mảnh** | Auto-renew (`hours_total − hours_used`) vs dashboard Remaining — operator thấy **hai con số khác nhau** cho cùng user |
| **Frontend localStorage anchor** | `DashboardOverview.tsx` cache billing anchor / session start hours — **không phải SoT** nhưng user screenshot làm bằng chứng tranh chấp |
| **Cron 5 phút** | Auto-stop trễ; feasibility nói read-only Remaining đúng trên poll — **nhưng poll client có thể tắt** (browser close). Chỉ cron → user over-run tới 5 phút **systematic** |

### 2.5 Vấn đề audit

| Hiện trạng | Session-Based | Phản biện |
|------------|---------------|-----------|
| `hour_grant_logs` | Giữ | OK |
| `wallet_transactions` mỗi deduct | Một tx / session | **Mất forensic trail** — dispute hourly không chứng minh từng khoảng |
| `gpu_sessions` row | SoT timestamps | Tốt cho **macro** audit, kém cho **micro** |
| Không có unified billing audit | Vẫn không có | Feasibility **tự thừa nhận** mất granularity — **không chấp nhận được** nếu volume tranh chấp tăng |

**Thiếu hụt nghiêm trọng:** không có **append-only settlement event log** (ai, session_id, seconds, entitlement_source, amount, idempotency_key, correlation_id). Session row **không thay thế** event log — nó là **kết quả**, không phải **bằng chứng quá trình**.

Nguyên tắc 24 yêu cầu operator trả lời “billing đã trừ bao nhiêu” — Session-Based **làm câu trả lời thô hơn**, không tinh hơn.

### 2.6 Vấn đề reconciliation

Ba lớp số liệu phải khớp:

```
Σ (closed session billable seconds)
≡ Δ subscriptions.hours_used + Δ manual_hour_grants.hours_used
≡ Σ wallet payment transactions (hourly)
≡ (optional) provider invoice seconds
```

Session-Based **đặt niềm tin** vào công thức đầu — nhưng:

| Lệch | Nguyên nhân |
|------|-------------|
| Session > hours_used | Settlement fail sau ended_at |
| hours_used > session | Migration legacy, manual admin edit grant |
| Wallet tx ≠ session duration × price | Rounding per-session vs cap `min(balance, charge)` |
| Provider invoice > app session | Boot time trên Vast trước khi app set `started_at`; teardown delay |

Feasibility §3.11 nói reconcile cần invariant — **không định nghĩa invariant enforceable**. Không có DB constraint, không có nightly job spec.

**Mid-session entitlement change** (renew, revoke grant, expiry): allocation tại close theo inventory **tại close** vs **tại start** — feasibility liệt kê **UNKNOWN policy**. Reconciliation **không thể** tự động nếu policy không cố định.

### 2.7 Vấn đề provider (Vast và tương lai)

| Vấn đề | Chi tiết |
|--------|----------|
| **Billing clock độc lập** | App: `started_at` khi Vast `running` qua poll (`BILLING_LOGIC_REVIEW.md` §2). Vast có thể tính từ instance create — **hai đồng hồ**. Session-Based charge theo app — **dispute khi đối chiếu vendor bill** |
| **Local destroyed, remote running** | Verified path — **rò rỉ chi phí** (`BILLING_SAFETY.md` §13.5) |
| **Remote destroyed, local running** | `syncSubscriptionWithMachineState` / 404 reconcile — session vẫn `running`, elapsed tăng — user bị charge **cho GPU không tồn tại** nếu settle theo timestamp |
| **Poll latency 10s/30s** | `started_at` **muộn** so với GPU thực sự ready — user được vài chục giây “miễn phí” hoặc ngược lại nếu policy đổi |
| **Provider thứ hai** | Nguyên tắc 6 yêu cầu abstraction — Session-Based gắn chặt app session timestamps, **không** gắn provider-reported usage. Multi-provider **bắt buộc** adapter trả về billable interval — mô hình thuần session **thiếu hook** |

Feasibility **không** đề cập provider reconciliation — **lỗ hổng kiến trúc** cho bất kỳ ai trả tiền Vast theo invoice.

### 2.8 Crash recovery

| Giai đoạn | Session-Based | Đánh giá |
|-----------|---------------|----------|
| Phiên running, app crash | Elapsed derived OK | ⚠️ OK nếu `started_at` tin cậy |
| Phiên running, DB unavailable | Không tick, không stop | ❌ Giống hiện tại — nhưng không có `duration_seconds` backup progress |
| Destroy in-progress | Single settlement | ❌ **Tệ hơn** — all-or-nothing |
| Orphan repair | Policy UNKNOWN | ❌ Blocker |
| Migration từ hệ cũ | `duration_seconds` vs timestamps | ❌ **High risk** — feasibility không có migration narrative |

Hiện tại ít nhất `duration_seconds` là **checkpoint** đã charge (`BILLING_SAFETY.md` §2). Session-Based **bỏ checkpoint** — recovery **yếu hơn** trừ khi bổ sung cơ chế khác (feasibility không có).

### 2.9 Data consistency

| Invariant | Session-Based có enforce? |
|-----------|---------------------------|
| Một user một active session | Thiết kế có (principle 5) — **không** DB unique constraint (UNKNOWN) |
| `ended_at >= started_at` | **Không** thấy constraint trong schema |
| Settlement exactly once | Cần idempotency key — **không** trong feasibility |
| Remaining ≥ 0 trước khi start | **Không** ghi reservation — race start với 0.001h |
| `hours_used` monotonic | Chỉ tăng tại close — **jump** lớn gây shock UX / auto-renew sai thời điểm |

**Frontend và backend divergence:** User thấy Remaining từ localStorage formula; backend settle cap khác → **consistency model eventual không được định nghĩa**.

### 2.10 Billing fairness (công bằng)

| Kịch bản | Ai thiệt? |
|----------|-----------|
| **Over-run 0–5 phút** trước auto-stop | User (nếu cap charge) hoặc Business (nếu không charge over-run) — feasibility **đẩy policy sang settlement** mà **không chốt** |
| **Charge giây lẻ tại close** vs **full phút trong lúc chạy** (hiện tại) | User có thể trả **nhiều hơn** — feasibility §3.3 thừa nhận — **thay đổi chính sách im lặng = unfair** |
| **Idle 60 phút auto-stop** | User trả **cả idle period** — công bằng theo “máy chạy”, **không công bằng** theo “ComfyUI active” — không đổi bởi session model nhưng session **không phân biệt** idle vs active trong ledger |
| **Provisioning/boot không bill** | Hiện tại billing khi `running` — session `started_at` phải align — nếu lệch → user trả boot |
| **Wallet rounding** | Per-session round vs per-minute — **systematic bias** một bên |

Feasibility coi “charge đúng elapsed” là **tính năng** — với user quen full-phút, đó là **regression fairness**.

### 2.11 Customer dispute (tranh chấp)

Các câu hỏi user sẽ hỏi — Session-Based **khó trả lời**:

| Câu hỏi | Khó vì |
|---------|--------|
| “Dashboard còn 0.3h sao tắt máy trừ 0.8h?” | Read-only Remaining vs settlement cap / rounding |
| “Tôi tắt lúc 14:02 sao session ended_at 14:07?” | Destroy async, backup trước billing (`principle 13`) |
| “Phiên bắt đầu lúc nào?” | `buildLiveSessionFromSubscription` dùng `activated_at` — **lệch** `billing_started_at` (feasibility §3.12) |
| “Sao không dùng hết 60 phút idle warning?” | Idle policy ≠ billing policy — một dòng session không giải thích |
| “Chứng minh từng phút trừ ví” | Không còn wallet tx per deduct |

**Screenshot localStorage** vs DB settlement — feasibility §4.4 item 2 — **vector tranh chấp pháp lý / CS thực tế**.

Không có immutable audit → **dispute resolution = lời nói operator vs timestamp** — yếu.

---

## 3. Phản biện tài liệu Feasibility

Feasibility **quá lạc quan** ở các điểm:

| Claim trong Feasibility | Phản biện |
|-------------------------|-----------|
| “Giảm race double-charge” | **Đúng** cho tick concurrent; **sai** nếu coi settlement là an toàn — vẫn multi-table, vẫn concurrent destroy |
| “Single SoT thời gian” | **Quá tuyên bố** — entitlement vẫn đa SoT |
| “Auto Stop read-only đúng nguyên tắc” | **Đúng về side-effect**; **sai về enforcement** — không ghi = không reserve = over-run |
| “Tất cả 12 nghiệp vụ ✅” | **Checklist hợp lệ** nhưng **bỏ qua** Order-first, Feature pricing, provider invoice |
| “Blocker chỉ nguyên tắc 8” | **Thiếu:** audit, reconciliation, provider drift, migration, dispute |
| “Partial failure giảm” | **Chỉ đúng** với DB transaction — **chưa có** trong hệ thống |

---

## 4. Đánh giá Billing hiện tại — giữ / bỏ / thiết kế khác

### 4.1 Nên giữ lại

| Thành phần | Lý do |
|------------|-------|
| **Tách Subscription vs Session vs Machine** | Nguyên tắc 3, 4 — đúng domain |
| **Billing bắt đầu khi Vast `running`**, không phải lúc click Start | Tránh charge provisioning — verified |
| **Thứ tự deduct gift → combo → hourly** | Business rule ổn định |
| **Destroy flow thống nhất** (backup → billing → finalize → provider destroy) | Nguyên tắc 13 |
| **Auto-stop out_of_credit + idle** | Nguyên tắc 14 — chính sách sản phẩm |
| **`skipBilling` / settle without charge** | Orphan, provision fail — verified paths |
| **Idempotent destroy** (lần 2 không double stopBilling) | Nguyên tắc 29 — verified SAFE |
| **`user_plan_inventory` runtime read** | Tách entitlement khỏi payment |
| **Payment domain độc lập** | Nguyên tắc 9–11, 28 |
| **`computeBillableDurationSeconds` cap** (`created_at`, boot) | Bảo vệ không bill trước running |
| **`repairUserBillingState` + orphan close** | Cần giữ và **mở rộng**, không thay thế |
| **Concept `effectiveHoursRemaining`** | Đúng hướng derived — cần **một implementation duy nhất** |

### 4.2 Nên bỏ hoàn toàn

| Thành phần | Lý do |
|------------|-------|
| **`deductPerMinute()` gọi từ poll + cron** | UNSAFE concurrent (`BILLING_SAFETY.md` ★★★☆☆); giá trị kiến trúc thấp so với rủi ro |
| **`duration_seconds` làm SoT “đã charge”** | Dual SoT với wall-clock — gốc inconsistency và race |
| **`deductPerMinute` trong `checkAutoStop`** | Side-effect billing trong policy check — sai separation of concerns |
| **Read-modify-write `hours_used` không lock** | UNSAFE — bỏ pattern, không vá tick |
| **Frontend localStorage làm pseudo-anchor billing** | Vi phạm Nguyên tắc 20 — logic display thành dispute evidence |
| **`buildLiveSessionFromSubscription` heuristic** | Sai `started_at` — gây session history / dispute sai |
| **Multi-formula “giờ còn lại”** (auto-renew vs billing status) | Gây hành vi không nhất quán |

**Không** bỏ: remainder settlement tại stop — **ý tưởng** “settle phần chưa ghi” là đúng; **cách hiện tại** (remainder vs duration_seconds) sai implementation.

### 4.3 Nên thiết kế khác so với Feasibility (Session-Based thuần)

| Feasibility đề xuất | Thiết kế nên khác |
|---------------------|-------------------|
| Zero DB write trong lúc chạy | **Checkpoint writes** (không phải per-minute deduct): ví dụ mỗi N phút hoặc on significant event — append-only **usage_events**, không update aggregate trực tiếp |
| `hours_used` sync khi close | **`hours_used` = cache** của Σ settled events; rebuild được |
| Remaining = công thức rải rác | **Single BillingProjection service** — mọi consumer gọi một chỗ |
| Session chỉ `started_at`/`ended_at` | Session + **billable_intervals[]** (exclude idle nếu policy đổi sau này) |
| Settlement một lần | **Idempotent settlement record** với `idempotency_key = session_id + close_attempt` |
| Auto-stop read-only | Read-only **decision** + **mandatory destroy** với retry; **không** read-only trên provider cost |
| Audit = session row | **Append-only `billing_settlement_events`** |
| Nguyên tắc 8 (per-minute trừ dần) | **Sửa nguyên tắc 8** thành: “usage ghi nhận theo thời gian thực; **commit** có thể theo checkpoint và cuối session” |

---

## 5. Greenfield — nếu thiết kế từ đầu

Giả định: monolith (Nguyên tắc 16), một operator (15), Order-first (27), provider adapter (30), idempotent (29).

### 5.1 Domain layers

```
┌─────────────────────────────────────────────────────────┐
│  Payment Domain          → Order → EntitlementGrant     │
│  (wallet, transfer, gateway)                            │
├─────────────────────────────────────────────────────────┤
│  Entitlement Domain      → readable balance per source    │
│  (gift, combo, wallet-hours)                            │
├─────────────────────────────────────────────────────────┤
│  Session Domain          → lifecycle, provider ref      │
│  (started_at, ended_at, status, machine_id)             │
├─────────────────────────────────────────────────────────┤
│  Usage Ledger Domain     → append-only events           │
│  (usage_accrued, usage_settled, adjustment)             │
├─────────────────────────────────────────────────────────┤
│  Settlement Domain       → maps usage → entitlement $    │
│  (priority, rounding policy, idempotent)                │
├─────────────────────────────────────────────────────────┤
│  Billing Projection      → Remaining, out_of_credit     │
│  (pure function / single module)                        │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Core invariants (greenfield)

1. **Mọi trừ credit = một settlement event** — immutable, có `session_id`, `seconds`, `source` (gift/combo/wallet), `amount`, `idempotency_key`.
2. **Remaining = Entitlement − Σ settled − Σ accrued_unsettled** — một công thức, một module.
3. **Session close = trigger settlement** cho `accrued_unsettled` — không phải tính lại từ `ended_at − started_at` từ zero (tránh double nếu checkpoint đã có).
4. **Provider adapter** báo cáo `{ instance_id, provider_started_at, provider_stopped_at }` — reconcile với app session; flag drift.
5. **Destroy pipeline** idempotent với state machine: `running → settling → settled → destroying → destroyed`.
6. **Không update aggregate** (`hours_used`, `wallet_balance`) mà không có settlement event tương ứng — aggregate là **projection**, rebuild được.

### 5.3 Accrual model (greenfield)

Không chọn **pure per-minute tick** (race) cũng không **pure session-end** (blast radius):

| Cơ chế | Mục đích |
|--------|----------|
| **Accrual on heartbeat** (status poll / cron) | Ghi `usage_accrued` event `{ from, to, seconds }` — **append-only**, idempotent theo `(session_id, window_end)` |
| **Settlement on checkpoint** (optional, e.g. mỗi 15 phút) | Giảm unsettled accrual — giới hạn over-run và dispute window |
| **Settlement on close** | Finalize phần còn lại |
| **Projection update** | Derive `hours_used` / wallet từ events — hoặc update trong **một DB transaction** với event insert |

Đây là **event-sourced usage nhẹ** — phù hợp monolith, không cần Kafka.

### 5.4 Những gì greenfield **không** làm

- Không `duration_seconds` counter riêng lẻ song song wall-clock.
- Không deduct trong auto-stop policy function.
- Không billing logic trong React / localStorage.
- Không ba công thức Remaining khác nhau.
- Không settlement multi-table không transaction khi đã có thể gom event + projection.

---

## 6. Final Recommended Billing Architecture

**Tên:** **Session-Ledger Hybrid Billing** (SLHB)

Không phải Session-Based thuần từ feasibility. Không phải per-minute tick hiện tại.

### 6.1 Nguyên tắc SLHB

| # | Nguyên tắc |
|---|------------|
| 1 | **Session** là đơn vị nghiệp vụ và audit **macro** (`started_at`, `ended_at`, status, provider_ref) |
| 2 | **Usage Ledger** (append-only events) là SoT **micro** cho mọi giây đã accrue và settled |
| 3 | **Entitlement** tách biệt — Payment tạo grant; Billing chỉ consume grant qua settlement |
| 4 | **Remaining** = một hàm duy nhất trong Billing Projection — mọi API/UI/auto-renew/auto-stop **bắt buộc** dùng |
| 5 | **Accrual** trong lúc chạy **chỉ ghi event** — không mutate `hours_used` trực tiếp từ poll (trừ projection batch) |
| 6 | **Settlement** idempotent — key theo session + phase |
| 7 | **Auto-stop** đọc Projection; **destroy** thực thi settlement final — không deduct trong idle check |
| 8 | **Provider reconciliation** là module first-class — so sánh session vs provider interval |
| 9 | **Aggregate fields** (`hours_used`, `wallet_balance`) là **cache** — có thể rebuild từ ledger |
| 10 | Cập nhật **Architecture Principles §8** cho khớp SLHB |

### 6.2 Thành phần

```
                    ┌──────────────────┐
                    │ BillingProjection │ ← Remaining, out_of_credit
                    └────────▲─────────┘
                             │ reads
┌──────────────┐    ┌────────┴────────┐    ┌─────────────────┐
│ Entitlement  │    │  Usage Ledger    │    │ Session         │
│ Grants       │    │  (events)        │    │ Lifecycle       │
└──────┬───────┘    └────────▲────────┘    └────────▲────────┘
       │                     │ accrue/settle          │ open/close
       │            ┌────────┴────────┐             │
       └───────────►│ Settlement Engine │◄────────────┘
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │ Destroy Pipeline │ ← principle 13
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │ Provider Adapter │ ← Vast, future
                    └─────────────────┘
```

### 6.3 Luồng thời gian (conceptual)

```
Session OPEN (running confirmed)
    → accrual events theo heartbeat (idempotent windows)
    → projection: Remaining giảm (unsettled accrual)

Optional CHECKPOINT SETTLE (e.g. 15 min or low Remaining threshold)
    → settlement events → update entitlement cache

Session CLOSE (destroy unified)
    → final settlement (remainder accrual)
    → session.ended_at
    → provider destroy
    → reconciliation mark

REPAIR job (operator / cron)
    → orphan sessions
    → Σ events vs aggregates
    → provider drift report
```

### 6.4 So sánh ba mô hình

| Tiêu chí | Hiện tại (per-minute) | Session-Based (feasibility) | **SLHB (đề xuất)** |
|----------|----------------------|---------------------------|---------------------|
| Concurrent safety | ❌ UNSAFE tick | ⚠️ Better, settle risky | ✅ Event idempotent windows |
| Audit / dispute | ⚠️ Tick tx | ❌ Chỉ session | ✅ Event trail + session |
| Operator complexity | ⚠️ Race debug | ⚠️ Reconcile bắt buộc | ✅ Rebuild + event log |
| Over-run risk | ⚠️ | ❌ Cao hơn | ⚠️ Checkpoint giảm |
| Blast radius lỗi | Nhỏ (1 phút) | ❌ Cả session | Trung bình (window) |
| Provider reconcile | ❌ Không | ❌ Không | ✅ Có module |
| Monolith-friendly | ✅ | ✅ | ✅ |
| Principle 8 fit | ✅ | ❌ | ⚠️ Cần sửa §8 |
| Migration từ hiện tại | — | ❌ Khó | ⚠️ Additive events song song |

### 6.5 Migration posture (conceptual, không implementation)

Theo Nguyên tắc 18 (additive, từng bước):

1. Introduce Usage Ledger **song song** — ghi accrual events, **chưa** dùng cho charge.
2. Reconcile events vs `duration_seconds` + `hours_used` — fix drift.
3. Chuyển settlement sang events; tắt `deductPerMinute`.
4. Deprecate `duration_seconds` SoT; giữ column derived.
5. Sửa nguyên tắc 8 + auto-renew dùng BillingProjection.

---

## 7. Kết luận kiến trúc

| Câu hỏi | Kết luận |
|---------|----------|
| Session-Based Billing có nên áp dụng nguyên văn? | **Không.** Giải quyết được race tick nhưng **tạo rủi ro mới** lớn hơn về settlement, audit, dispute, provider, và mở rộng. |
| Feasibility doc có đủ để quyết định kiến trúc? | **Không.** Thiếu reconciliation spec, provider policy, migration, dispute, và Order/Feature alignment. |
| Billing hiện tại có gì đáng giữ? | Domain separation, destroy pipeline, priority deduct, running-gate, skip paths, idempotent destroy. |
| Billing hiện tại có gì phải bỏ? | `deductPerMinute` concurrent pattern, `duration_seconds` SoT, billing side-effects in auto-stop, frontend anchors, dual Remaining formulas. |
| Kiến trúc cuối cùng? | **Session-Ledger Hybrid Billing (SLHB)** — session lifecycle + append-only usage/settlement events + single BillingProjection + provider reconciliation. |

---

## 8. Open questions (architect — chưa có câu trả lời)

1. Policy chính thức: entitlement expiry **mid-session** — allocate theo start hay close?
2. Over-run trước destroy: cap charge, business absorb, hay user absorb?
3. Idle period có trừ billing không — now và future?
4. Rounding: per-second, per-minute, per-session — **cam kết sản phẩm** cần ghi vào điều khoản.
5. Vast invoice reconciliation — ai chịu drift, bao lâu một lần?
6. Có rebuild `hours_used` từ ledger trong admin UI không (Nguyên tắc 24)?
7. Sửa Nguyên tắc 8 trước hay migrate code trước?

---

## 9. Tham chiếu

| Tài liệu | Vai trò |
|----------|---------|
| `docs/SESSION_BASED_BILLING_FEASIBILITY.md` | Đối tượng phản biện |
| `docs/BILLING_SAFETY.md` | Race, partial failure, recovery |
| `docs/BILLING_LOGIC_REVIEW.md` | Hiện trạng verified |
| `docs/ARCHITECTURE_PRINCIPLES.md` | Nguyên tắc 3, 8, 13, 14, 18, 24, 27, 29, 30 |

---

*Principal Architect review — adversarial, independent. Không viết code. Không mô tả implementation.*
