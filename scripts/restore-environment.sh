#!/usr/bin/env bash
# Pre-start custom_nodes restore — downloads persisted custom nodes from R2
# before ComfyUI starts, so they are loaded on first boot.
#
# Env (already in container):
#   GPUVIETNAM_BACKUP_TOKEN      machine-scoped backup token (required)
#   GPUVIETNAM_USER_ID           user UUID (already injected)
#   GPUVIETNAM_PUBLIC_API_URL    app base URL (optional, falls back to presign URL)
#
# Graceful: never blocks ComfyUI startup on failure.
set -uo pipefail

LOG_TAG="[PreStartRestore]"

log() { echo "${LOG_TAG} $*"; }
warn() { echo "${LOG_TAG} WARN: $*" >&2; }

# ──────── Check prerequisites ────────
TOKEN="${GPUVIETNAM_BACKUP_TOKEN:-}"
USER_ID="${GPUVIETNAM_USER_ID:-}"
COMFYUI_DIR="${COMFYUI_DIR:-/app/ComfyUI}"
CUSTOM_NODES_DIR="${COMFYUI_DIR}/custom_nodes"
RESTORE_LOG="${COMFYUI_DIR}/user/default/.gpuvietnam-pre-restore.log"
RESTORE_API_PATH="/api/storage/custom-nodes-restore"

if [[ -z "${TOKEN}" ]]; then
  warn "GPUVIETNAM_BACKUP_TOKEN not set — skipping pre-start custom_nodes restore"
  exit 0
fi

if [[ -z "${USER_ID}" ]]; then
  warn "GPUVIETNAM_USER_ID not set — skipping pre-start custom_nodes restore"
  exit 0
fi

# ──────── Resolve API base URL ────────
# Same logic as resolvePublicApiBaseUrl() in machine-backup-token.js
API_BASE=""
if [[ -n "${GPUVIETNAM_PUBLIC_API_URL:-}" ]]; then
  API_BASE="${GPUVIETNAM_PUBLIC_API_URL%/}"
elif [[ -n "${NEXT_PUBLIC_APP_URL:-}" ]]; then
  API_BASE="${NEXT_PUBLIC_APP_URL%/}"
elif [[ -n "${NEXT_PUBLIC_SITE_URL:-}" ]]; then
  API_BASE="${NEXT_PUBLIC_SITE_URL%/}"
fi

if [[ -z "${API_BASE}" ]]; then
  warn "No API base URL configured — skipping pre-start custom_nodes restore"
  exit 0
fi

RESTORE_URL="${API_BASE}${RESTORE_API_PATH}"

mkdir -p "${CUSTOM_NODES_DIR}"

# ──────── Timestamp for log ────────
echo "pre_start_restore_start=$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)" > "${RESTORE_LOG}" 2>/dev/null || true
echo "user_id=${USER_ID}" >> "${RESTORE_LOG}" 2>/dev/null || true

# ──────── Call restore API ────────
log "Requesting custom_nodes restore list from ${RESTORE_URL}"

# Use curl with timeout; capture JSON response
RESTORE_RESPONSE=""
if command -v curl >/dev/null 2>&1; then
  RESTORE_RESPONSE=$(curl -sS --max-time 30 \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/json" \
    "${RESTORE_URL}" 2>/tmp/gpuvietnam-restore-curl-error.log) || true
elif command -v wget >/dev/null 2>&1; then
  RESTORE_RESPONSE=$(wget -qO- --timeout=30 \
    --header="Authorization: Bearer ${TOKEN}" \
    --header="Accept: application/json" \
    "${RESTORE_URL}" 2>/tmp/gpuvietnam-restore-wget-error.log) || true
else
  warn "Neither curl nor wget available — skipping pre-start custom_nodes restore"
  exit 0
fi

if [[ -z "${RESTORE_RESPONSE}" ]]; then
  warn "Restore API returned empty response — skipping pre-start custom_nodes restore"
  exit 0
fi

# ──────── Parse JSON with python3 (available in ComfyUI image) ────────
RESTORE_COUNT=$(python3 -c "
import json,sys
try:
    data = json.loads(sys.stdin.read())
    objects = data.get('objects', [])
    print(len(objects))
except Exception as e:
    print('0')
    sys.stderr.write(f'${LOG_TAG} WARN: JSON parse failed: {e}\n')
" <<< "${RESTORE_RESPONSE}" 2>/tmp/gpuvietnam-restore-json-error.log)

RESTORE_COUNT="${RESTORE_COUNT:-0}"
RESTORE_COUNT=$(( RESTORE_COUNT + 0 ))  # force integer

if [[ "${RESTORE_COUNT}" -eq 0 ]]; then
  log "No custom_nodes backup found for user=${USER_ID} — fresh start"
  echo "status=no_backup" >> "${RESTORE_LOG}" 2>/dev/null || true
  echo "objects_count=0" >> "${RESTORE_LOG}" 2>/dev/null || true
  exit 0
fi

log "Found ${RESTORE_COUNT} custom_nodes backup objects — restoring..."

# ──────── Download and extract each object ────────
TEMP_DIR="/tmp/gpuvietnam-restore-$$"
mkdir -p "${TEMP_DIR}"

RESTORED=0
FAILED=0

python3 - "${RESTORE_RESPONSE}" "${CUSTOM_NODES_DIR}" "${TEMP_DIR}" "${LOG_TAG}" <<'PY'
import json, os, subprocess, sys

response_json, dest_dir, temp_dir, log_tag = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

def log(msg):
    print(f"{log_tag} {msg}", flush=True)

def warn(msg):
    print(f"{log_tag} WARN: {msg}", file=sys.stderr, flush=True)

try:
    data = json.loads(response_json)
except Exception as e:
    warn(f"Failed to parse response JSON: {e}")
    sys.exit(1)

objects = data.get('objects', [])
if not objects:
    log("No objects to restore")
    sys.exit(0)

restored = 0
failed = 0

for obj in objects:
    download_url = obj.get('downloadUrl', '')
    relative_key = obj.get('relativeKey', '')
    r2_key = obj.get('r2Key', '')

    if not download_url:
        failed += 1
        warn(f"No downloadUrl for {relative_key}")
        continue

    # Sanitize: reject path traversal in relative key
    if '..' in relative_key or relative_key.startswith('/'):
        failed += 1
        warn(f"Rejected unsafe relativeKey: {relative_key}")
        continue

    # Determine if this is a tar.gz archive (stop-backup) or individual file (periodic)
    is_archive = relative_key.endswith('.tar.gz')
    temp_file = os.path.join(temp_dir, os.path.basename(relative_key).replace('__', '_'))

    # Download
    try:
        result = subprocess.run(
            ['curl', '-fsSL', '--max-time', '120', '-o', temp_file, download_url],
            capture_output=True, text=True, timeout=130
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f'curl exit {result.returncode}')
    except Exception as e:
        failed += 1
        warn(f"Download failed for {relative_key}: {e}")
        continue

    # Extract or copy
    try:
        if is_archive:
            # tar.gz stop-backup archive — extract to custom_nodes/
            result = subprocess.run(
                ['tar', '-xzf', temp_file, '-C', dest_dir],
                capture_output=True, text=True, timeout=60
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or f'tar exit {result.returncode}')
            log(f"Extracted {relative_key} -> {dest_dir}")
        else:
            # Individual file — determine destination path
            # relativeKey format: custom_nodes/<node_dir>/<filename...>
            # Strip "custom_nodes/" prefix to get relative path within custom_nodes
            rel_path = relative_key
            if rel_path.startswith('custom_nodes/'):
                rel_path = rel_path[len('custom_nodes/'):]
            if not rel_path:
                failed += 1
                warn(f"Empty path after stripping prefix: {relative_key}")
                os.unlink(temp_file)
                continue

            dest_path = os.path.join(dest_dir, rel_path)
            dest_parent = os.path.dirname(dest_path)

            # Safety: ensure dest_path is within dest_dir
            real_dest = os.path.realpath(os.path.abspath(dest_path))
            real_root = os.path.realpath(os.path.abspath(dest_dir))
            if not real_dest.startswith(real_root + os.sep) and real_dest != real_root:
                failed += 1
                warn(f"Rejected path outside dest: {relative_key} -> {dest_path}")
                os.unlink(temp_file)
                continue

            os.makedirs(dest_parent, exist_ok=True)
            os.rename(temp_file, dest_path)
            log(f"Restored {relative_key} -> {dest_path}")

        restored += 1
    except Exception as e:
        failed += 1
        warn(f"Extract/copy failed for {relative_key}: {e}")

# Cleanup temp dir
try:
    import shutil
    shutil.rmtree(temp_dir, ignore_errors=True)
except Exception:
    pass

# Write summary
summary_path = os.path.join(os.path.dirname(dest_dir), 'user', 'default', '.gpuvietnam-pre-restore.log')
try:
    os.makedirs(os.path.dirname(summary_path), exist_ok=True)
    with open(summary_path, 'a') as f:
        f.write(f"status={'ok' if failed == 0 else 'partial'}\n")
        f.write(f"objects_count={len(objects)}\n")
        f.write(f"restored={restored}\n")
        f.write(f"failed={failed}\n")
        f.write(f"pre_start_restore_end={__import__('datetime').datetime.now().isoformat()}\n")
except Exception:
    pass

log(f"Restore complete: restored={restored} failed={failed} total={len(objects)}")
if failed > 0:
    sys.exit(2 if restored == 0 else 0)
PY

RESTORE_EXIT_CODE=$?

# ──────── Final log ────────
if [[ "${RESTORE_EXIT_CODE}" -eq 2 ]]; then
  warn "Pre-start restore: all objects failed — custom_nodes may be missing"
elif [[ "${RESTORE_EXIT_CODE}" -ne 0 ]]; then
  warn "Pre-start restore: some objects failed — continuing anyway"
fi

# Cleanup temp dir (best-effort, Python may have already done it)
rm -rf "${TEMP_DIR}" 2>/dev/null || true

# Never block ComfyUI — exit 0 always
log "Pre-start restore phase complete"
exit 0