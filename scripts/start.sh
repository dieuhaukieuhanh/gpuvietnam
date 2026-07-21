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

# Periodic backup (presigned R2 via app token — no R2 secrets in container).
# Disable with GPUVIETNAM_PERIODIC_BACKUP=0.
if [[ "${GPUVIETNAM_PERIODIC_BACKUP:-1}" == "1" ]] && [[ -x /app/periodic-backup.sh ]]; then
  echo "[GPUVietnam] Starting periodic backup service..."
  /app/periodic-backup.sh &
fi

cd "${COMFYUI_DIR}"
echo "[GPUVietnam] Starting ComfyUI on 0.0.0.0:${PORT}..."
exec python main.py --listen 0.0.0.0 --port "${PORT}" --enable-cors-header "*"
