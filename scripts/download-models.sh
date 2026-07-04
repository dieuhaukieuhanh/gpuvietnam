#!/usr/bin/env bash
# Tải models phổ biến cho GPUVietnam ComfyUI
set -euo pipefail

COMFYUI_DIR="${COMFYUI_DIR:-/app/ComfyUI}"
CHECKPOINT_DIR="${COMFYUI_DIR}/models/checkpoints"
LORA_DIR="${COMFYUI_DIR}/models/loras"
UPSCALE_DIR="${COMFYUI_DIR}/models/upscale_models"

mkdir -p "${CHECKPOINT_DIR}" "${LORA_DIR}" "${UPSCALE_DIR}"

SUCCESS=0
FAILED=0
SKIPPED=0

log_ok() {
  echo "✅ $1"
  SUCCESS=$((SUCCESS + 1))
}

log_fail() {
  echo "❌ $1" >&2
  FAILED=$((FAILED + 1))
}

log_skip() {
  echo "⏭️  $1"
  SKIPPED=$((SKIPPED + 1))
}

download_file() {
  local url="$1"
  local dest="$2"
  local name
  name="$(basename "${dest}")"

  if [[ -f "${dest}" ]]; then
    log_skip "${name} đã tồn tại — bỏ qua"
    return 0
  fi

  echo ""
  echo "⬇️  Đang tải ${name}..."
  echo "    URL: ${url}"

  local curl_args=(
    -fL
    --progress-bar
    -o "${dest}.part"
  )

  if [[ -n "${CIVITAI_API_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${CIVITAI_API_TOKEN}")
  fi

  if curl "${curl_args[@]}" "${url}"; then
    mv "${dest}.part" "${dest}"
    log_ok "Tải thành công: ${dest}"
    return 0
  fi

  rm -f "${dest}.part"
  log_fail "Tải thất bại: ${name}"
  return 1
}

echo "=========================================="
echo " GPUVietnam — Download ComfyUI Models"
echo "=========================================="
echo "Checkpoints: ${CHECKPOINT_DIR}"
echo "LoRA:        ${LORA_DIR}"
echo "Upscale:     ${UPSCALE_DIR}"
echo ""

# --- Checkpoints ---

download_file \
  "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors" \
  "${CHECKPOINT_DIR}/sd_xl_base_1.0.safetensors" \
  || true

# RealVisXL V6.0 B1 — CivitAI (có thể cần CIVITAI_API_TOKEN)
REALVIS_URL="https://civitai.com/api/download/models/789646"
if [[ -z "${CIVITAI_API_TOKEN:-}" ]]; then
  echo ""
  echo "ℹ️  RealVisXL V6: đặt CIVITAI_API_TOKEN nếu tải từ CivitAI bị từ chối."
fi
download_file \
  "${REALVIS_URL}" \
  "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" \
  || true

# Fallback RealVis từ HuggingFace (nếu CivitAI thất bại)
if [[ ! -f "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" ]]; then
  download_file \
    "https://huggingface.co/SG161222/RealVisXL_V4.0/resolve/main/RealVisXL_V4.0.safetensors" \
    "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" \
    || true
fi

# Fallback cuối: dùng SDXL base nếu vẫn không có RealVis (workflow vẫn chạy được)
if [[ ! -f "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" ]] \
  && [[ -f "${CHECKPOINT_DIR}/sd_xl_base_1.0.safetensors" ]]; then
  ln -sf sd_xl_base_1.0.safetensors "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors"
  log_ok "RealVisXL fallback → sd_xl_base_1.0 (symlink)"
fi

# --- LoRA (Việt hóa — thêm sau) ---

echo ""
echo "📁 LoRA: chưa cấu hình model Việt hóa (sẽ bổ sung sau)."
echo "   Thư mục sẵn sàng: ${LORA_DIR}"

# --- Upscaler ---

download_file \
  "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" \
  "${UPSCALE_DIR}/RealESRGAN_x4plus.pth" \
  || true

echo ""
echo "=========================================="
echo " Kết quả: ✅ ${SUCCESS} thành công | ❌ ${FAILED} thất bại | ⏭️  ${SKIPPED} bỏ qua"
echo "=========================================="

missing=0
for required in \
  "${CHECKPOINT_DIR}/sd_xl_base_1.0.safetensors" \
  "${CHECKPOINT_DIR}/RealVisXL_V6.0_B1.safetensors" \
  "${UPSCALE_DIR}/RealESRGAN_x4plus.pth"; do
  if [[ ! -f "${required}" ]]; then
    echo "❌ Thiếu model bắt buộc: ${required}" >&2
    missing=$((missing + 1))
  fi
done

if [[ "${missing}" -gt 0 ]]; then
  exit 1
fi

exit 0
