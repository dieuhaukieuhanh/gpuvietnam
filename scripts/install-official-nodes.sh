#!/usr/bin/env bash
# Install Official Node Pack from image/official-nodes.lock
# Usage: PROFILE=v3|v4 COMFYUI_DIR=/app/ComfyUI LOCKFILE=/app/official-nodes.lock ./install-official-nodes.sh
set -euo pipefail

PROFILE="${PROFILE:-v3}"
COMFYUI_DIR="${COMFYUI_DIR:-/app/ComfyUI}"
LOCKFILE="${LOCKFILE:-/app/official-nodes.lock}"
NODES_DIR="${COMFYUI_DIR}/custom_nodes"

if [[ ! -f "${LOCKFILE}" ]]; then
  echo "[OfficialNodes] ERROR: lockfile not found: ${LOCKFILE}" >&2
  exit 1
fi

mkdir -p "${NODES_DIR}"
cd "${NODES_DIR}"

install_one() {
  local dir_name="$1"
  local git_url="$2"
  local sha="$3"

  echo "[OfficialNodes] ${dir_name} @ ${sha}"
  rm -rf "${dir_name}"
  git clone "${git_url}" "${dir_name}"
  git -C "${dir_name}" checkout --force "${sha}"

  # Install Python deps when present (fail soft on optional extras).
  # Strip git+ VCS deps that compile CUDA extensions during image build
  # (e.g. facebookresearch/sam2 from Impact Pack) — hang / fail on CPU builders.
  if [[ -f "${dir_name}/requirements.txt" ]]; then
    local req_filtered
    req_filtered="$(mktemp)"
    grep -vE '^[[:space:]]*(git\+|https?://github\.com/.+\.git)' "${dir_name}/requirements.txt" \
      | grep -vE 'facebookresearch/sam2' \
      > "${req_filtered}" || true
    if [[ -s "${req_filtered}" ]]; then
      # Prefer onnxruntime (CPU wheel ~smaller) over onnxruntime-gpu (~300MB) for reliable image builds.
      # Preprocessors still work; GPU hosts already have CUDA via torch.
      sed -i 's/onnxruntime-gpu/onnxruntime/g' "${req_filtered}" || true
      pip install --no-cache-dir --default-timeout=600 --retries 10 -r "${req_filtered}" \
        || pip install --no-cache-dir --default-timeout=600 --retries 10 -r "${req_filtered}" --no-deps \
        || echo "[OfficialNodes] WARN: pip requirements failed for ${dir_name}"
    else
      echo "[OfficialNodes] WARN: no installable pip lines for ${dir_name} after filtering VCS deps"
    fi
    rm -f "${req_filtered}"
  fi
  if [[ -f "${dir_name}/install.py" ]]; then
    (cd "${dir_name}" && python install.py) \
      || echo "[OfficialNodes] WARN: install.py failed for ${dir_name}"
  fi
}

while IFS=$'\t' read -r profile dir_name git_url sha || [[ -n "${profile:-}" ]]; do
  # Skip comments / blank
  [[ -z "${profile}" || "${profile}" =~ ^# ]] && continue
  if [[ "${profile}" == "common" ]] || [[ "${profile}" == "${PROFILE}" ]]; then
    install_one "${dir_name}" "${git_url}" "${sha}"
  fi
done < "${LOCKFILE}"

echo "[OfficialNodes] Done PROFILE=${PROFILE}"
ls -1 "${NODES_DIR}"
