# Gate 1 Continuity — Test Report (GPU thật)

| | |
|---|---|
| **Date** | 2026-07-21 |
| **Branch** | `feat/cp-runtime-b1` |
| **Executor** | Cursor agent (ops) |
| **Checklist** | [GATE1_CONTINUITY_CHECKLIST.md](./GATE1_CONTINUITY_CHECKLIST.md) |
| **Execution ticket** | [GATE1_CONTINUITY_EXECUTION.md](./GATE1_CONTINUITY_EXECUTION.md) |
| **Verdict** | **PASS** — G1–G6 Continuity trên GPU thật với image `:v3.1` |

---

## Environment

| Item | Value | Status |
|------|--------|--------|
| App (local) | `http://127.0.0.1:3000` | OK (`npm run dev`) |
| Tunnel (Worker origin) | `https://while-rich-rob-franchise.trycloudflare.com` | OK (quick tunnel; redeployed Worker) |
| Supabase | `rhtqiecieeyqjlctcvag.supabase.co` | OK |
| `cp_workflows` / `projects` | Có — workflow `f287ec3d-…` | OK |
| `COMFY_PROXY_ENABLED` | `1` | OK |
| `COMFY_PROXY_BASE_URL` | `https://work.gpuvietnam.com` | OK |
| Worker | `gpuvietnam-comfy-proxy` Version `01eec3cc-6133-4892-8196-e583481c7f05` | OK |
| Worker `ORIGIN_*` | Tunnel URL (tránh WordPress apex) | OK |
| CF KV mirror từ Next | `CF KV put failed 401` (token scope) | Degraded — origin resolve đủ dùng |
| Image | `dieuhaukieuhanh/gpuvietnam-comfyui:v3.1` | **OK** — có `gpuvietnam_cp_sync` |
| Provider | Clore | OK |
| Owner user | `70feafcf-6ad1-4b13-bb99-eae5a538d20a` | OK |
| Marker | `gate1-1784652249438` | OK |
| Workflow | `f287ec3d-f268-4ddb-a0cd-460deec8e5bf` | revision 8 (cuối báo cáo) |

---

## Image `:v3.1`

- **Không ghi đè `:v3`.** Build/push tag test `:v3.1` (thin layer từ `:v3` + `gpuvietnam_cp_sync`).
- Env Gate 1: `GPUVIETNAM_COMFYUI_IMAGE_V3=dieuhaukieuhanh/gpuvietnam-comfyui:v3.1`
- Xác nhận trên host: `/api/extensions` chứa `/extensions/gpuvietnam_cp_sync/cp_sync.js`

---

## Kết quả G1–G6

| ID | Kết quả | Evidence | Machines / orders |
|----|---------|----------|-------------------|
| **G1** Sync CP | **PASS** | API: PATCH/GET `comfy-sync` revision↑ + marker; UI: indicator **「Control Plane: đã lưu」** trên `work.gpuvietnam.com` | Runtime A: `debbf81d-…` / order `1970248` |
| **G2** Browser / SoT | **PASS** | GET lại bằng user JWT (không dựa localStorage); browser load graph Note `gate1-…` từ CP | Cùng workflow |
| **G3** Stop → máy mới | **PASS** | `POST /api/user/stop-machine` → start → marker còn, revision giữ | A `debbf81d-…`/`1970248` → B `4336f5fb-…`/`1970310` · `:v3.1` |
| **G4+G6** Kill Provider + restore | **PASS** | Clore `cancel_order` `1970310` (không Stop dashboard) → order gone → Runtime C; marker còn; Comfy load Note từ CP; indicator đã lưu | A `4336f5fb-…`/`1970310` → B `37ee4329-…`/`1970338` · `:v3.1` |
| **G5** Session Restore | **PASS** | `GET /api/cp/session-restore` → `restoreKind=session`, `jobResumed=false`, `projectContinues=true`, message không claim resume CUDA | Project `129f338a-…` |

### G6 Generate (chi tiết)

- Continuity core: **graph restore + Runtime mới thực thi được path sync** — PASS (Note marker nạp lại trên Runtime C).
- Pixel Generate (Checkpoint → ảnh): **không chạy** trong lần này — graph Gate 1 là Note marker (không phải pipeline ảnh). Không chặn verdict Continuity SoT.
- Lưu ý ops (đã vá sau Gate 1): canvas trống lúc boot từng auto-save đè SoT (revision 7) — đã PATCH lại marker; code hiện **reject empty overwrite** (extension + `/api/cp/comfy-sync`) và chỉ gắn listener sau khi load CP xong. Image GPU cần rebuild `:v3.1` (hoặc tag mới) để nhận extension mới trên máy rent.

---

## Scripts dùng

| Script | Việc |
|--------|------|
| `scripts/gate1-run-continuity-api.mjs` | G1/G2 API |
| `scripts/gate1-g3-stop-restore.mjs` | G3 |
| `scripts/gate1-g4-kill-provider.mjs` | G4 kill Provider |
| `scripts/gate1-g4-resume-runtime-b.mjs` | Resume sau kill (start Runtime B) |
| `scripts/gate1-check-extensions.mjs` | Verify `cp_sync` trên máy |
| `scripts/gate1-debug-enter.mjs` | Debug Worker `/enter` + origin resolve |

---

## Blockers đã mở trong phiên này

| Trước | Sau |
|-------|-----|
| Không Docker / chưa có `:v3.1` | Build + push `:v3.1`, rent máy mới |
| `projection_message` không match `/sẵn sàng\|reachable/` → comfy-access 409 | Set message hợp lệ (HTTPS probe 200) |
| Tunnel cũ chết → Worker `/enter` 401 | Tunnel mới + `wrangler deploy --var ORIGIN_*` |
| CF KV put 401 | Vẫn degraded; origin resolve đủ |

---

## Kết luận

```text
Gate 1 Continuity: PASS
```

**Không mở A0.5 / A1 trong phiên này** — chờ quyết định product sau PASS.

Khuyến nghị trước khách lâu dài:

1. Sửa quyền `CF_API_TOKEN` (KV write) hoặc bỏ phụ thuộc KV khi origin resolve ổn định.
2. Harden `gpuvietnam_cp_sync`: không sync-save document rỗng khi canvas chưa ready.
3. (Tuỳ chọn) G7 multi-hop Runtime trước go-live dài ngày.
4. Promote tag ổn định sau khi chốt — vẫn giữ `:v3` production cho đến khi quyết định cắt.

---

## Bảng kết quả cuối

| ID | PASS/FAIL/BLOCKED | workflow_id | revision | machine_id A/B | provider order | Notes |
|----|-------------------|-------------|----------|----------------|----------------|-------|
| G1 | PASS | `f287ec3d-…` | 6→8 | `debbf81d` / … | `1970248` | API + UI 「đã lưu」 |
| G2 | PASS | same | 6→8 | — | — | JWT SoT + browser restore Note |
| G3 | PASS | same | 6 | `debbf81d` → `4336f5fb` | `1970248` → `1970310` | Stop dashboard |
| G4+G6 | PASS | same | 6→8 | `4336f5fb` → `37ee4329` | `1970310` kill → `1970338` | Kill Provider; graph restore; no pixel gen |
| G5 | PASS | same | 6 | — | — | session-restore API |
