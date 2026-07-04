#!/usr/bin/env bash
set -euo pipefail

WORKSTATION="${GPUVIETNAM_WORKSTATION:-character-art}"
ENV_NAME="${GPUVIETNAM_ENV_NAME:-ComfyUI — Character & Art}"
STOCK_DIR="/app/ComfyUI/workflows-stock"
DEST="/app/ComfyUI/user/default/workflows"
MARKER="/app/ComfyUI/user/default/gpuvietnam-env.txt"

mkdir -p "${DEST}"

if [[ ! -d "${STOCK_DIR}" ]]; then
  echo "[GPUVietnam] workflows-stock missing — skipping workstation setup"
  exit 0
fi

rm -f "${DEST}/avatar-ghibli.json" \
  "${DEST}/sinh-anh-co-ban.json" \
  "${DEST}/upscale-anh-cu.json" \
  "${DEST}/tao-anh-san-pham.json" \
  "${DEST}/doi-background.json"

copy_workflow() {
  local filename="$1"
  if [[ -f "${STOCK_DIR}/${filename}" ]]; then
    cp -f "${STOCK_DIR}/${filename}" "${DEST}/"
  fi
}

case "${WORKSTATION}" in
  character-art)
    copy_workflow avatar-ghibli.json
    copy_workflow sinh-anh-co-ban.json
    copy_workflow upscale-anh-cu.json
    ;;
  commerce-product)
    copy_workflow tao-anh-san-pham.json
    copy_workflow doi-background.json
    ;;
  video-ai)
    copy_workflow sinh-anh-co-ban.json
    ;;
  *)
    copy_workflow avatar-ghibli.json
    copy_workflow sinh-anh-co-ban.json
    ;;
esac

printf '%s' "${ENV_NAME}" > "${MARKER}"

echo "[GPUVietnam] Workstation ready: ${ENV_NAME} (${WORKSTATION})"
ls -1 "${DEST}"/*.json 2>/dev/null || true
