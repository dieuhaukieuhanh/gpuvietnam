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
| **2.4** | History = Job/Attempt CP | `CpJobHistoryCard` trên `/dashboard/lich-su` (+ Jobs card B1.8) |

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
- [x] **CP usable while GPU boots** — `CpWorkspaceDuringBootCard` trên dashboard lúc `opening` (soạn/lưu workflow + snapshot; Comfy vẫn gated bởi `canOpenComfy`)

Apply migration khi sẵn sàng: `node scripts/run-migrations.mjs` (0046).

---

## Out of scope

- Full Comfy editor sync UI (clients call `/api/cp/workflows` PATCH)  
- Dual-run (B3)  
- Warm pool (B4)
