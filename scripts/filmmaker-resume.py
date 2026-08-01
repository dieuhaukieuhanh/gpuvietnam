#!/usr/bin/env python3
"""
GPUVietnam Filmmaker Resume — render video frame-by-frame with R2 checkpoint.

Usage:
  python3 filmmaker-resume.py
    --workflow /app/ComfyUI/workflows-stock/filmmaker.json
    --total_frames 5000
    --fps 24
    --prefix frame
    --job_id sonbal_ep2

For each frame:
  1. Check if already on R2 → skip
  2. Call ComfyUI API to render
  3. Save + upload to R2 via GpuvietnamFrameSaver node

On restart after crash:
  Automatically detects last rendered frame and resumes from there.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import uuid


API_BASE = os.environ.get(
    "GPUVIETNAM_PUBLIC_API_URL",
    os.environ.get("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:8080"),
).rstrip("/")

COMFY_URL = f"http://127.0.0.1:{os.environ.get('COMFYUI_PORT', '8080')}"
R2_BUCKET = os.environ.get("R2_BUCKET_NAME", "").strip()
R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "").strip()
R2_KEY = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
R2_SECRET = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
USER_ID = os.environ.get("GPUVIETNAM_USER_ID", "").strip()
BACKUP_TOKEN = os.environ.get("GPUVIETNAM_BACKUP_TOKEN", "").strip()
FRAME_PREFIX = "frames"


def r2_configured():
    return all([R2_BUCKET, R2_ENDPOINT, R2_KEY, R2_SECRET, USER_ID, BACKUP_TOKEN])


def check_resume_point(job_id, prefix, total_frames):
    """Find the first frame that hasn't been rendered yet."""
    start_frame = 0

    if not r2_configured():
        print("[Filmmaker] R2 not configured — starting from frame 0", flush=True)
        return 0

    try:
        restore_url = f"{API_BASE}/api/storage/custom-nodes-restore"
        req = urllib.request.Request(
            restore_url,
            headers={"Authorization": f"Bearer {BACKUP_TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            objects = data.get("objects") or []

        # Find all rendered frames for this job
        rendered = set()
        for obj in objects:
            key = obj.get("relativeKey", "")
            if f"{FRAME_PREFIX}/{job_id}/" in key:
                fname = key.split("/")[-1]
                if fname.startswith(prefix):
                    try:
                        num_part = fname[len(prefix) + 1:].replace(".png", "").replace(".jpg", "")
                        rendered.add(int(num_part))
                    except ValueError:
                        continue

        # Find first missing frame
        for i in range(total_frames):
            if i not in rendered:
                start_frame = i
                break
        else:
            start_frame = total_frames  # All done

        print(
            f"[Filmmaker] Resume check: {len(rendered)} frames found on R2, "
            f"starting from frame {start_frame}/{total_frames}",
            flush=True,
        )
    except Exception as e:
        print(f"[Filmmaker] Resume check failed: {e}", flush=True)

    return start_frame


def queue_prompt(prompt_workflow, client_id):
    """Submit a prompt to ComfyUI and get the prompt_id."""
    data = json.dumps({"prompt": prompt_workflow, "client_id": client_id}).encode("utf-8")
    req = urllib.request.Request(f"{COMFY_URL}/prompt", data=data)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for_prompt(prompt_id):
    """Poll ComfyUI history until the prompt completes."""
    while True:
        try:
            req = urllib.request.Request(f"{COMFY_URL}/history/{prompt_id}")
            with urllib.request.urlopen(req, timeout=10) as resp:
                history = json.loads(resp.read().decode("utf-8"))
                if str(prompt_id) in history:
                    return history[str(prompt_id)]
        except Exception:
            pass
        time.sleep(2)


def render_frames(workflow_path, total_frames, fps, prefix, job_id, start_frame):
    """Render frames from start_frame to total_frames-1."""
    client_id = str(uuid.uuid4())

    # Load base workflow
    with open(workflow_path, "r") as f:
        workflow = json.load(f)

    rendered = 0
    failed = 0
    t_start = time.time()

    for frame in range(start_frame, total_frames):
        frame_start = time.time()

        # Update workflow nodes with current frame number
        # Find prompt nodes and update seed/frame
        for node_id, node in workflow.items():
            if node.get("class_type") == "KSampler" or node.get("class_type") == "KSamplerAdvanced":
                if "seed" in node.get("inputs", {}):
                    node["inputs"]["seed"] = frame * 1000 + hash(job_id) % 1000
            if node.get("class_type") == "GpuvietnamFrameSaver":
                node["inputs"]["filename_prefix"] = prefix
                node["inputs"]["job_id"] = job_id

        try:
            result = queue_prompt(workflow, client_id)
            prompt_id = result.get("prompt_id")
            if not prompt_id:
                print(f"[Filmmaker] Frame {frame}: failed to queue", flush=True)
                failed += 1
                continue

            history = wait_for_prompt(prompt_id)
            elapsed = time.time() - frame_start
            rendered += 1

            eta = (total_frames - frame) * (elapsed if rendered > 0 else 20)
            eta_min = int(eta // 60)
            print(
                f"[Filmmaker] Frame {frame}/{total_frames} done in {elapsed:.1f}s "
                f"(ETA: {eta_min}m) — {rendered} ok, {failed} fail",
                flush=True,
            )

        except Exception as e:
            failed += 1
            print(f"[Filmmaker] Frame {frame}: error — {e}", flush=True)
            time.sleep(5)  # Brief pause on error

    total_elapsed = time.time() - t_start
    print(
        f"[Filmmaker] COMPLETE: {rendered} rendered, {failed} failed, "
        f"total time: {total_elapsed/3600:.1f}h",
        flush=True,
    )

    # Signal completion — write checkpoint marker
    marker_path = f"/app/ComfyUI/output/.filmmaker_done_{job_id}"
    with open(marker_path, "w") as f:
        f.write(f"done:{rendered}/{total_frames}:{failed}\n")


def auto_detect_job():
    """Check R2 for an interrupted filmmaker job and return its params."""
    if not r2_configured():
        return None

    try:
        restore_url = f"{API_BASE}/api/storage/custom-nodes-restore"
        req = urllib.request.Request(
            restore_url,
            headers={"Authorization": f"Bearer {BACKUP_TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            objects = data.get("objects") or []

        # Find filmmaker job markers: frames/<job_id>/frame_N.png
        jobs = {}
        for obj in objects:
            key = obj.get("relativeKey", "")
            if key.startswith(f"{FRAME_PREFIX}/") and key.endswith(".png"):
                parts = key.split("/")
                if len(parts) >= 3:
                    job_id = parts[1]
                    fname = parts[-1]
                    jobs[job_id] = jobs.get(job_id, 0) + 1

        if not jobs:
            return None

        # Pick the job with the most frames (most likely the active one)
        best_job = max(jobs, key=jobs.get)
        print(
            f"[Filmmaker] Auto-detected job: {best_job} ({jobs[best_job]} frames on R2)",
            flush=True,
        )
        return {"job_id": best_job, "frame_count": jobs[best_job]}

    except Exception as e:
        print(f"[Filmmaker] Auto-detect failed: {e}", flush=True)
        return None


def main():
    parser = argparse.ArgumentParser(description="GPUVietnam Filmmaker Resume Renderer")
    parser.add_argument("--workflow", help="Path to ComfyUI workflow JSON")
    parser.add_argument("--total_frames", type=int, help="Total frames to render")
    parser.add_argument("--fps", type=int, default=24, help="Frames per second")
    parser.add_argument("--prefix", default="frame", help="Filename prefix for frames")
    parser.add_argument("--job_id", help="Unique job identifier")
    parser.add_argument(
        "--start_frame", type=int, default=None,
        help="Force start frame (default: auto-detect from R2)",
    )
    parser.add_argument(
        "--auto-detect", action="store_true",
        help="Auto-detect interrupted job from R2 and resume",
    )
    args = parser.parse_args()

    # --auto-detect mode: find interrupted job and resume
    if args.auto_detect:
        job = auto_detect_job()
        if not job:
            print("[Filmmaker] No interrupted jobs found — idle", flush=True)
            sys.exit(0)
        args.job_id = job["job_id"]
        # Estimate total frames — use detected + buffer, or default
        if not args.total_frames:
            args.total_frames = 5000  # Default, can be overridden
        if not args.workflow:
            args.workflow = "/app/ComfyUI/workflows-stock/filmmaker.json"

    # Manual mode: require workflow, total_frames, job_id
    if not args.workflow or not args.total_frames or not args.job_id:
        print(
            "[Filmmaker] ERROR: --workflow, --total_frames, --job_id are required "
            "(unless using --auto-detect)",
            flush=True,
        )
        sys.exit(1)

    print(
        f"[Filmmaker] Starting: workflow={args.workflow}, "
        f"total_frames={args.total_frames}, job_id={args.job_id}",
        flush=True,
    )

    start_frame = args.start_frame
    if start_frame is None:
        # Wait for ComfyUI to be ready
        print("[Filmmaker] Waiting for ComfyUI...", flush=True)
        for _ in range(60):
            try:
                req = urllib.request.Request(f"{COMFY_URL}/system_stats")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    resp.read()
                print("[Filmmaker] ComfyUI ready", flush=True)
                break
            except Exception:
                time.sleep(2)
        else:
            print("[Filmmaker] ERROR: ComfyUI not ready after 2 min", flush=True)
            sys.exit(1)

        start_frame = check_resume_point(args.job_id, args.prefix, args.total_frames)

    if start_frame >= args.total_frames:
        print(f"[Filmmaker] All {args.total_frames} frames already rendered!", flush=True)
        sys.exit(0)

    render_frames(
        args.workflow, args.total_frames, args.fps,
        args.prefix, args.job_id, start_frame,
    )


if __name__ == "__main__":
    main()
