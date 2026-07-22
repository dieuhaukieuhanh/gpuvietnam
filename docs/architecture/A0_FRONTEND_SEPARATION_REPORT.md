# A0 — Frontend Separation Report

| | |
|---|---|
| **Status** | Spike complete (no A1 code) |
| **Date** | 2026-07-21 |
| **Evidence base** | ComfyUI tickets #001–#006 (`D:/GPU + AI/Web/ComfyUI/*_capture/`) · ADR-005 · ARCHITECTURE_V2_FREEZE · COMFY_PROXY · B2 · image pin `comfyui-frontend-package==1.45.20` |
| **Question** | Không chỉ “có tách được không?” mà **“có đáng tách Frontend khỏi Runtime không?”** |

---

## 1. Verdict

| Field | Value |
|-------|--------|
| **Technical** | **YES with constraints** |
| **Worth it for GPUVietnam?** | **Có — đáng đầu tư**, nhưng **không phải ngay lập tức** |
| **Gate before A1** | Lab chứng minh câu 4 (editor offline) + B0 ổn trên máy image mới |
| **Recommendation** | **Hoãn A1** → hoàn thiện B0 → A0.5 lab (1–2 ngày) → rồi A1 |

**Không phải NO.** Thay toàn bộ execution bằng Middleware thì Impossible (#005) — đó không phải scope A0.  
**Không phải YES sạch.** Stock Comfy FE vẫn cần API/settings/object_info/extensions từ *một* Runtime (hoặc mirror trung thực); tách chỉ là **host UI + transport**, không tách engine.

### Roadmap đã chốt (không đổi thêm)

**Ưu tiên:** Gate 1 (GPU thật) **trước** A0.5. Không mở A0.5/A1 khi Gate 1 chưa PASS.

```text
Architecture v2 → B1/B2/B3 (implement)
        ↓
Gate 1 Continuity — 6 bài G1–G6 trên GPU thật
  (SoT, tắt browser, stop, kill Provider, restore, generate)
  → docs/architecture/GATE1_CONTINUITY_CHECKLIST.md
        ↓
A0.5 Lab — editor không Runtime?
        ↓
PASS → A1 → B' → C → D
FAIL → dừng A1, tiếp củng cố B0
```

Giá trị dài hạn A1 (ngoài continuity): **một URL Workspace** — khách không “vào máy”, không đổi URL khi đổi GPU/provider; Comfy canvas sau này chỉ là một panel trong Workspace (Prompt Library, Assets, History, Billing, …).

---

## 2. Kiến trúc đề xuất (sau A1 — mục tiêu)

```text
Browser
  │
  ▼
Control Plane (Next / brand host)
  ├── Static ComfyUI Frontend  (comfyui-frontend-package assets)
  ├── Project / Workflow SoT   (cp_workflows — đã có từ B0)
  └── Runtime Adapter / Proxy  (HTTP + WS → Runtime hiện tại)
        │
        ▼
   Runtime GPU (Python ComfyUI)
     HTTP API · WebSocket · Execution · CUDA · FS · custom_nodes
```

**So với hiện tại**

```text
Browser → work.* Worker → (static FE + API + WS) trên cùng GPU process
```

| Khía cạnh | Hiện tại (B0) | Sau A1 |
|-----------|---------------|--------|
| UI sống khi GPU chết | Không (tab `work.*` chết theo upstream) | Có (FE trên CP) |
| Đổi GPU | Mở `workUrl` mới / reload UI | Reconnect proxy → Runtime B (Ticket C) |
| Graph không mất | Có (cp_sync / SoT) | Có (B' sync từ FE-on-CP) |
| Generate | Cần Runtime | Cần Runtime (disable khi offline) |

---

## 3. Contract FE ↔ Runtime

### 3.1 Boot (editor) — bắt buộc proxy hoặc stub

Từ #001 / #003 (thứ tự quan sát được):

| Method | Path | Vai trò | Offline (chưa có GPU) |
|--------|------|---------|------------------------|
| GET | `/` + `/assets/*` | Static shell | **Serve từ CP** |
| GET | `/api/users` | User bootstrap | Stub / CP |
| GET | `/api/settings` | **Hard-fail nếu thiếu** (#001) | Stub tối thiểu trên CP |
| GET | `/api/userdata*` | Workflows/settings files | CP SoT hoặc stub 404 mềm |
| GET | `/api/i18n` | i18n | Static / stub |
| GET | `/api/system_stats` | Banner / status | Stub “runtime offline” |
| GET | `/api/extensions` | List ESM paths | Catalog từ Image Spec **hoặc** empty + core only |
| GET | `/extensions/**` | Extension JS/CSS | Core từ FE package; custom = Runtime hoặc offline subset |
| GET | `/api/object_info` | Node defs + COMBO models | **Catalog tĩnh theo Image Spec** (offline) / live khi có Runtime |
| GET | `/api/experiment/models` | Model browser | Optional offline |
| WS | `/ws` | Progress / status | Chỉ khi có Runtime |

### 3.2 Generate (execution) — chỉ khi có Runtime

| Method | Path | Owner |
|--------|------|--------|
| POST | `/prompt` | Runtime |
| GET | `/queue`, `/interrupt`, `/history`, `/history/{id}` | Runtime |
| GET | `/view`, upload APIs | Runtime FS |
| WS | `/ws` (`clientId`, progress, preview) | Runtime |

### 3.3 GPUVietnam-specific

| Path | Today | After A1 |
|------|-------|----------|
| `/gpuvietnam/cp/sync` | Worker → Next (B0) | FE-on-CP gọi `/api/cp/comfy-sync` trực tiếp (B') |
| `/gpuvietnam/backup/flush` | Python trên Runtime | Vẫn Runtime-only |

**Invariant giữ nguyên:** Control Plane orchestration **không** gọi dialect Comfy trực tiếp ngoài Adapter/Proxy biên (ADR-005 / RuntimePort).

---

## 4. Kill points (KHÔNG thể tách khỏi Runtime)

| ID | Kill point | Evidence |
|----|------------|----------|
| K1 | `validate_prompt` / `PromptExecutor` / queue worker | #005 |
| K2 | CUDA / VRAM / model tensor load | #005 |
| K3 | Custom node **Python** execution (cùng process) | #003 KP-5, #005 |
| K4 | Authoritative live `NODE_CLASS_MAPPINGS` | #005 |
| K5 | Extension JS của pack chỉ xuất hiện sau **import Python thành công** | #003 KP-1 |
| K6 | COMBO model lists gắn `object_info` + FS Runtime | #003 KP-2 |
| K7 | Direct FS `input/` `output/` `models/` (không VFS sẵn) | #004 |
| K8 | `gpuvietnam_backup` PromptServer route | repo extension |

**Kết luận kill:** Tách Frontend ≠ thay Runtime. Ai hứa “không cần Comfy Python nữa” là **NO** (#005 đã reject).

---

## 5. Bảy câu hỏi bắt buộc

### Q1 — Frontend có chạy độc lập không?

| Tiêu chí | Kết quả |
|----------|---------|
| Build/package riêng (`comfyui-frontend-package`) | **PASS** — đã pin trong image; upstream tách FE package |
| Serve từ host không phải GPU | **PASS in principle** — static files; hôm nay Python `web.static` chỉ là cách serve |
| Không cần Python **để serve HTML/JS** | **PASS** |
| Stock UI idle không gọi API nào | **FAIL** — hard-depend `/api/settings`, cần extensions + object_info (#001/#003) |

**Trả lời Q1:** Shell độc lập = YES. “Stock Comfy không cần *bất kỳ* backend” = NO. Offline editor cần **stub/catalog trên CP**.

### Q2 — Runtime còn phải cung cấp gì?

Xem §3. Tóm tắt: **HTTP execution + WS + live object_info/extensions khi Generate**, upload/view/FS.  
Adapter/Proxy chịu transport; Runtime chịu truth của node registry + CUDA.

### Q3 — Những gì không thể tách?

Xem §4 (K1–K8).

### Q4 — Frontend có làm việc khi chưa có Runtime? (Ticket D thu nhỏ)

| Hành vi | Trạng thái evidence |
|---------|---------------------|
| Mở editor shell | Khả thi nếu stub settings + static assets |
| Thêm node / kéo dây / sửa graph | **Chưa lab trong repo** — cần object_info (static catalog theo Image Spec là đường khả thi #003: FE chấp nhận JSON đúng shape) |
| Lưu graph lên CP | **Đã có đường** (B0 SoT); sau A1 chuyển B' |
| Generate disable | Product rule — chưa implement UI gate |
| Không nổ UI khi Runtime absent | **UNKNOWN** cho stock FE — cần A0.5 lab |

**Trả lời Q4 hôm nay:** **Chưa PASS.** Đây là điều kiện bắt buộc trước khi commit A1 lớn.  
A0.5 (1–2 ngày): serve FE tĩnh + stub `/api/settings` + object_info snapshot từ image Official Pack → chứng minh soạn/lưu không GPU.

### Q5 — Chi phí bảo trì upstream

| Rủi ro | Mức | Ghi chú |
|--------|-----|---------|
| Pin kép FE package ↔ Comfy backend ↔ Official Image | **Cao** | Đã lệch nhẹ (image `1.45.20` vs investigate `1.45.21`) |
| Thêm/đổi API boot path | **Trung bình** | #003: additive churn `server.py`; sequence tương đối ổn |
| Proxy surface (path list) | **Trung bình** | Phải theo dõi release notes Comfy |
| Extension ESM cross-origin | **Cao nếu tách origin** | #003/#005 **UNKNOWN** — mitigation: **cùng brand origin**, path-split static vs API |
| Custom node JS widgets | **Trung bình–cao** | Offline: chỉ subset nodes có trong catalog tĩnh; full pack UX cần Runtime |

**Chiến lược giảm chi phí:** Một origin `work.*` (hoặc `studio.*`): CP serve `/` + `/assets/*`; proxy còn lại → Runtime. Tránh CORS/ESM cross-origin.

### Q6 — Giá trị mang lại

| Giá trị | Có sau A1+C+D? | Có chỉ với B0? |
|---------|----------------|----------------|
| Không mất bài khi đổi GPU | Có | **Có** (reload UI) |
| Mở Project / soạn khi chưa thuê GPU | Có | Không |
| GPU chết ≠ UI chết | Có | Không |
| Đổi GPU không reload UI | Có (C) | Không |
| Chuẩn bị Runtime trước/sau | Có | Một phần |
| Session “cảm giác liên tục” | Có | Một phần |

**Đáng vì:** Product GPUVietnam bán **phiên làm việc liên tục trên marketplace GPU không ổn định**. B0 giải “mất bài”; A giải “mất ghế ngồi (UI)”. Đó là bước kiến trúc đúng đích, không phải nice-to-have.

**Chưa đáng làm ngay vì:** B0 chưa kịp chứng minh trên image/worker mới; Q4 chưa lab; effort A1 không nhỏ.

### Q7 — Effort (ước lượng)

| Phase | Effort | Nội dung |
|-------|--------|----------|
| **A0** (this report) | ~0.5–1 ngày | Done |
| **A0.5 lab** | **1–2 ngày** | FE tĩnh + stubs + object_info snapshot; PASS/FAIL Q4 |
| **A1 MVP** | **~2 tuần** | Host FE trên CP/brand origin; path proxy API/WS; Generate gated; settings stub; catalog offline tối thiểu (Official Image) |
| **B'** | **~3–5 ngày** | Sync graph từ FE-on-CP (bỏ phụ thuộc extension trên GPU) |
| **C** | **~1 tuần** | Rebind Runtime không full reload (WS reconnect + object_info refresh) |
| **D validation** | **~2–3 ngày** | Checklist end-to-end “soạn hàng giờ không GPU” |
| **Production harden** | **~3–5 tuần** cộng dồn | Extension parity, version matrix, userdata SoT, ops runbook |

*Ước lượng calendar cho 1 engineer quen repo; chưa gồm redesign UX ngoài stock Comfy.*

---

## 6. Constraints (YES with constraints — chi tiết)

1. **FE ↔ Runtime version lock** bắt buộc (cùng pin với Official Image).  
2. **Cùng brand origin** cho FE + proxy API/WS (tránh UNKNOWN cross-origin ESM).  
3. **Offline editor** dùng **object_info catalog** theo Runtime Image Spec — không claim đủ mọi custom node khi chưa có Runtime.  
4. **Generate / upload / preview** chỉ khi Runtime healthy.  
5. **Không** thay `validate_prompt` / executor bằng Middleware.  
6. B0 `gpuvietnam_cp_sync` trên GPU là cầu tạm; A1 xong thì **B'** chuyển sync vào FE-on-CP.  
7. Ticket D là DoD kiến trúc — không ship “FE tách” cho KH nếu Q4 lab FAIL.

---

## 7. Ước lượng triển khai (tóm tắt)

```text
Spike A0:     done
Lab A0.5:     1–2 ngày     ← gate
MVP A1:       ~2 tuần
B' + C + D:   ~2–3 tuần thêm
Production:   ~5 tuần tổng (MVP→prod) nếu không scope creep
```

---

## 8. Khuyến nghị

### Quyết định cổng

| Option | Chọn? |
|--------|--------|
| Làm A1 ngay | **Không** |
| **Hoãn A1** | **Có** — đúng lúc |
| Không bao giờ tách FE | **Không** — trái đích kiến trúc |

### Việc làm ngay (không phải A1)

1. **Hoàn thiện B0** — migration 0046, redeploy Worker có `/gpuvietnam/cp/sync`, image có `gpuvietnam_cp_sync`, test đổi máy vẫn còn graph.  
2. **A0.5 lab (1–2 ngày)** — chứng minh Q4 với stub + catalog; ghi PASS/FAIL vào appendix báo cáo này.  
3. Nếu A0.5 **PASS** và constraints §6 chấp nhận được → mở **Ticket A1**.  
4. Nếu A0.5 **FAIL** (stock FE không chịu stub) → đánh giá fork FE nhẹ hoặc editor subset; có thể đổi verdict thành hoãn dài / NO for stock Comfy.

### Không làm trong A0/A1

- Dual-run / warm pool  
- Thay Comfy bằng editor tự viết từ zero (trừ khi A0.5 FAIL cứng)  
- Claim CUDA resume  

---

## Appendix A — Evidence pointers

| Ticket | Path |
|--------|------|
| #001 HTTP boot | `D:/GPU + AI/Web/ComfyUI/har_capture/ENDPOINT_EVIDENCE_REPORT.md` |
| #002 WebSocket | `D:/GPU + AI/Web/ComfyUI/ws_capture/WEBSOCKET_CONTRACT_REPORT.md` |
| #003 Assets / extensions / object_info | `D:/GPU + AI/Web/ComfyUI/asset_capture/ASSET_EXTENSION_LOADING_REPORT.md` |
| #004 Filesystem | `D:/GPU + AI/Web/ComfyUI/storage_capture/RUNTIME_STORAGE_REPORT.md` |
| #005 Boundary | `D:/GPU + AI/Web/ComfyUI/boundary_capture/RUNTIME_BOUNDARY_REPORT.md` |
| #006 Ephemeral | `D:/GPU + AI/Web/ComfyUI/ephemeral_capture/EPHEMERAL_RUNTIME_REPORT.md` |
| Proxy today | [`docs/COMFY_PROXY.md`](../COMFY_PROXY.md), `workers/comfy-proxy/src/index.js` |
| Graph SoT B0 | [`B2_SESSION_CONTINUITY.md`](./B2_SESSION_CONTINUITY.md) |
| Freeze | [`ARCHITECTURE_V2_FREEZE.md`](./ARCHITECTURE_V2_FREEZE.md) |

## Appendix B — A0.5 lab checklist (khi chạy)

- [ ] Serve `comfyui-frontend-package` từ host không Python  
- [ ] Stub `GET /api/settings` (200 tối thiểu)  
- [ ] Serve snapshot `object_info` (Official Image)  
- [ ] Core extensions load; custom pack offline = subset hoặc skip  
- [ ] Thêm node, nối dây, serialize graph  
- [ ] PATCH `/api/cp/comfy-sync` lưu được  
- [ ] Không có Runtime: Queue/Generate disabled hoặc lỗi mềm, UI không trắng  
- [ ] Gắn Runtime: proxy `/prompt` + `/ws` → Generate chạy  

**PASS A0.5** ⇒ mở A1. **FAIL** ⇒ cập nhật §1 Verdict trước khi đầu tư 2 tuần.
