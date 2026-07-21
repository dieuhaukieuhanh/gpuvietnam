# Smart Restore — Level 1 (MVP)

**Status:** Spec + implementation (v1)  
**Depends on:** Auto Backup (R2) · Official Image v1.0 (`docs/COMFYUI_IMAGE.md`)

## Nguyên tắc

- GPU ephemeral · Workspace (R2) persistent.
- Level 1 restore: **workflows · settings · outputs** only.
- **Không** restore custom nodes / core / stock models (Image bake-in covers nodes).

## Luồng

```
ComfyUI ready
    → classify workspace (R2 size of workflows+settings+outputs)
    → empty / no backup     → sẵn sàng (stock)
    → small (≤ threshold)   → auto restore → sẵn sàng
    → large                 → choice: continue | fresh
```

Threshold mặc định: **200 MB** (`WORKSPACE_RESTORE_SMALL_BYTES`).

## API

| Endpoint | Mục đích |
|----------|----------|
| `GET /api/session/workspace-restore` | Trạng thái classify + restore |
| `POST /api/session/workspace-restore` | `{ action: "continue" \| "fresh" }` |

## Restore nguồn

1. Ưu tiên `backup_logs` mới nhất có `archives[].r2Key` (stop backup) cho workflows/outputs/settings.
2. Fallback: file lẻ trên R2 `users/{id}/(workflows|outputs|settings)/` (giới hạn số file).

## UX

- Auto: tick `workspace_restoring` → `workspace_ready` (máy đã RUNNING / tính giờ).
- Choice: tick `workspace_choice` — UI hỏi kèm size/breakdown; **fresh** không xóa R2.
- Fail: vào Comfy bình thường + `workspace_failed` + nút thử lại / bỏ qua.
- Dashboard hydrate: poll `provision-progress` khi `running` nếu tick ∈ `{workspace_choice, workspace_restoring, workspace_failed}` (refresh không mất prompt).

## Lộ trình

| Level | Nội dung |
|-------|----------|
| **1 (now)** | workflows + settings + outputs · smart auto/choice |
| **2** | custom nodes (manifest + fail-soft) — Image v2.0 |
| **3** | user models / LoRA selective restore |
