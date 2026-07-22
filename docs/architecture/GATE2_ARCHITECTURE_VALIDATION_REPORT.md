# Gate 2 — Architecture Validation Report

| | |
|---|---|
| **Status** | Closed for architecture evidence |
| **Date** | 2026-07-22 |
| **Scope** | Audit + đóng sổ bằng chứng kiến trúc — **không** feature mới, **không** Ticket C, **không** đổi kiến trúc |
| **Primary evidence** | Production E2E Continuity **PASS** (`tmp/a1-prod-e2e-prod-e2e-1784729461467.json`) |
| **Do not use** | Các job shell E2E cũ fail/timeout trước lần PASS cuối — không đánh giá lại |

---

## Phân biệt tên “Gate 2”

| Tài liệu | Nghĩa |
|----------|--------|
| **Báo cáo này** | **Architecture Validation** — kiến trúc cốt lõi đã được chứng minh đến đâu |
| [E2E_TEST_GATES_V2.md](./E2E_TEST_GATES_V2.md) § Gate 2 | **Go-Live (P1)** — billing, snapshot, video smoke, dashboard, alerts… |

Hai việc **không trộn**. Report này chỉ đóng sổ kiến trúc. Go-Live checklist là bước tiếp theo.

---

## Evidence base (đã đọc)

| Artifact | Vai trò |
|----------|---------|
| [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) | Thứ tự B1–B4 / A-track |
| [E2E_TEST_GATES_V2.md](./E2E_TEST_GATES_V2.md) | Định nghĩa Gate 1–4 (merge vs go-live) |
| [GATE1_TEST_REPORT.md](./GATE1_TEST_REPORT.md) | G1–G6 Continuity GPU thật (`:v3.1`) **PASS** |
| [GATE1_CONTINUITY_CHECKLIST.md](./GATE1_CONTINUITY_CHECKLIST.md) | G1–G6 bắt buộc; G7 khuyến nghị Go-Live |
| [A0_FRONTEND_SEPARATION_REPORT.md](./A0_FRONTEND_SEPARATION_REPORT.md) | A0 **YES with constraints** |
| [A0_5_EDITOR_WITHOUT_RUNTIME_REPORT.md](./A0_5_EDITOR_WITHOUT_RUNTIME_REPORT.md) | A0.5 **PASS WITH CONSTRAINTS** |
| [A1_ENDPOINT_PROXY_CONTRACT.md](./A1_ENDPOINT_PROXY_CONTRACT.md) | Contract A1 M1–M4; pins FE/Runtime/Image |
| A1 M1–M4 smokes / reports | Workspace shell → Manifest → CP sync → Generate proxy |
| Origin Hardening (`scripts/a1-origin-harden-smoke.mjs`) | Apex CP + Worker→apex; `quickTunnelRequired: false` |
| **Production E2E Continuity** | Runtime A→B + Generate cả hai từ graph CP |

### Production E2E Continuity — IDs (bằng chứng chính)

| Field | Value |
|-------|--------|
| Marker | `prod-e2e-1784729461467` |
| Workflow | `f287ec3d-f268-4ddb-a0cd-460deec8e5bf` |
| Revisions | compose **89** → after Gen A **90** → after Gen B **91** |
| Runtime A | machine `8eb4b5d1-beb1-49f7-936f-88ec61c4d897` · Clore `1972806` · `:v3.2` · `1ny6tgr3nifw6.us.clorecloud.net` |
| Runtime B | machine `00ddbd6e-96ea-4584-baab-e8b59b37e929` · Clore `1972822` · `:v3.2` · `uwt8lr50cu8im.us.clorecloud.net` |
| Prompt A | `407edf55-2ec5-4aff-91e4-11d2287b0f61` · PNG ~455 KB · `sd_xl_base_1.0.safetensors` |
| Prompt B | `9a23869c-8fc0-43aa-a317-4924a86f252d` · PNG ~273 KB · same ckpt · same marker |
| Report file | `tmp/a1-prod-e2e-prod-e2e-1784729461467.json` |
| Topology | `gpuvietnam.com` = CP · `work.gpuvietnam.com` = Workspace · GPU = disposable Runtime |

---

## Status vocabulary (đúng một trạng thái / mục)

| Status | Nghĩa |
|--------|--------|
| **PASS** | Có evidence thực tế đủ cho yêu cầu kiến trúc |
| **PASS WITH CONSTRAINTS** | Đã chứng minh; còn giới hạn ops / scope / completeness |
| **PARTIAL** | Đã implement hoặc có bằng chứng hẹp; chưa đủ evidence end-to-end |
| **NOT DONE** | Chưa làm / ngoài scope đã cố ý hoãn |

---

## Audit — 10 trục bắt buộc

### 1. Workspace tách khỏi GPU Runtime

```text
Requirement
  Một URL Workspace cố định; shell/editor sống khi chưa có / sau khi mất GPU.
Status
  PASS WITH CONSTRAINTS
Evidence / report / test
  A0 YES with constraints · A0.5 PASS WITH CONSTRAINTS · A1 M1 production smoke
  (work.* shell offline) · Prod E2E steps 1 & 10 (offline + A1_RUNTIME_OFFLINE)
What is actually proven
  work.gpuvietnam.com phục vụ Comfy shell offline; Generate bị chặn rõ khi không Runtime;
  sau destroy A, Workspace vẫn mở được ở editor mode.
Remaining constraint
  Offline catalog = Supported Manifest (không full custom-node universe);
  Ticket C (rebind không reload tab) chưa làm — đổi Runtime vẫn mint session / reload OK.
```

### 2. CP là SoT của Project/Workflow

```text
Requirement
  Graph lưu trên Control Plane (cp_workflows); không phụ thuộc localStorage / ổ GPU.
Status
  PASS
Evidence / report / test
  Gate1 G1–G2 · A1 M3 · Origin harden Worker→apex + apex /api/cp/comfy-sync
  · Prod E2E steps 2–5 (Worker PATCH/GET) + step 10 (CP còn sau destroy A)
What is actually proven
  Soạn offline → lưu CP qua work.* → apex; session mới restore đúng marker từ CP;
  revision tăng có kiểm soát (89→90→91 trong E2E).
Remaining constraint
  CF KV REST token vẫn 401 (wrangler put OK) — ops debt, không phá SoT path đã harden.
```

### 3. Runtime có thể thay thế

```text
Requirement
  GPU / Runtime là disposable; có thể cấp Runtime B sau khi A mất.
Status
  PASS WITH CONSTRAINTS
Evidence / report / test
  Gate1 G3 (Stop→máy mới) · G4 (kill Provider→máy mới)
  · Prod E2E Runtime A destroy → Runtime B (orders 1972806 → 1972822)
What is actually proven
  Hai Runtime Clore khác nhau, cùng image family `:v3.2`, cùng Workspace/CP;
  khách không cần URL Comfy per-GPU (chỉ work.*).
Remaining constraint
  start-machine background trên Vercel Hobby có thể chết sau accept → E2E dùng
  long-lived Next cho provision (cùng prod DB/Clore). Machine row B từng cần
  reconcile sau stall provision_gate — ops/lifecycle, không phủ nhận khả năng thay Runtime.
```

### 4. Graph không mất qua Stop / Destroy / Provider failure

```text
Requirement
  Mất Runtime ≠ mất graph / project trên CP.
Status
  PASS
Evidence / report / test
  Gate1 G3 Stop · G4 kill Provider · Prod E2E step 10 destroy A + CP marker còn (rev 90)
What is actually proven
  Stop dashboard, cancel Clore order, và destroy trong E2E đều để lại graph trên CP;
  session-restore API (Gate1 G5) khẳng định projectContinues, không job resume.
Remaining constraint
  G7 multi-hop “revision mới nhất qua nhiều vòng sửa trên B rồi C” chưa chạy riêng
  (khuyến nghị Go-Live checklist, không bắt buộc Architecture Validation).
```

### 5. Generate lại trên Runtime B từ graph đã restore

```text
Requirement
  Sau Runtime B, restore graph từ CP rồi Generate thành công với output xác minh được.
Status
  PASS
Evidence / report / test
  Prod E2E steps 11: restore marker → Generate B → history/view PNG
  promptId 9a23869c-… · pairedWithA 407edf55-…
What is actually proven
  Chuỗi đầy đủ: offline compose → CP → Runtime A Generate → destroy A →
  Runtime B restore cùng marker → Generate B (SDXL) → PNG trên Workspace proxy.
Remaining constraint
  Không claim Job/Attempt dual-run hoặc CUDA mid-job resume; đây là re-run trên Runtime mới.
```

### 6. Offline editor

```text
Requirement
  Soạn/sửa graph khi không có GPU; Generate blocked rõ ràng.
Status
  PASS WITH CONSTRAINTS
Evidence / report / test
  A0.5 lab scenarios 1–7 · A1 M1/M2 · Prod E2E steps 1–3
What is actually proven
  Editor boot + edit + CP save offline trên lab và trên work.* production;
  POST /prompt → 503 `A1_RUNTIME_OFFLINE` (prod) / `A05_RUNTIME_OFFLINE` (lab).
Remaining constraint
  Offline object_info = Supported Manifest snapshot (A1 M2: ~1269 nodes trong M4 smoke);
  live Runtime có thể nhiều node hơn khi online — đúng design.
```

### 7. Online proxy HTTP + WS

```text
Requirement
  Workspace → Proxy → Runtime: HTTP (prompt/history/view/…) + WebSocket khi Runtime online.
Status
  PASS WITH CONSTRAINTS
Evidence / report / test
  A1 M4 local + production smokes (`tmp/a1-m4-report-*.json`) · Prod E2E Gen A/B
  (object_info live, /prompt, history, view PNG qua work.*)
What is actually proven
  Path-split: shell/extensions Workspace-owned; runtime paths proxy khi online;
  WS fix (pass original Request) đã smoke trong M4; Generate thật qua proxy trên Clore.
Remaining constraint
  M4 production từng bind tunnel Docker cho một số smoke; Prod E2E dùng HTTPS Clore thật.
  Upload/WS edge cases khách thật → Go-Live / monitoring.
```

### 8. Version lock FE ↔ Runtime ↔ Image

```text
Requirement
  Pin đồng bộ FE package ↔ Comfy backend ↔ Official Image.
Status
  PASS WITH CONSTRAINTS
Evidence / report / test
  A1_ENDPOINT_PROXY_CONTRACT pins · A0.5 pin 1.45.21 / Comfy 0.28.0
  · Prod E2E image dieuhaukieuhanh/gpuvietnam-comfyui:v3.2
  · Worker FE_PIN / vendor script
What is actually proven
  Workspace FE pin 1.45.21; Runtime E2E báo ComfyUI 0.28.0; image `:v3.2` family;
  contract ghi version lock là hard requirement.
Remaining constraint
  CI pin-check (A1 M5) chưa đóng sổ như gate tự động; `:v3` legacy vẫn tồn tại —
  không ghi đè `:v3`; shipping path dùng `:v3.1`/`:v3.2` test/prod theo env.
```

### 9. Origin production ổn định, không phụ thuộc Quick Tunnel

```text
Requirement
  CP Origin = gpuvietnam.com; Worker resolve/sync không cần trycloudflare cho CP.
Status
  PASS WITH CONSTRAINTS
Evidence / report / test
  Origin harden smoke: Worker CP sync → apex; apex /api/cp/comfy-sync;
  tunnelDependency.quickTunnelRequired = false · Vercel prod deploy có CP routes
What is actually proven
  Topology production: apex = CP/API · work.* = Workspace/Proxy · không cần Quick Tunnel
  cho đường sync graph.
Remaining constraint
  CF_API_TOKEN KV REST 401 (wrangler OAuth OK); provision dài trên Hobby không bền —
  thuộc vận hành Go-Live, không phủ nhận Origin harden PASS.
```

### 10. Không claim CUDA / session resume khi đổi Runtime

```text
Requirement
  Đổi Runtime = Session/Project restore + Attempt/Generate lại; không resume CUDA/queue.
Status
  PASS
Evidence / report / test
  Gate1 G5: restoreKind=session, jobResumed=false, projectContinues=true
  · ADR-005 / ARCHITECTURE_V2_FREEZE · Prod E2E: Gen B là prompt mới trên Runtime mới
What is actually proven
  API session-restore không claim CUDA resume; E2E Continuity chứng minh re-generate,
  không “tiếp tục” process Comfy cũ.
Remaining constraint
  T7 (GPU chết giữa Generate → Attempt B) có logic/unit + Gate1 kill-provider path;
  chaos mid-prompt trên prod khách → hardening / Go-Live, không bắt buộc đóng Architecture Validation.
```

---

## Milestone roll-up (kiến trúc)

| Milestone | Status | Ghi chú ngắn |
|-----------|--------|--------------|
| B0 / Continuity (Gate1 G1–G6) | **PASS** | GPU thật `:v3.1` |
| A0 Frontend separation | **PASS WITH CONSTRAINTS** | YES with constraints |
| A0.5 Editor without Runtime | **PASS WITH CONSTRAINTS** | Lab + contract |
| A1 M1 Workspace shell | **PASS** | work.* offline production |
| A1 M2 Supported Manifest | **PASS WITH CONSTRAINTS** | Offline catalog subset |
| A1 M3 CP sync Workspace | **PASS** | Worker→apex sau Origin harden |
| A1 M4 Generate proxy | **PASS** | HTTP(+WS) + history/view |
| Origin Hardening | **PASS WITH CONSTRAINTS** | Không phụ thuộc Quick Tunnel CP |
| Production E2E Continuity | **PASS** | A→B Generate từ CP graph |
| Ticket C (no-reload rebind) | **NOT DONE** | Cố ý hoãn |
| Dual-run / Warm pool | **NOT DONE** | Ngoài Architecture Validation này |
| G7 multi-hop revision | **PARTIAL / NOT DONE** | Khuyến nghị trước Go-Live lâu dài |

---

## Overall verdict

```text
ARCHITECTURE VALIDATION: PASS WITH CONSTRAINTS
```

Kiến trúc cốt lõi GPUVietnam **đã được chứng minh trên production hosts + GPU Clore thật**:

```text
Workspace offline → soạn/sửa → lưu CP → Runtime A → Generate
  → Runtime A mất → Runtime B → restore graph → Generate tiếp
```

**Đủ để chuyển giai đoạn** từ “chứng minh có làm được không” sang **Go-Live Readiness** (an toàn vận hành / bán).  
**Chưa đủ** để tuyên bố sản phẩm Go-Live xong theo [E2E_TEST_GATES_V2.md](./E2E_TEST_GATES_V2.md) § Gate 2 (billing, snapshot, video, alerts, …).

---

## Những gì kiến trúc đã chứng minh chắc chắn

1. Workspace (`work.*`) tách khỏi GPU Runtime; offline edit + Generate blocked.  
2. Control Plane (`gpuvietnam.com` / `cp_workflows`) là SoT graph; restore không phụ thuộc localStorage.  
3. Runtime thay thế được (A→B); graph không mất qua destroy/kill Provider (Gate1 + Prod E2E).  
4. Generate trên Runtime B từ graph đã restore từ CP, có output PNG xác minh.  
5. Origin production cho CP sync không phụ thuộc Quick Tunnel.  
6. Session Restore ≠ Job/CUDA Resume (API + hành vi E2E).  
7. Version lock FE 1.45.21 ↔ Comfy 0.28.0 ↔ image `:v3.2` family đã dùng trong E2E.

---

## Những gì vẫn chưa được chứng minh (kiến trúc / sản phẩm)

| Hạng mục | Phân loại |
|----------|-----------|
| Ticket C — đổi Runtime không reload tab | **NOT DONE** (optional UX) |
| G7 — nhiều vòng sửa graph trên B rồi C giữ revision mới nhất | **NOT DONE** (khuyến nghị Go-Live) |
| Dual-run / Warm-Ephemeral / Ticket C stack | **NOT DONE** (Gate 3 / product) |
| Billing settle đầy đủ trên E2E khách (T11/T12) | **Go-Live** — ngoài Architecture Validation |
| Snapshot Save/Restore (T5) | **Go-Live** |
| Smoke video (T20) | **Go-Live** |
| Provision bền 100% trên Vercel Hobby không local Next | **Ops / Go-Live blocker candidate** |
| CF KV write qua REST token app | **Ops polish** (workaround wrangler) |
| Mid-Generate kill → Attempt B output (T7 prod chaos) | **PARTIAL** — hardening |

---

## Blocker trước Go-Live (không phải “thiếu kiến trúc”)

1. **Machine lifecycle / provision trên serverless** — background `completeUserStartProvision` sau `accepted` không bền trên Hobby; cần worker bền hoặc Pro cron / durable queue trước khách tự start máy.  
2. **Reconcile orphan Clore order ↔ machines row** — E2E từng gặp stall `provision_gate`; cần runbook/monitor trước self-serve.  
3. **Go-Live checklist chưa chạy** — billing, error states UX, backup/restore, security review, monitoring/alerts.  
4. **E2E user-flow hoàn chỉnh** (đăng nhập → nạp giờ → start → soạn → generate → stop) chưa thay bằng một vòng khách thật có kiểm soát.

Các mục trên **không phủ nhận** Architecture Validation PASS WITH CONSTRAINTS.

---

## Polish / optional (không chặn chuyển giai đoạn)

- Ticket C (rebind không reload) — chỉ khi UX đổi Runtime tạo giá trị rõ.  
- Sửa scope `CF_API_TOKEN` KV Write.  
- G7 multi-hop revision.  
- A1 M5 CI pin-check + docs polish.  
- Dual-run / warm pool — Gate 3.

---

## Recommendation

| Câu hỏi | Trả lời |
|---------|---------|
| Architecture Validation đủ chặt để đóng sổ? | **Có** — với constraints đã ghi; bằng chứng chính = Prod E2E Continuity PASS |
| Chuyển sang Go-Live Readiness Checklist? | **Có — nên chuyển ngay** |
| Mở Ticket C / dual-run / warm pool? | **Không** trong bước này |
| Sửa code ngay sau report này? | **Không** — chờ review report rồi mới mở Go-Live checklist / fix blocker |

```text
Gate 2 Architecture Validation
        ↓
Go-Live Readiness Checklist   ← next
        ↓
E2E User Flow thực tế
        ↓
Fix blocker Go-Live
        ↓
Go-Live
        ↓
Ticket C (optional)
```

---

## Sign-off

| Role | Note |
|------|------|
| Executor | Cursor agent — audit only (2026-07-22) |
| Owner review | **Pending** — xác nhận report đủ chặt trước khi mở Go-Live checklist |
| Code changes in this ticket | **None** |
