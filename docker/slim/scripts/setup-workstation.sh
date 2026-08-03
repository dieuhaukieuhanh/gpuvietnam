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

# Browser tab title for this workstation (Chrome tab label).
# Written at boot so each env gets a distinct title without rebuilding per env.
TITLE_JS_DIR="/app/ComfyUI/custom_nodes/gpuvietnam_branding/web"
if [[ -d "${TITLE_JS_DIR}" ]]; then
  # Prefer short label: strip leading "ComfyUI — " / "ComfyUI - "
  SHORT_NAME="${ENV_NAME}"
  SHORT_NAME="${SHORT_NAME#ComfyUI — }"
  SHORT_NAME="${SHORT_NAME#ComfyUI - }"
  SHORT_NAME="${SHORT_NAME#ComfyUI —}"
  # Tab title: just the env short name (e.g. "Character & Art")
  TAB_TITLE="${SHORT_NAME}"
  # Escape for JS string
  TAB_TITLE_ESC="${TAB_TITLE//\\/\\\\}"
  TAB_TITLE_ESC="${TAB_TITLE_ESC//\"/\\\"}"
  cat > "${TITLE_JS_DIR}/tab_title.js" <<EOF
import { app } from "../../scripts/app.js";

const TITLE = "${TAB_TITLE_ESC}";

function applyTitle() {
  if (document.title !== TITLE) {
    document.title = TITLE;
  }
}

app.registerExtension({
  name: "gpuvietnam.tabTitle",
  async setup() {
    applyTitle();
    const timer = setInterval(applyTitle, 1500);
    setTimeout(() => clearInterval(timer), 60000);
    try {
      const obs = new MutationObserver(applyTitle);
      const el = document.querySelector("title");
      if (el) obs.observe(el, { childList: true, characterData: true, subtree: true });
    } catch (_) {}
  },
});
EOF
  echo "[GPUVietnam] Browser tab title: ${TAB_TITLE}"
fi

echo "[GPUVietnam] Workstation ready: ${ENV_NAME} (${WORKSTATION})"
ls -1 "${DEST}"/*.json 2>/dev/null || true
