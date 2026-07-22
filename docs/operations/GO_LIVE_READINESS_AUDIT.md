# Go-Live Readiness Audit

| | |
|---|---|
| **Status** | Audit complete · Owner reviewed 2026-07-22 · **P0-A code ready, CLOSED chỉ sau production smoke** (xem [LIFECYCLE_WORKER.md](./LIFECYCLE_WORKER.md)) |
| **Date** | 2026-07-22 |
| **Architecture baseline** | [GATE2_ARCHITECTURE_VALIDATION_REPORT.md](../architecture/GATE2_ARCHITECTURE_VALIDATION_REPORT.md) — **PASS WITH CONSTRAINTS** |
| **Product gate map** | [E2E_TEST_GATES_V2.md](../architecture/E2E_TEST_GATES_V2.md) § Gate 2 (Go-Live P1) |
| **Out of scope** | Ticket C · dual-run product launch · warm pool · feature work |

---

## Mục đích

Sau khi Architecture Validation đã đóng sổ, audit này trả lời:

> **Đủ an toàn để self-serve / bán cho khách chưa?**

Không lẫn với “đã chứng minh kiến trúc”. Mỗi item chỉ một trạng thái:

`PASS` · `PARTIAL` · `BLOCKED` · `NOT DONE` · `N/A`

---

## Evidence base (đã dùng)

| Source | Vai trò |
|--------|---------|
| Gate 2 Architecture Validation | Continuity proven; ops blockers listed |
| Prod E2E Continuity PASS | `tmp/a1-prod-e2e-prod-e2e-1784729461467.json` |
| Gate1 Continuity G1–G6 | `GATE1_TEST_REPORT.md` |
| A1 M1–M4 / Origin harden | Workspace + CP + proxy |
| `vercel.json` / `vercel.crons.pro.json` | Hobby `crons: []` |
| `start-machine.js` + `user-start-provision.js` | Post-accept background provision |
| `destroy-pipeline*.js` + settlement libs | Stop → settle path |
| `BACKUP_RUNBOOK.md` / backup-* libs | Backup/restore |
| `COMFY_PROXY.md` / comfy-access | Token / Workspace security |
| `LOGGING.md` / `TECH_DEBT.md` | Observability debt |
| Clore orphan / host-reputation / bad-host | Provider reliability |

**G7 multi-hop:** **không** coi là P0 blocker Go-Live MVP (hardening / post-MVP).

---

## GO-LIVE VERDICT

```text
GO-LIVE VERDICT: NOT READY
```

Hai vấn đề đã tách rõ (Owner review):

> **Architecture Continuity đã chứng minh.**  
> **Production Reliability / Self-serve Operations chưa chứng minh.**

| Nếu | Thì |
|-----|-----|
| Demo / owner-operated với long-lived provision host + giám sát tay | Có thể vận hành có điều kiện — **không** mở self-serve rộng |
| Khách tự `start-machine` qua serverless API alone | **Không** — lifecycle phụ thuộc request lifetime |

---

## Owner-approved P0 implementation order

Không mở kiến trúc A1 mới. Không Ticket C. Thứ tự triển khai:

```text
P0-A  Durable Machine Lifecycle
      (provision + durable op + recovery + reconcile)
        ↓
P0-B  Production Billing Proof T11
        ↓
P0-C  Minimal Alerting (webhook)
        ↓
P0-D  Full Customer E2E
        ↓
P1    Security + Backup/Restore + Snapshot + Error UX
        ↓
GO-LIVE DECISION
```

Có thể **viết E2E customer-flow script sớm** làm baseline, rồi chạy lại sau P0-A.

### P0-A — Durable Machine Lifecycle (gộp blocker cũ #1–#3)

Mục tiêu **không** phải “provision luôn thành công”, mà:

> **Không có operation nào biến mất im lặng.**

```text
Start request → Durable operation/job → Provision → Machine row
  → Runtime ready → Workspace bind
```

Khi process chết:

```text
Operation pending → Recovery worker/cron → Reconcile
  → Continue / retry / TERMINAL_FAILURE
```

Mọi failure phải kết thúc một trong:

```text
SUCCESS | RETRYING | TERMINAL_FAILURE
```

**Cấm:** `accepted=true` → process chết → không biết gì → orphan order/machine → UI treo vô hạn.

### P0-B — T11 Single Runtime Billing Settlement

Gate bắt buộc (độc lập kiến trúc). Acceptance tối thiểu:

- start thành công; ghi `started_at` / billing anchor  
- Runtime chạy thời gian thực  
- stop/destroy → settlement thành công  
- `hours_remaining` giảm đúng policy  
- không double charge; destroy lần hai không charge tiếp  
- session trạng thái terminal hợp lệ  

**Không cần dual-run.** T12 = **N/A** nếu MVP tắt dual-run.

### P0-C — Minimal Alerting

Không xây monitoring platform. Chỉ:

```text
Critical event → DB/event log → Alert dispatcher → Webhook → Operator
```

| Event | Alert |
|-------|-------|
| Provision timeout | Có |
| Orphan Clore order | Có |
| Settlement failed | Có |
| Machine operation stuck | Có |
| Recovery exhausted | Có |

### P0-D — Full Customer E2E

Login → nạp giờ → start → Workspace → soạn → Generate → stop → kiểm tra billing  
(baseline script có thể viết sớm; gate xanh sau P0-A.)

---

## Architecture decision — Lifecycle Worker (chốt hướng)

**Vấn đề cốt lõi (không chỉ Hobby):**

> Provision lifecycle hiện đang phụ thuộc vào **execution lifetime của serverless request**; production self-serve cần **durable execution bên ngoài request lifetime**.  
> Pattern `void backgroundPromise` sau response vẫn rủi ro trên mọi serverless platform.

### Lựa chọn

| Option | Vai trò | Quyết định Owner |
|--------|---------|------------------|
| **A — Always-on Node Worker** | **Primary** provision + reconcile + recovery + settlement retry | **Khuyến nghị / chốt hướng MVP** |
| **B — Vercel Pro + Cron** | Recovery / idle / settle retry bổ trợ | OK hỗ trợ; **không** primary provision executor |
| **C — External Scheduler** | Sau này | Không cần lúc này |

Topology mục tiêu (mở rộng nhỏ, không đổi A1):

```text
Vercel Next     = Control Plane / API / Auth / Billing
Supabase        = Durable State / Operation Queue
Always-on Worker = Provision / Reconcile / Recovery / Settlement Retry
Clore / Vast    = GPU Runtime
CF Worker       = Workspace / Proxy
```

Nguyên tắc:

```text
Workspace ≠ Runtime
Control Plane ≠ Runtime
Serverless API ≠ Long-running Lifecycle Worker
```

**Reuse:** `machine-operation-worker`, `user-start-provision`, orphan/lease paths hiện có.  
Vercel chỉ **tạo durable operation** + trả trạng thái client; Worker luôn chạy thực thi.

### Quyết định còn mở trước khi code P0-A

| Câu hỏi | Trạng thái |
|---------|------------|
| Primary = Always-on Node Worker? | **Chốt hướng: Có** |
| Worker chạy **ở đâu** (host / process manager)? | **Chốt 2026-07-22: VPS nhỏ Linux always-on** (`systemd` hoặc Docker; không GPU) |

Gợi ý host (đã chốt): **VPS nhỏ Linux always-on** — `systemd` unit tại `deploy/systemd/gpuvietnam-lifecycle-worker.service`. Xem [LIFECYCLE_WORKER.md](./LIFECYCLE_WORKER.md).

---

## P0 blockers (map → P0-A/B/C/D)

| Cũ | Mới |
|----|-----|
| Durable provision + cron recovery + orphan reconcile | **P0-A** |
| Billing settle proof | **P0-B** (T11) |
| Alerting tối thiểu | **P0-C** |
| Full customer E2E | **P0-D** |

*(T12 dual-run settle: **N/A** cho MVP nếu dual-run OFF.)*

---

# 1. Provisioning & Machine Lifecycle

### 1.1 Start-machine hoàn tất sau `accepted` (→ P0-A)

```text
Requirement
  Sau POST start-machine, provision phải sống ngoài request lifetime:
  durable operation → SUCCESS | RETRYING | TERMINAL_FAILURE (không im lặng).
Status: BLOCKED
Evidence
  src/pages/api/user/start-machine.js — res { accepted: true } rồi
  void withBackgroundLogContext → completeUserStartProvision
  (không waitUntil / không enqueue durable provision job)
  scripts/a1-prod-e2e-gpu-continuity.mjs — buộc PROVISION_APP_URL long-lived Next
What is actually proven
  Provision + Runtime A/B thành công khi executor là Node dài (cùng prod DB/Clore).
Remaining gap
  Provision lifecycle phụ thuộc execution lifetime của serverless request;
  self-serve cần durable execution bên ngoài request (Always-on Worker — P0-A).
Severity: P0 → P0-A
```

### 1.2 Cron / recovery trên production deploy

```text
Requirement
  Idle check, infrastructure reconcile, machine_operations recovery, backup retention
  chạy theo lịch trên production.
Status: BLOCKED
Evidence
  vercel.json → "crons": []
  docs/APEX_NEXT_CUTOVER.md — Hobby giới hạn cron
  vercel.crons.pro.json — lịch Pro dự kiến (check-idle */5, process-machine-operations * * * * *, …)
What is actually proven
  Cron handlers tồn tại trong code; Pro config đã chuẩn bị sẵn file riêng.
Remaining gap
  Deploy hiện tại không chạy cron; recovery chỉ khi có long-lived Node (instrumentation).
Severity: P0
```

### 1.3 machine_operations queue drain

```text
Requirement
  Hàng đợi machine_operations được xử lý đáng tin cậy (primary + recovery).
Status: PARTIAL
Evidence
  src/lib/infrastructure/machine-operation-worker.js
  src/pages/api/cron/process-machine-operations.js (recovery_only)
  src/lib/infrastructure/machine-operation-worker-runner.js + instrumentation.js (30s tick)
What is actually proven
  Worker + kick-after-enqueue thiết kế cho Node dài; unit path có trong repo.
Remaining gap
  Không chứng minh drain ổn định trên topology Vercel-only.
Severity: P1
```

### 1.4 Orphan provider order ↔ machines row

```text
Requirement
  Không để Clore order sống mà DB thiếu/kẹt machine (và ngược lại);
  có timeout, detect, recover.
Status: PARTIAL
Evidence
  src/lib/gpu/providers/clore/clore-orphan-*.js + tests
  instrumentation.js → startCloreOrphanReconciliation()
  GATE2 report — E2E stall provision_gate / reconcile tay order 1972822
What is actually proven
  Logic orphan + metrics in-process tồn tại; E2E chứng minh failure mode thật.
Remaining gap
  Không chạy đáng tin trên Hobby; thiếu alert/runbook prod đã ký.
Severity: P0
```

### 1.5 Stop / destroy dừng máy và đóng session

```text
Requirement
  Stop/destroy hủy Runtime, revoke token, đóng gpu_session.
Status: PARTIAL
Evidence
  src/lib/destroy-pipeline.js / destroy-pipeline-run.js — closeSession + settle/skip
  auto-stop.js → runUnifiedDestroy
  Gate1 G3/G4 · Prod E2E destroy A/B (cancel_order + DB destroyed)
  COMFY_PROXY.md — stop/destroy revokes tokens
What is actually proven
  Pipeline thống nhất + Continuity destroy hoạt động trên GPU thật.
Remaining gap
  Chưa E2E chứng minh settle hours đúng sau stop trên prod (xem §2).
Severity: P1
```

### 1.6 Stuck provisioning lease / provision_gate

```text
Requirement
  Lease hết hạn được reclaim; UI không treo “Đang khởi tạo” vô hạn.
Status: PARTIAL
Evidence
  src/lib/provision-lease.js (lease ~90s, heartbeat, reclaim)
  AI_DEBUGGING.md · machines-provision-claim tests
  Prod E2E từng clear lease thủ công khi stuck
What is actually proven
  Mô hình lease + reclaim có trong code/tests.
Remaining gap
  Heartbeat chỉ sống nếu process provision còn; silent kill → UX treo đến khi reclaim.
Severity: P1
```

---

# 2. Billing & Usage Accounting

### 2.1 Tính giờ / settle phiên đơn (T11)

```text
Requirement
  Billing phiên đơn: đúng thời gian GPU / đúng giá; stop → settle không âm / không double.
Status: PARTIAL
Evidence
  src/lib/gpu/settlement.js · settlement-core.js · remaining-time.js · billing.js
  Unit: settlement*.test.mjs, remaining-time.test.mjs
  Destroy path gọi settleSession (trừ skipBilling)
What is actually proven
  Logic settle + remaining-time có tests; destroy gắn settle trong code.
Remaining gap
  Không có E2E prod: start → N phút → stop → đối chiếu hours_remaining / settlement_status.
Severity: P0
```

### 2.2 Stop/destroy dừng tính tiền

```text
Requirement
  Sau stop/destroy, không tiếp tục trừ giờ; session settled/skipped trong SLA.
Status: PARTIAL
Evidence
  destroy-pipeline-run.js closeSession + settleSession
  auto-stop (idle/credit) → unified destroy
  check-idle cron — tồn tại nhưng cron Hobby = off
What is actually proven
  Happy path destroy settle trong code + unit tests.
Remaining gap
  Idle auto-stop và settlement retry phụ thuộc cron/reconcile đang tắt trên Hobby.
Severity: P1
```

### 2.3 Dual-run settle (T12)

```text
Requirement
  Nếu dual-run: hệ số Admin (vd 1.65×) áp settle; không trừ 2 lần full.
Status: NOT DONE
Evidence
  E2E_TEST_GATES_V2.md — T12 còn “nối settle thật”
  dual-run-policy / AdminGpuPricingPanel /api/cp/dual-run — estimate/UI
  settlement-core.js — không wire dualRun multiplier vào settle
What is actually proven
  Hệ số Admin tồn tại cho estimate/policy UI.
Remaining gap
  Chưa nối settlement thật.
Severity: P0 nếu bật dual-run lúc launch; P2 / N/A nếu MVP tắt dual-run
```

### 2.4 Nạp giờ / ví (deposit)

```text
Requirement
  Khách nạp giờ / ví hoạt động đủ để vào gói và start GPU.
Status: PARTIAL
Evidence
  WalletDepositForm · TECH_DEBT — manual payment approval accepted debt
  Admin grant / inventory hours (owner test dùng inventory sẵn)
What is actually proven
  Flow ví/UI tồn tại; owner test không phụ thuộc deposit E2E.
Remaining gap
  Không có smoke Login → deposit approve → hours usable.
Severity: P1
```

---

# 3. Workspace / CP Continuity

### 3.1 Offline Workspace + CP SoT

```text
Requirement
  Soạn offline, lưu CP, restore session mới; Generate blocked khi offline.
Status: PASS
Evidence
  Gate2 Architecture Validation · Prod E2E steps 1–5
  Origin harden Worker→apex · A1 M1–M3
What is actually proven
  work.* + gpuvietnam.com giữ graph; marker restore qua session mới.
Remaining gap
  Không blocker Go-Live cho continuity cốt lõi.
Severity: N/A (đã PASS)
```

### 3.2 Runtime thay thế + Generate lại

```text
Requirement
  Runtime A mất → Runtime B → restore graph → Generate có output.
Status: PASS
Evidence
  Prod E2E Continuity PASS — orders 1972806 → 1972822, PNG A/B, rev 89→91
What is actually proven
  Chuỗi kiến trúc cốt lõi trên production hosts + Clore thật.
Remaining gap
  Không blocker kiến trúc; ops provision vẫn P0 (§1).
Severity: N/A (đã PASS)
```

### 3.3 Session Restore ≠ CUDA resume

```text
Requirement
  UX/API không claim resume CUDA khi đổi Runtime.
Status: PASS
Evidence
  Gate1 G5 session-restore · SessionRestoreBanner · ADR-005
What is actually proven
  jobResumed=false; E2E là re-generate trên Runtime mới.
Remaining gap
  —
Severity: N/A
```

### 3.4 G7 multi-hop revision

```text
Requirement
  Nhiều vòng sửa trên B rồi C giữ revision mới nhất.
Status: NOT DONE
Evidence
  GATE1_CONTINUITY_CHECKLIST G7 — khuyến nghị lâu dài
What is actually proven
  A→B một hop Continuity đã PASS.
Remaining gap
  Post-MVP / hardening — không P0 Go-Live MVP (quyết định product 2026-07-22).
Severity: P2
```

### 3.5 Ticket C (rebind không reload)

```text
Requirement
  Đổi Runtime không reload tab.
Status: NOT DONE
Evidence
  A1 contract explicit non-goal · Gate2 report
What is actually proven
  Reload/mint session OK cho Continuity.
Remaining gap
  Optional UX — không blocker MVP.
Severity: P2
```

---

# 4. Backup & Restore

### 4.1 Machine / workspace backup (R2)

```text
Requirement
  Backup workspace files theo entitlement; restore khi boot Runtime mới.
Status: PARTIAL
Evidence
  docs/BACKUP_RUNBOOK.md · machine-backup* · backup-quota/entitlement/reconcile
  SMART_RESTORE · workspace-restore gọi từ user-start-provision
  Unit tests D12 trong runbook
What is actually proven
  Stack backup + smart restore implement + tested ở mức unit/integration.
Remaining gap
  Retention cron off trên Hobby; chưa E2E khách chứng minh restore files sau destroy.
Severity: P1
```

### 4.2 Project Snapshot Save/Restore (T5)

```text
Requirement
  User Save snapshot → sửa → Restore đúng; assets còn.
Status: PARTIAL
Evidence
  /api/cp/snapshots · project_snapshots (B2)
  E2E_TEST_GATES_V2 T5 = Gate 2 — chưa có evidence PASS
What is actually proven
  API/schema tồn tại.
Remaining gap
  Chưa có vòng test T5 ký nhận.
Severity: P1
```

### 4.3 CP workflow vs machine backup (ranh giới)

```text
Requirement
  Graph sống trên CP; file/output lớn trên kho bền / backup — không nhầm hai lớp.
Status: PARTIAL
Evidence
  Architecture freeze · Prod E2E chỉ chứng minh CP graph + Comfy history/view trên Runtime
What is actually proven
  Graph Continuity không phụ thuộc backup R2.
Remaining gap
  Customer docs / UX phân biệt “bài đang soạn” vs “file trên máy” còn mỏng.
Severity: P2
```

---

# 5. Error States & Recovery

### 5.1 Provision fail / timeout / provider unavailable UX

```text
Requirement
  Khách thấy trạng thái rõ (fail/timeout), không treo vô hạn; có Support Code.
Status: PARTIAL
Evidence
  user-start-provision FAILED stage · DashboardOverview progress/toasts
  gpu-errors.js · LOGGING.md Support Code
What is actually proven
  Message path khi provision code chạy đến catch.
Remaining gap
  Silent kill background → UI có thể kẹt “Đang khởi tạo” đến lease stale;
  chưa E2E mọi mã lỗi Clore/Vast.
Severity: P1
```

### 5.2 GPU chết giữa Generate

```text
Requirement
  Attempt fail rõ; có thể chạy lại trên Runtime mới (không CUDA resume).
Status: PARTIAL
Evidence
  cp-runtime/failover.js + unit T7 fake
  Gate1 kill-provider · Prod E2E = destroy sau Generate (không mid-prompt)
What is actually proven
  Re-run Continuity sau mất Runtime.
Remaining gap
  Mid-prompt kill trên dashboard /prompt path chưa chứng minh prod.
Severity: P1
```

### 5.3 Session / restore banners

```text
Requirement
  Banner restore / boot timeline đúng, không claim CUDA resume.
Status: PARTIAL
Evidence
  SessionRestoreBanner · DashboardSessionBootTimeline · CpWorkspaceDuringBootCard
What is actually proven
  Components + Gate1 G5 API.
Remaining gap
  Chưa screenshot/E2E acceptance mọi state trên dashboard prod.
Severity: P2
```

---

# 6. Security & Access Control

### 6.1 Comfy access token (editor vs runtime)

```text
Requirement
  Editor upstream=null không proxy GPU; runtime token gắn machine/user;
  stop revoke token.
Status: PARTIAL
Evidence
  comfy-access-token.js · /api/session/comfy-access · Worker /enter + gvn_comfy
  A1 M1 production smoke · destroy revoke (COMFY_PROXY.md)
What is actually proven
  Mode tách editor/runtime; offline 503 A1_RUNTIME_OFFLINE; Continuity dùng mint đúng mode.
Remaining gap
  CF KV REST 401 (wrangler OK); chưa pen-test formal.
Severity: P1
```

### 6.2 Internal resolve auth

```text
Requirement
  /api/internal/comfy-proxy-resolve chỉ Worker với secret.
Status: PASS
Evidence
  comfy-proxy-resolve.js — Bearer COMFY_PROXY_SECRET, timing-safe
  COMFY_PROXY.md
What is actually proven
  Auth pattern đúng trong code.
Remaining gap
  Ops: xác nhận secret sync Worker↔Vercel (checklist deploy).
Severity: P1 (ops verify)
```

### 6.3 Không truy cập nhầm Workspace / Runtime người khác

```text
Requirement
  Token/session không mở upstream máy user khác.
Status: PARTIAL
Evidence
  Resolve theo token hash → userId/machineId sở hữu
  comfy-sync scoped auth.userId
What is actually proven
  Design ownership đúng; Continuity dùng owner user.
Remaining gap
  Security review / adversarial test chưa ký.
Severity: P1
```

### 6.4 Security review Go-Live

```text
Requirement
  Review bảo mật tối thiểu trước bán rộng.
Status: NOT DONE
Evidence
  Không có báo cáo security review gắn Go-Live trong docs/operations
What is actually proven
  —
Remaining gap
  Cần review có chủ đích (auth, secrets, proxy, admin).
Severity: P1
```

---

# 7. Provider Reliability & Failover

### 7.1 Bad-host exclusion / rent walk

```text
Requirement
  Host xấu bị loại; walk sang offer khác khi rent fail.
Status: PARTIAL
Evidence
  clore-bad-host-exclusion · vast-bad-host-exclusion · rent-candidate-walk
  clore-provision-gate · host-reputation/*
What is actually proven
  Logic + unit tests; Gate1/E2E rent thành công trên marketplace thật nhiều lần.
Remaining gap
  Reputation store local JSON không share multi-instance serverless.
Severity: P1
```

### 7.2 Clore orphan / cancel sau destroy

```text
Requirement
  Destroy hủy order provider; orphan được dọn.
Status: PARTIAL
Evidence
  Prod E2E cancel_order A/B code 0
  clore-orphan-reconcile (in-process)
What is actually proven
  Cancel trong Continuity script OK.
Remaining gap
  Orphan auto trên Hobby không tin cậy (§1.4).
Severity: P0 (cùng blocker orphan)
```

### 7.3 Job Attempt failover vs dashboard start path

```text
Requirement
  Ranh giới rõ: rent retry vs Job Attempt failover.
Status: PARTIAL
Evidence
  user-start-provision = rent path
  failover.js / dual-run = CP Job path
What is actually proven
  Hai lớp tồn tại trong codebase.
Remaining gap
  Product Go-Live phải ghi rõ: MVP Continuity = re-rent + CP graph;
  dual-run/Attempt API không phải đường dashboard Generate mặc định.
Severity: P2 (docs) / P1 nếu claim dual-run
```

### 7.4 Vast + Clore parity (T13/T14)

```text
Requirement
  Provider trong routing có smoke rent→generate→destroy.
Status: PARTIAL
Evidence
  Clore: Gate1 + Prod E2E PASS
  Vast: client/adapter + tests trong repo — chưa gate Continuity prod gần đây
What is actually proven
  Clore là path đã chứng minh Continuity.
Remaining gap
  Nếu routing bật Vast lúc launch → cần T13 smoke; nếu Clore-only MVP → Vast = N/A tạm.
Severity: P1 nếu multi-provider; P2 nếu Clore-only
```

---

# 8. Monitoring & Alerting

### 8.1 Structured logging / Support Code

```text
Requirement
  Log đủ để debug provision/billing/proxy; Support Code cho khách.
Status: PARTIAL
Evidence
  LOGGING.md · pino channels · x-support-code
What is actually proven
  Logging model có trong app khi chạy Node dài / capture được.
Remaining gap
  Vercel serverless logs phân tán; chưa runbook tra cứu tập trung.
Severity: P1
```

### 8.2 Alerting (provision timeout, orphan, settle fail, sync fail)

```text
Requirement
  Alert tối thiểu khi Runtime/provision fail lặp, orphan, settlement_failed.
Status: NOT DONE
Evidence
  E2E_TEST_GATES_V2 Gate 2 yêu cầu alert
  TECH_DEBT — basic monitoring, no notification system
  Không thấy Slack/Pager/webhook operator trong src/
What is actually proven
  Metrics in-memory (orphan/lease/ops) “scrape later” — chưa export/alert.
Remaining gap
  Zero automated operator alert.
Severity: P0
```

### 8.3 Metrics export

```text
Requirement
  Counter provision/orphan/billing/sync quan sát được.
Status: PARTIAL
Evidence
  clore-orphan-metrics · provision-lease-metrics · machine-operation-metrics
What is actually proven
  Counters in-process.
Remaining gap
  Không Prometheus/admin scrape; mất khi process restart.
Severity: P1
```

---

# 9. Complete Customer E2E Flow

### 9.1 Continuity Workspace/CP/Generate (đã có)

```text
Requirement
  Offline → CP → Runtime A → Generate → destroy → Runtime B → Generate.
Status: PASS
Evidence
  tmp/a1-prod-e2e-prod-e2e-1784729461467.json
What is actually proven
  Kiến trúc + proxy + GPU thật.
Remaining gap
  Provision qua local Next — không đủ cho self-serve apex (§1.1).
Severity: N/A
```

### 9.2 Full customer journey

```text
Requirement
  Login → nạp giờ → start GPU (apex) → Workspace → soạn → Generate →
  stop/destroy → kiểm tra billing.
Status: NOT DONE
Evidence
  Không có script/report PASS cho chuỗi đầy đủ
  Prod E2E bỏ deposit/login UI; billing không assert settle
What is actually proven
  Các khúc riêng (Continuity, Gate1, M4).
Remaining gap
  Một vòng E2E khách có kiểm soát còn thiếu — P0 trước self-serve.
Severity: P0
```

### 9.3 Gate 2 product tests còn lại

```text
Requirement
  T5 snapshot, T11 billing, T20 video (nếu bán video), dashboard states.
Status: NOT DONE / PARTIAL
Evidence
  E2E_TEST_GATES_V2 § Gate 2
What is actually proven
  Một phần implement; chưa ký PASS.
Remaining gap
  Chạy checklist có chủ đích sau khi P0 lifecycle ổn.
Severity: P1 (T5/T20) · P0 (T11)
```

---

# 10. Go-Live Decision

### 10.1 Architecture ready?

```text
Requirement
  Kiến trúc cốt lõi đã đóng sổ.
Status: PASS
Evidence
  GATE2_ARCHITECTURE_VALIDATION_REPORT.md — PASS WITH CONSTRAINTS
What is actually proven
  Workspace cố định · CP SoT · Runtime disposable · Generate A→B.
Remaining gap
  Constraints ops đã chuyển sang audit này.
Severity: N/A
```

### 10.2 Self-serve Go-Live ready?

```text
Requirement
  Khách tự phục vụ an toàn trên production topology hiện tại.
Status: BLOCKED
Evidence
  Toàn bộ P0 § trên
What is actually proven
  Owner-operated Continuity có điều kiện (long-lived provision host).
Remaining gap
  Xem verdict NOT READY.
Severity: P0
```

### 10.3 Launch with conditions (owner-operated)?

```text
Requirement
  Có thể bán hẹp / vận hành tay nếu chấp nhận điều kiện.
Status: PARTIAL
Evidence
  Continuity PASS · billing/alert/cron gaps
What is actually proven
  Product demo / limited beta với operator theo dõi + provision trên Node dài khả thi về kiến trúc.
Remaining gap
  Phải ghi điều kiện rõ: không self-serve start trên Hobby; monitoring tay; dual-run off.
Severity: P1 (quyết định business)
```

---

## Tổng hợp theo severity (sau Owner review)

### P0 — trước self-serve (thứ tự triển khai)

| ID | Item |
|----|------|
| **P0-A** | Durable Machine Lifecycle (provision + queue + recovery + reconcile) |
| **P0-B** | Production Billing Proof **T11** |
| **P0-C** | Minimal Alerting (webhook 5 event) |
| **P0-D** | Full Customer E2E |
| — | T12 = **N/A** nếu MVP dual-run OFF |

### P1 — trước bán rộng

| # | Item |
|---|------|
| 1 | Error UX timeout/terminal fail |
| 2 | Backup/restore E2E + retention |
| 3 | T5 snapshot |
| 4 | Security review |
| 5 | Mid-generate death policy/test |
| 6 | Logging/metrics tập trung |
| 7 | Deposit/wallet smoke |
| 8 | Provider multi (nếu không Clore-only) |

### P2 — sau Go-Live MVP / hardening

| # | Item |
|---|------|
| 1 | Ticket C |
| 2 | G7 multi-hop |
| 3 | Dual-run / warm pool |
| 4 | KV REST token cleanup |
| 5 | CI pin-check |
| 6 | Video T20 (nếu image bán video) |

---

## Recommendation (tiếp theo)

```text
1. Dual-run OFF cho MVP → T12 N/A.
2. P0-A: Always-on Node Worker = primary lifecycle executor
   (Vercel tạo durable op; Worker chạy user-start-provision / machine-operation-worker).
3. Owner chốt HOST chạy worker → rồi mới mở PR P0-A.
4. P0-B T11 billing E2E → P0-C alerts → P0-D full customer E2E (hoặc draft E2E sớm).
5. P1 → GO-LIVE DECISION (READY / READY WITH CONDITIONS / NOT READY).
```

**Không** mở Ticket C / dual-run / warm pool trong bước fix P0.

---

## Sign-off

| | |
|---|---|
| Audit type | Read-only (+ Owner priority amendments) |
| Code changes | **None** |
| Owner review | **Accepted 2026-07-22** — verdict NOT READY; P0-A/B/C/D order; Worker = always-on Node |
| Blocker trước code P0-A | **Resolved** — VPS Linux always-on |
| Next | Apply migration 0049 · deploy worker on VPS · smoke start-machine → operation completed |
