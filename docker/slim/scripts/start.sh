#!/usr/bin/env bash
set -euo pipefail
PORT="${COMFYUI_PORT:-8080}"
COMFYUI_DIR="/app/ComfyUI"

if [[ -x /app/setup-workstation.sh ]]; then
  /app/setup-workstation.sh
fi

if [[ "${GPUVIETNAM_SKIP_MODEL_DOWNLOAD:-0}" != "1" ]] && [[ -x /app/download-models.sh ]]; then
  echo "[GPUVietnam] Ensuring required ComfyUI models (first boot may take several minutes)..."
  /app/download-models.sh || echo "[GPUVietnam] Warning: some models could not be downloaded"
fi

# Pre-start custom_nodes restore — pull persisted custom nodes from R2
# before ComfyUI starts so they are available on first boot.
if [[ "${GPUVIETNAM_SKIP_PRE_RESTORE:-0}" != "1" ]] && [[ -x /app/restore-environment.sh ]]; then
  echo "[GPUVietnam] Pre-start restore: checking for persisted custom_nodes..."
  /app/restore-environment.sh || echo "[GPUVietnam] Warning: pre-start restore completed with warnings"
fi

# Periodic backup (presigned R2 via app token — no R2 secrets in container).
# Disable with GPUVIETNAM_PERIODIC_BACKUP=0.
if [[ "${GPUVIETNAM_PERIODIC_BACKUP:-1}" == "1" ]] && [[ -x /app/periodic-backup.sh ]]; then
  echo "[GPUVietnam] Starting periodic backup service..."
  /app/periodic-backup.sh &
fi

cd "${COMFYUI_DIR}"
echo "[GPUVietnam] Starting ComfyUI on 0.0.0.0:${PORT}..."

# Notify runtime that ComfyUI is about to start
if command -v curl >/dev/null 2>&1; then
  curl -sS --max-time 10 \
    -X POST \
    -H "Authorization: Bearer ${GPUVIETNAM_BACKUP_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"stage":"comfy_started","idempotency_key":"comfy_started"}' \
    "${GPUVIETNAM_PUBLIC_API_URL}/api/runtime/boot-event" \
    >/dev/null 2>&1 || true
fi

# Filmmaker auto-resume: check R2 for in-progress render job and resume.
# Runs in background — waits for ComfyUI, then checks for interrupted jobs.
if [[ "${GPUVIETNAM_FILMMAKER_AUTO_RESUME:-1}" != "0" ]] && [[ -x /app/filmmaker-resume.py ]]; then
  (
    # Wait for ComfyUI to be ready
    sleep 10
    # Check R2 for in-progress filmmaker jobs via restore API
    if [[ -n "${GPUVIETNAM_BACKUP_TOKEN:-}" ]] && [[ -n "${GPUVIETNAM_PUBLIC_API_URL:-}" ]]; then
      echo "[GPUVietnam] Filmmaker: checking for interrupted render jobs..." >&2
      /app/filmmaker-resume.py --auto-detect 2>&1 | while IFS= read -r line; do
        echo "[GPUVietnam] [Filmmaker] ${line}" >&2
      done &
    fi
  ) &
fi

exec python main.py --listen 0.0.0.0 --port "${PORT}" --enable-cors-header "*"
