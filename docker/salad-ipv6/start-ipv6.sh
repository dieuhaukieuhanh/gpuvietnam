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

# Pre-start custom_nodes restore
if [[ "${GPUVIETNAM_SKIP_PRE_RESTORE:-0}" != "1" ]] && [[ -x /app/restore-environment.sh ]]; then
  echo "[GPUVietnam] Pre-start restore: checking for persisted custom_nodes..."
  /app/restore-environment.sh || echo "[GPUVietnam] Warning: pre-start restore completed with warnings"
fi

# Periodic backup
if [[ "${GPUVIETNAM_PERIODIC_BACKUP:-1}" == "1" ]] && [[ -x /app/periodic-backup.sh ]]; then
  echo "[GPUVietnam] Starting periodic backup service..."
  /app/periodic-backup.sh &
fi

cd "${COMFYUI_DIR}"

# IPv6 dual-stack support for SaladCloud.
# Default :: is dual-stack on Linux (accepts both IPv4 and IPv6).
# Vast overrides via COMFYUI_LISTEN=0.0.0.0 env var.
LISTEN_ADDR="${COMFYUI_LISTEN:-::}"
echo "[GPUVietnam] Starting ComfyUI on ${LISTEN_ADDR}:${PORT}..."

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

# Filmmaker auto-resume
if [[ "${GPUVIETNAM_FILMMAKER_AUTO_RESUME:-1}" != "0" ]] && [[ -x /app/filmmaker-resume.py ]]; then
  (
    sleep 10
    if [[ -n "${GPUVIETNAM_BACKUP_TOKEN:-}" ]] && [[ -n "${GPUVIETNAM_PUBLIC_API_URL:-}" ]]; then
      echo "[GPUVietnam] Filmmaker: checking for interrupted render jobs..." >&2
      /app/filmmaker-resume.py --auto-detect 2>&1 | while IFS= read -r line; do
        echo "[GPUVietnam] [Filmmaker] ${line}" >&2
      done &
    fi
  ) &
fi

exec python main.py --listen "${LISTEN_ADDR}" --port "${PORT}" --enable-cors-header "*"
