# A0.5 — Editor Without Runtime Lab Report

| | |
|---|---|
| **Status** | Lab complete |
| **Date** | 2026-07-22 |
| **Question** | Có thể giữ giao diện ComfyUI sống độc lập với GPU Runtime không? |
| **Verdict** | **PASS WITH CONSTRAINTS** |
| **Scope** | Lab kỹ thuật only — **không** A1 production, **không** gắn dashboard |

---

## 1. Verdict

| Field | Value |
|-------|--------|
| **Verdict** | **PASS WITH CONSTRAINTS** |
| **Meaning** | Stock Comfy FE (`comfyui-frontend-package==1.45.21`) load + soạn/sửa graph + lưu/nạp CP **khi không có GPU Runtime**. Generate bị chặn rõ ràng. |
| **Không phải PASS sạch** | Offline catalog = subset built-in (không full Official Pack custom nodes / custom JS). |
| **Không phải FAIL** | Không có blocker kiến trúc cứng khiến editor offline bất khả thi. |
| **Gate A1** | Có thể mở Ticket A1 nếu chấp nhận constraints §5. |

---

## 2. Lab setup (đã chạy)

| Thành phần | Chi tiết |
|------------|----------|
| FE tĩnh | `ComfyUI/.venv/.../comfyui_frontend_package/static` (pin **1.45.21**, khớp Comfy `0.28.0`) |
| Lab server | `labs/a0.5-editor-without-runtime/server.mjs` → `http://127.0.0.1:5190/` |
| Origin | Cùng origin: static + `/api/*` stubs + `/ws` shim + `/lab/cp/*` proxy → Next CP |
| `object_info` | Snapshot từ Comfy local CPU; curated offline **120** built-in nodes → `fixtures/object_info.offline.json` |
| Extensions offline | `GET /api/extensions` → `[]` (core bundled trong FE package) |
| GPU Runtime | **Không** chạy trong lab path (chỉ dùng CPU Comfy một lần để capture fixture) |
| CP | Next `http://127.0.0.1:3000` — `PATCH/GET /api/cp/comfy-sync` → `cp_workflows` |

### Cách chạy lại

```bash
# optional refresh fixtures (cần Comfy local)
node labs/a0.5-editor-without-runtime/capture-object-info.mjs

node labs/a0.5-editor-without-runtime/server.mjs
# mở http://127.0.0.1:5190/

node labs/a0.5-editor-without-runtime/run-scenarios.mjs
```

---

## 3. Scenario results

### Bắt buộc

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Mở URL editor độc lập, không Runtime | **PASS** | Lab `5190`; health `runtimeOnline: false` |
| 2 | Editor load được | **PASS** | Browser title ComfyUI; splash gone; `window.app.graph` |
| 3 | Tạo/chỉnh sửa graph | **PASS** | CDP: add `EmptyLatentImage`, `KSampler`, `CLIPTextEncode` |
| 4 | Thêm / nối / xóa / đổi thông số | **PASS** | Link LATENT; width→768; xóa `SaveImage`; prompt text `a05 offline edit ok` |
| 5 | Lưu graph JSON → CP / `cp_workflows` | **PASS** | Harness S6 rev **61**; browser-path save rev **62** |
| 6 | Đóng/reload browser → graph còn (via CP) | **PASS** | Full reload → `loadCp` → marker `a05-browser-reload-*`, width 768, text giữ nguyên |
| 7 | Runtime offline → Generate disable / báo rõ | **PASS** | Banner *Runtime offline — Generate bị chặn*; `POST /api/prompt` → **503** `A05_RUNTIME_OFFLINE` |

### Optional

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 8 | Runtime cấp sau → Generate graph đã soạn | **NOT RUN** | Ngoài lab bắt buộc; A1/C sẽ cover proxy rebind + `/prompt` |

Harness JSON: `labs/a0.5-editor-without-runtime/results/a05-scenarios-*.json` (local).

---

## 4. Endpoints — offline behavior

### 4.1 Bắt buộc để render editor

| Path | Offline lab | Ghi chú |
|------|-------------|---------|
| `GET /` + `/assets/*` + FE static | Serve từ `comfyui-frontend-package` | Hard requirement |
| `GET /api/settings` | Stub `{}` + tutorial/version keys | **Hard-fail** nếu thiếu (#001) |
| `POST /api/settings/{id}` | 200 stub | Boot writes InstalledVersion / Tutorial |
| `GET /api/users` | Stub sample | Boot |
| `GET /api/system_stats` | Stub + `a05.runtimeOnline: false` | Banner/status |
| `GET /api/i18n` | `{}` | Soft |
| `GET /api/extensions` | `[]` | Tránh 404 custom pack JS; core bundled |
| `GET /api/object_info` | Snapshot curated | Node defs + COMBO lists |
| `GET /api/userdata*` | 404 → FE coi như `[]` | Soft (#001) |
| `GET /api/experiment/models` | `[]` | Soft |

### 4.2 Runtime-dependent

| Path | Offline lab | Khi có Runtime (A1) |
|------|-------------|---------------------|
| `WS /ws` | Minimal shim (status only) | Proxy → Runtime |
| `POST /prompt` | **503** rõ ràng | Proxy → Runtime |
| `GET /queue` | Empty queues | Proxy |
| `GET /history*` | `{}` | Proxy |
| `/interrupt`, `/free` | 503 | Proxy |
| Custom `/extensions/<pack>/**` | Không list | Serve/proxy từ Runtime hoặc offline subset |

### 4.3 Control Plane (lab bridge)

| Path | Role |
|------|------|
| `PATCH/GET /lab/cp/api/cp/comfy-sync` | Same-origin proxy → Next CP SoT |
| Lab banner Save/Load | Chứng minh lưu/nạp — **không** phải UX production |

---

## 5. Constraints (lý do WITH CONSTRAINTS)

1. **Offline catalog ≠ full Official Pack** — lab dùng ~120 built-in nodes; custom nodes (Impact, KJ, IPAdapter, …) và custom JS widgets **không** có khi Runtime absent.  
2. **`/api/extensions = []`** — chấp nhận được cho soạn graph core; Manager / pack UI offline không có.  
3. **Generate / upload / preview / model download** vẫn cần Runtime.  
4. **Version lock** FE package ↔ Runtime image (đã pin 1.45.21 / Comfy 0.28.0 / image `:v3.2` family).  
5. **Cùng origin** (hoặc path-split cẩn thận) để tránh CORS/ESM — lab đã làm same-origin.  
6. Lab URL độc lập — **không** gắn nút dashboard (đúng scope).  
7. Scenario 8 (attach Runtime sau) **chưa** chứng minh trong lab này.

**Offline catalog Official Pack?**  
- **Có thể giới hạn** ở built-in + (tuỳ chọn) snapshot `object_info` lấy từ image Official khi cold-start một lần.  
- **Không** claim “đủ mọi custom node UI” offline mà không có catalog + JS tương ứng.

---

## 6. Blockers còn lại (cho A1 — không chặn A0.5)

| Item | Severity | Notes |
|------|----------|-------|
| Catalog/object_info pipeline từ Official Image CI | Medium | Cần artifact build-time, không capture tay |
| Custom node web extensions offline subset | Medium | Quyết định product: core-only vs pack snapshot |
| WS reconnect / rebind không full reload (Ticket C) | Medium | Sau A1 MVP |
| Generate gate UX production (disable Queue button) | Low | Lab dùng 503 + banner; A1 cần UI sạch hơn |
| B' sync từ FE-on-CP (bỏ phụ thuộc extension trên GPU) | Medium | Sau A1 host FE |

**Không thấy blocker** kiểu “stock FE bắt buộc Python Runtime cùng process mới boot được”.

---

## 7. Đã chứng minh được

1. Serve stock Comfy FE tĩnh **không** Python Runtime.  
2. Stub boot APIs đủ để GraphCanvas setup hoàn tất.  
3. Soạn graph (add/connect/delete/edit widgets) offline.  
4. Lưu/nạp document LiteGraph vào **Control Plane** (`cp_workflows` via comfy-sync).  
5. Full browser reload → khôi phục graph từ CP.  
6. Generate bị từ chối rõ khi Runtime offline.  
7. Gate 1 Continuity (G1–G6) đã PASS trước lab — SoT/continuity không còn là câu hỏi của A0.5.

---

## 8. Effort ước tính cho A1 (nếu mở)

Giữ nguyên ước lượng A0 report (1 engineer quen repo):

| Phase | Effort |
|-------|--------|
| **A1 MVP** — host FE trên brand origin; path proxy API/WS; Generate gated; settings stub; catalog offline tối thiểu | **~2 tuần** |
| **B'** — sync graph từ FE-on-CP | ~3–5 ngày |
| **C** — rebind Runtime không full reload | ~1 tuần |
| **D** validation “soạn hàng giờ không GPU” | ~2–3 ngày |

A0.5 **không** thay A1 — chỉ mở cổng quyết định.

---

## 9. Kết luận

> **Có thể** giữ ComfyUI Editor sống độc lập với GPU Runtime, với catalog offline giới hạn và Generate bị chặn cho đến khi có Runtime.

| Verdict | |
|---------|---|
| **PASS WITH CONSTRAINTS** | Mở được thảo luận / Ticket **A1** nếu product chấp nhận constraints §5. |
| Next | Không tự làm A1 trong lab này. Quyết định product: mở A1 hay củng cố catalog/CI trước. |

### Pointers

| Artifact | Path |
|----------|------|
| Lab server | `labs/a0.5-editor-without-runtime/server.mjs` |
| Capture | `labs/a0.5-editor-without-runtime/capture-object-info.mjs` |
| Harness | `labs/a0.5-editor-without-runtime/run-scenarios.mjs` |
| Offline catalog | `labs/a0.5-editor-without-runtime/fixtures/object_info.offline.json` |
| A0 spike | [`A0_FRONTEND_SEPARATION_REPORT.md`](./A0_FRONTEND_SEPARATION_REPORT.md) |
| Gate 1 | [`GATE1_TEST_REPORT.md`](./GATE1_TEST_REPORT.md) |
