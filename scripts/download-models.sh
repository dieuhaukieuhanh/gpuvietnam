#!/usr/bin/env bash
# Download stock ComfyUI models — prefer R2 public base (Solution A), fallback HF/GitHub.
# Env:
#   GPUVIETNAM_MODELS_BASE_URL  e.g. https://pub-xxx.r2.dev/stock/models
#   GPUVIETNAM_MODELS_FALLBACK=0  disable HF/GitHub fallback
#   CIVITAI_API_TOKEN  only used for legacy CivitAI fallback of RealVis
set -euo pipefail

COMFYUI_DIR="${COMFYUI_DIR:-/app/ComfyUI}"
CHECKPOINT_DIR="${COMFYUI_DIR}/models/checkpoints"
LORA_DIR="${COMFYUI_DIR}/models/loras"
UPSCALE_DIR="${COMFYUI_DIR}/models/upscale_models"
MODELS_BASE="${GPUVIETNAM_MODELS_BASE_URL:-}"
ALLOW_FALLBACK="${GPUVIETNAM_MODELS_FALLBACK:-1}"

mkdir -p "${CHECKPOINT_DIR}" "${LORA_DIR}" "${UPSCALE_DIR}"

SUCCESS=0
FAILED=0
SKIPPED=0

log_ok() {
  echo "[Models] OK: $1"
  SUCCESS=$((SUCCESS + 1))
}

log_fail() {
  echo "[Models] FAIL: $1" >&2
  FAILED=$((FAILED + 1))
}

log_skip() {
  echo "[Models] SKIP: $1"
  SKIPPED=$((SKIPPED + 1))
}

download_file() {
  local url="$1"
  local dest="$2"
  local auth_header="${3:-}"
  local name
  name="$(basename "${dest}")"

  if [[ -f "${dest}" ]]; then
    log_skip "${name} already present"
    return 0
  fi

  echo ""
  echo "[Models] Downloading ${name}..."
  echo "         ${url}"

  local curl_args=(-fL --progress-bar -o "${dest}.part")
  if [[ -n "${auth_header}" ]]; then
    curl_args+=(-H "${auth_header}")
  fi

  if curl "${curl_args[@]}" "${url}"; then
    mv "${dest}.part" "${dest}"
    log_ok "${dest}"
    return 0
  fi

  rm -f "${dest}.part"
  log_fail "${name}"
  return 1
}

# Try R2 first (relative under MODELS_BASE), then optional fallback URL.
download_stock() {
  local relative="$1"
  local dest="$2"
  local fallback_url="${3:-}"
  local fallback_auth="${4:-}"

  if [[ -f "${dest}" ]]; then
    log_skip "$(basename "${dest}") already present"
    return 0
  fi

  if [[ -n "${MODELS_BASE}" ]]; then
    local r2_url="${MODELS_BASE%/}/${relative}"
    if download_file "${r2_url}" "${dest}"; then
      return 0
    fi
    echo "[Models] R2 miss for ${relative} — trying fallback (if enabled)"
  fi

  if [[ "${ALLOW_FALLBACK}" != "1" ]]; then
    return 1
  fi
  if [[ -z "${fallback_url}" ]]; then
    return 1
  fi
  download_file "${fallback_url}" "${dest}" "${fallback_auth}"
}

echo "=========================================="
echo " GPUVietnam — Download ComfyUI Models (A: R2)"
echo "=========================================="
echo "Checkpoints: ${CHECKPOINT_DIR}"
echo "LoRA:        ${LORA_DIR}"
echo "Upscale:     ${UPSCALE_DIR}"
if [[ -n "${MODELS_BASE}" ]]; then
  echo "R2 base:     ${MODELS_BASE}"
else
  echo "R2 base:     (not set — using HF/GitHub fallback only)"
  echo "             Set GPUVIETNAM_MODELS_BASE_URL for fast R2 downloads."
fi
echo ""

# --- Checkpoints ---
download_stock \
  "checkpoints/sd_xl_base_1.0.safetensors" \
  "${CHECKPOINT_DIR}/sd_xl_base_1.0.safetensors" \
  "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors" \
  || true

REALVIS_AUTH=""
if [[ -n "${CIVITAI_API_TOKEN:-}" ]]; then
  REALVIS_AUTH="Authorization: Bearer ${CIVITAI_API_TOKEN}"
fi
download_stock \
  "checkpoints/RealVisXL_V6.0_B1.safetensors" \
  "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" \
  "https://civitai.com/api/download/models/789646" \
  "${REALVIS_AUTH}" \
  || true

if [[ ! -f "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" ]] && [[ "${ALLOW_FALLBACK}" == "1" ]]; then
  download_file \
    "https://huggingface.co/SG161222/RealVisXL_V4.0/resolve/main/RealVisXL_V4.0.safetensors" \
    "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" \
    || true
fi

if [[ ! -f "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" ]] \
  && [[ -f "${CHECKPOINT_DIR}/sd_xl_base_1.0.safetensors" ]]; then
  ln -sf sd_xl_base_1.0.safetensors "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors"
  log_ok "RealVisXL fallback symlink -> sd_xl_base_1.0"
fi

echo ""
echo "[Models] LoRA: none configured yet (${LORA_DIR})"

# --- Upscaler ---
download_stock \
  "upscale_models/RealESRGAN_x4plus.pth" \
  "${UPSCALE_DIR}/RealESRGAN_x4plus.pth" \
  "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" \
  || true

echo ""
echo "=========================================="
echo " Result: OK=${SUCCESS} FAIL=${FAILED} SKIP=${SKIPPED}"
echo "=========================================="

missing=0
for required in \
  "${CHECKPOINT_DIR}/sd_xl_base_1.0.safetensors" \
  "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" \
  "${UPSCALE_DIR}/RealESRGAN_x4plus.pth"; do
  if [[ ! -e "${required}" ]]; then
    echo "[Models] MISSING required: ${required}" >&2
    missing=$((missing + 1))
  fi
done

if [[ "${missing}" -gt 0 ]]; then
  exit 1
fi

exit 0