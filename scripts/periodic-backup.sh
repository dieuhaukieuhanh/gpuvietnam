#!/usr/bin/env bash
# Periodic backup - uploads via GPUVietnam presigned URLs (no R2 secrets in the container).
# Env:
#   GPUVIETNAM_BACKUP_TOKEN   machine-scoped backup token (required)
#   GPUVIETNAM_PRESIGN_URL    e.g. https://app/api/storage/presign-upload (required)
#   GPUVIETNAM_PERIODIC_BACKUP  set 0 to disable (checked by start.sh)
#   GPUVIETNAM_BACKUP_SKIP_MODELS  set 1 to skip models (quota soft-limit)
# Optional intervals (seconds):
#   GPUVIETNAM_BACKUP_OUTPUTS_INTERVAL=300
#   GPUVIETNAM_BACKUP_WORKFLOWS_INTERVAL=900
#   GPUVIETNAM_BACKUP_MODELS_INTERVAL=300
set -u

LOG_TAG="[PeriodicBackup]"
COMFYUI_DIR="${COMFYUI_DIR:-/app/ComfyUI}"
STATE_DIR="${COMFYUI_DIR}/user/default/.gpuvietnam-backup-state"
OUTPUTS_DIR="${COMFYUI_DIR}/output"
WORKFLOWS_DIR="${COMFYUI_DIR}/user/default/workflows"
MODELS_DIR="${COMFYUI_DIR}/models"
CUSTOM_NODES_DIR="${COMFYUI_DIR}/custom_nodes"
SETTINGS_FILE="${COMFYUI_DIR}/user/default/comfy.settings.json"
SETTINGS_DIR="${COMFYUI_DIR}/user/default/.gpuvietnam-settings-upload"

OUTPUTS_INTERVAL="${GPUVIETNAM_BACKUP_OUTPUTS_INTERVAL:-300}"
WORKFLOWS_INTERVAL="${GPUVIETNAM_BACKUP_WORKFLOWS_INTERVAL:-900}"
MODELS_INTERVAL="${GPUVIETNAM_BACKUP_MODELS_INTERVAL:-300}"
CUSTOM_NODES_INTERVAL="${GPUVIETNAM_BACKUP_CUSTOM_NODES_INTERVAL:-1800}"
TICK_SECONDS=30

log() { echo "${LOG_TAG} $*"; }
log_err() { echo "${LOG_TAG} ERROR: $*" >&2; }

TOKEN="${GPUVIETNAM_BACKUP_TOKEN:-}"
PRESIGN_URL="${GPUVIETNAM_PRESIGN_URL:-}"

if [[ -z "${TOKEN}" || -z "${PRESIGN_URL}" ]]; then
  log_err "Missing GPUVIETNAM_BACKUP_TOKEN or GPUVIETNAM_PRESIGN_URL - periodic backup idle."
  while true; do sleep 3600; done
fi

mkdir -p "${STATE_DIR}/uploaded" "${STATE_DIR}/baseline"
BOOT_MARKER="${STATE_DIR}/boot_ts"
date +%s > "${BOOT_MARKER}"

# Snapshot models present at start (stock / download-models) - do not upload unless changed later.
python3 - "${MODELS_DIR}" "${STATE_DIR}/baseline/models.tsv" <<'PY'
import os, sys
root, out = sys.argv[1], sys.argv[2]
rows = []
if os.path.isdir(root):
    for dirpath, _, files in os.walk(root):
        for name in files:
            if name.endswith(".part") or name.startswith("."):
                continue
            path = os.path.join(dirpath, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            rel = os.path.relpath(path, root).replace("\\", "/")
            rows.append(f"{rel}\t{st.st_size}\t{int(st.st_mtime)}")
rows.sort()
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(rows) + ("\n" if rows else ""))
print(len(rows), flush=True)
PY
if [[ -f "${STATE_DIR}/baseline/models.tsv" ]]; then
  BASELINE_COUNT="$(wc -l < "${STATE_DIR}/baseline/models.tsv" | tr -d ' ')"
else
  BASELINE_COUNT=0
fi
log "Boot baseline models=${BASELINE_COUNT}. Presign=${PRESIGN_URL}"

LAST_OUTPUTS=0
LAST_WORKFLOWS=0
LAST_MODELS=0
LAST_SETTINGS=0
LAST_CUSTOM_NODES=0
SETTINGS_INTERVAL="${GPUVIETNAM_BACKUP_SETTINGS_INTERVAL:-900}"

upload_prefix() {
  local prefix="$1"
  local source_dir="$2"
  local mode="$3" # full | models_incremental
  python3 - "$prefix" "$source_dir" "$mode" "$STATE_DIR" "$TOKEN" "$PRESIGN_URL" "${GPUVIETNAM_BACKUP_REPORT_URL:-}" <<'PY'
import json, os, sys, urllib.request

prefix, source_dir, mode, state_dir, token, presign_url = sys.argv[1:7]
report_url = sys.argv[7].strip() if len(sys.argv) > 7 else ""
log_tag = "[PeriodicBackup]"

def log(msg):
    print(f"{log_tag} {msg}", flush=True)

def log_err(msg):
    print(f"{log_tag} ERROR: {msg}", file=sys.stderr, flush=True)

def content_type(path):
    lower = path.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    if lower.endswith((".mp4", ".webm")):
        return "video/mp4"
    if lower.endswith(".json"):
        return "application/json"
    if lower.endswith((".safetensors", ".ckpt", ".pt", ".bin", ".pth")):
        return "application/octet-stream"
    return "application/octet-stream"

def load_tsv(path):
    data = {}
    if not os.path.isfile(path):
        return data
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 3:
                data[parts[0]] = (int(parts[1]), int(parts[2]))
    return data

def save_uploaded(rel_key, size, mtime):
    path = os.path.join(state_dir, "uploaded", rel_key.replace("/", "__") + ".tsv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"{rel_key}\t{size}\t{mtime}\n")

def read_uploaded(rel_key):
    path = os.path.join(state_dir, "uploaded", rel_key.replace("/", "__") + ".tsv")
    data = load_tsv(path)
    return data.get(rel_key)

baseline = load_tsv(os.path.join(state_dir, "baseline", "models.tsv")) if mode == "models_incremental" else {}

max_mb = int(os.environ.get("GPUVIETNAM_BACKUP_MAX_FILE_MB") or "0")
max_bytes = max_mb * 1024 * 1024 if max_mb > 0 else 0

candidates = []
if not os.path.isdir(source_dir):
    log(f"Skip {prefix}: source missing ({source_dir})")
    sys.exit(0)

for dirpath, _, files in os.walk(source_dir):
    for name in files:
        if name.endswith(".part") or name.startswith("."):
            continue
        abs_path = os.path.join(dirpath, name)
        try:
            st = os.stat(abs_path)
        except OSError:
            continue
        rel = os.path.relpath(abs_path, source_dir).replace("\\", "/")
        object_key = f"{prefix}/{rel}"
        size, mtime = st.st_size, int(st.st_mtime)

        if max_bytes and size > max_bytes:
            log(f"Skip oversized {object_key} ({size} bytes)")
            continue

        if mode == "models_incremental":
            base = baseline.get(rel)
            if base is not None and base[0] == size and base[1] == mtime:
                # Unchanged stock / boot-time file
                continue

        prev = read_uploaded(object_key)
        if prev is not None and prev[0] == size and prev[1] == mtime:
            continue

        candidates.append((object_key, abs_path, size, mtime, content_type(abs_path)))

if not candidates:
    log(f"{prefix}: nothing new.")
    sys.exit(0)

log(f"Backing up {prefix} ({len(candidates)} files)...")

ok = 0
fail = 0
reported = []
BATCH = 20

def presign(batch):
    body = json.dumps({
        "objects": [{"key": k, "contentType": ct, "sizeBytes": sz} for k, _, sz, _, ct in batch],
        "expiresIn": 900,
    }).encode("utf-8")
    req = urllib.request.Request(
        presign_url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))

def put_file(url, path, ctype, size):
    # curl streams from disk - safe for multi-GB checkpoints
    import subprocess
    timeout = max(120, size // (128 * 1024) + 120)
    proc = subprocess.run(
        [
            "curl", "-fsS", "-X", "PUT",
            "-H", f"Content-Type: {ctype}",
            "--data-binary", f"@{path}",
            "--max-time", str(timeout),
            url,
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or f"curl exit {proc.returncode}").strip())

for i in range(0, len(candidates), BATCH):
    batch = candidates[i : i + BATCH]
    try:
        result = presign(batch)
    except Exception as e:
        log_err(f"presign failed for {prefix}: {e}")
        fail += len(batch)
        continue

    by_key = {u["key"]: u for u in (result.get("uploads") or []) if isinstance(u, dict) and u.get("key")}
    for err in result.get("errors") or []:
        log_err(f"presign reject {err.get('key')}: {err.get('error')}")
        fail += 1

    for object_key, abs_path, size, mtime, ctype in batch:
        upload = by_key.get(object_key)
        if not upload or not upload.get("uploadUrl"):
            if object_key not in by_key:
                # already counted in errors or missing
                if not any(e.get("key") == object_key for e in (result.get("errors") or [])):
                    fail += 1
                    log_err(f"no uploadUrl for {object_key}")
            continue
        try:
            put_file(upload["uploadUrl"], abs_path, upload.get("contentType") or ctype, size)
            save_uploaded(object_key, size, mtime)
            reported.append({"key": object_key, "sizeBytes": size})
            ok += 1
        except Exception as e:
            fail += 1
            log_err(f"PUT failed {object_key}: {e}")

if report_url and reported:
    try:
        body = json.dumps({"files": reported}).encode("utf-8")
        req = urllib.request.Request(
            report_url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
        log(f"{prefix}: reported {len(reported)} files to catalog")
    except Exception as e:
        log_err(f"backup-report failed: {e}")

log(f"{prefix}: Done. ok={ok} fail={fail}")
sys.exit(0 if fail == 0 else 1)
PY
}

now_ts() { date +%s; }

run_flush_once() {
  local fail=0
  log "Flush once (L2 HTTP) starting..."
  upload_prefix "outputs" "${OUTPUTS_DIR}" "full" || fail=1
  upload_prefix "workflows" "${WORKFLOWS_DIR}" "full" || fail=1
  # Stage settings file into a tiny folder for the shared uploader.
  if [[ -f "${SETTINGS_FILE}" ]]; then
    mkdir -p "${SETTINGS_DIR}"
    cp -f "${SETTINGS_FILE}" "${SETTINGS_DIR}/comfy.settings.json"
    upload_prefix "settings" "${SETTINGS_DIR}" "full" || fail=1
  fi
  if [[ "${GPUVIETNAM_BACKUP_SKIP_MODELS:-0}" != "1" ]]; then
    upload_prefix "models" "${MODELS_DIR}" "models_incremental" || fail=1
  else
    log "Flush once: skip models (quota)"
  fi
  if [[ -d "${CUSTOM_NODES_DIR}" ]]; then
    upload_prefix "custom_nodes" "${CUSTOM_NODES_DIR}" "full" || fail=1
  else
    log "Flush once: skip custom_nodes (no directory)"
  fi
  if [[ "$fail" -eq 0 ]]; then
    log "Flush once completed OK"
    return 0
  fi
  log_err "Flush once completed with errors"
  return 1
}

# Serialize periodic ticks and HTTP flush (--once).
LOCK_FILE="${STATE_DIR}/backup.lock"
exec 9>"${LOCK_FILE}"
if ! flock -w 560 9; then
  log_err "Could not acquire backup lock"
  exit 1
fi

if [[ "${1:-}" == "--once" ]]; then
  run_flush_once
  exit $?
fi

while true; do
  NOW="$(now_ts)"

  if (( NOW - LAST_OUTPUTS >= OUTPUTS_INTERVAL )); then
    LAST_OUTPUTS="$NOW"
    upload_prefix "outputs" "${OUTPUTS_DIR}" "full" || true
  fi

  if (( NOW - LAST_WORKFLOWS >= WORKFLOWS_INTERVAL )); then
    LAST_WORKFLOWS="$NOW"
    upload_prefix "workflows" "${WORKFLOWS_DIR}" "full" || true
  fi

  if (( NOW - LAST_SETTINGS >= SETTINGS_INTERVAL )); then
    LAST_SETTINGS="$NOW"
    if [[ -f "${SETTINGS_FILE}" ]]; then
      mkdir -p "${SETTINGS_DIR}"
      cp -f "${SETTINGS_FILE}" "${SETTINGS_DIR}/comfy.settings.json"
      upload_prefix "settings" "${SETTINGS_DIR}" "full" || true
    fi
  fi

  if [[ "${GPUVIETNAM_BACKUP_SKIP_MODELS:-0}" != "1" ]]; then
    if (( NOW - LAST_MODELS >= MODELS_INTERVAL )); then
      LAST_MODELS="$NOW"
      upload_prefix "models" "${MODELS_DIR}" "models_incremental" || true
    fi
  fi

  if [[ -d "${CUSTOM_NODES_DIR}" ]]; then
    if (( NOW - LAST_CUSTOM_NODES >= CUSTOM_NODES_INTERVAL )); then
      LAST_CUSTOM_NODES="$NOW"
      upload_prefix "custom_nodes" "${CUSTOM_NODES_DIR}" "full" || true
    fi
  fi

  # Release lock during sleep so HTTP flush can run.
  flock -u 9
  sleep "${TICK_SECONDS}"
  if ! flock -w 560 9; then
    log_err "Could not re-acquire backup lock"
    sleep 5
    continue
  fi
done