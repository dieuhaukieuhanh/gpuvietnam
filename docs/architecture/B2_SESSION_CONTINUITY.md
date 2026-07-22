# B2 — Session continuity (phiên web không mất)

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §2.x |
| **Migration** | `supabase/cp-runtime-v2-b2-session.sql` (**0046**) |
| **Branch** | `feat/cp-runtime-b1` |

---

## Goal

Đổi GPU mà **Project / Session / Workflow / Snapshot** vẫn còn trên Control Plane.  
**Session Restore ≠ Job Resume** (Job fail → Attempt mới / chạy lại).

---

## Steps delivered

| Step | Deliverable | Code / UI |
|------|-------------|-----------|
| **2.1** | Workflow SoT trên CP | `cp_workflows` + `workflow-sot.js` + `GET/POST/PATCH /api/cp/workflows` |
| **2.2** | Session Restore Demo | `session-restore.js` + `GET /api/cp/session-restore` + `SessionRestoreBanner` |
| **2.2.5** | Project Snapshot Save/Restore | `project_snapshots` + `project-snapshot.js` + `/api/cp/snapshots` |
| **2.3** | Proxy / Runtime URL rebind | `runtime-rebind.js` + `POST /api/cp/runtime-rebind` · see below |
| **2.5** | Comfy ↔ CP editor sync | `gpuvietnam_cp_sync` + `/api/cp/comfy-sync` + Worker `/gpuvietnam/cp/sync` | Soạn Comfy → document trên CP → đổi máy → graph hiện lại |

---

## Naming note (important)

Catalog **`public.workflows`** (templates, `is_public`) đã tồn tại.  
Architecture Workflow SoT dùng **`cp_workflows`** để tránh đụng schema.  
`jobs.cp_workflow_id` → `cp_workflows`.

---

## B2.3 Runtime rebind (spec)

```text
GPU A chết / đổi máy
  → Runtime B endpoint mới
  → revoke comfy_access_tokens (machineId)
  → issueComfyAccessToken(upstream = B)
  → client mở workUrl mới (work.*)
```

| Mode | Behavior |
|------|----------|
| Proxy ON | Brand `workUrl`; upstream không trả cho browser |
| Proxy OFF | `workUrl` = upstream trực tiếp (`mode: direct_upstream`) |

Invariant: CP không gọi Comfy API; chỉ mint/rebind proxy token.

---

## DoD checklist

- [x] Mất máy A không mất document trên `cp_workflows`  
- [x] Banner Session Restore (không claim CUDA resume)  
- [x] Save snapshot → restore document  
- [x] Rebind plan + API  
- [x] Lịch sử Job CP trên trang Lịch sử  
- [x] **Comfy ↔ CP sync** — extension auto-save + inject on open; Worker `/gpuvietnam/cp/sync`
- [x] F5 / browser kill → graph từ CP (Gate 1 G2)  
- [x] Đổi GPU (stop + kill Provider) → graph còn (Gate 1 G3–G4)  
- [x] PATCH conflict 2 tab → `REVISION_CONFLICT` (unit + optimistic concurrency)  
- [x] Empty canvas không đè SoT (extension + API guard)  
- [x] Regression: proxy enter + branding path; stop/destroy ≠ backup R2 SoT  

Apply migration khi sẵn sàng: `node scripts/run-migrations.mjs` (0046).

### Gate 1 Continuity (GPU thật) — trước A0.5

Checklist 6 bài (G1 sync → G2 tắt browser → G3 stop → G4 kill Provider → G5 banner → G6 generate):  
[GATE1_CONTINUITY_CHECKLIST.md](./GATE1_CONTINUITY_CHECKLIST.md).

---

## Out of scope

- Dual-run (B3)
- Warm pool (B4)
- CUDA / Job mid-run resume (Session Restore ≠ Job Resume)

## Comfy ↔ CP editor sync (shipped)

Extension `gpuvietnam_cp_sync` + `GET/PATCH /api/cp/comfy-sync` (+ Worker `/gpuvietnam/cp/sync`):

1. Open Comfy via `workUrl` → Worker sets cookie + `#gvn_cp=` bootstrap  
2. Extension loads `document` from CP and `app.loadGraphData` once  
3. Debounced auto-save of `app.graph.serialize()` → CP `cp_workflows.document`  
4. Đổi GPU → rebind mint lại token/bootstrap → máy mới inject lại graph  
5. **Empty-canvas guard:** extension + API skip PATCH that would overwrite a non-empty SoT with `nodes: []`  
6. Stop/tab close: best-effort flush via `fetch(..., { keepalive: true })` (SoT ≠ backup R2)

Auth: Bearer `gvc.*` (Comfy access token) hoặc Supabase session. CP vẫn không gọi Comfy HTTP trực tiếp.

Gate 1 Continuity (GPU thật): [GATE1_TEST_REPORT.md](./GATE1_TEST_REPORT.md) — **PASS**.
