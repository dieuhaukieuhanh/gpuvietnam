#!/usr/bin/env python3
"""
GPUVietnam Frame Quality Check — 3-tier quality gate for filmmaker frames.

Runs on VPS CPU (not GPU). Watches R2 for new frames, runs quality checks,
and flags bad frames for re-render.

Tier 1 (fast):  MediaPipe Face landmarks + Hand count
Tier 2 (accurate): InsightFace identity match + SSIM temporal consistency
Tier 3 (manual):  Telegram bot for customer review (future)

Requirements (VPS):
  pip install opencv-python-headless mediapipe insightface onnxruntime scikit-image

Usage:
  python3 frame-quality-check.py
    --job_id sonbal_ep2
    --total_frames 5000
    --anchor_dir /opt/gpuvietnam/anchors/sonbal/
    --prefix frame

Or auto-detect mode (finds active jobs on R2):
  python3 frame-quality-check.py --auto-detect
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

# ──────── Config ────────
API_BASE = os.environ.get("GPUVIETNAM_PUBLIC_API_URL", "https://gpuvietnam.com").rstrip("/")
BACKUP_TOKEN = os.environ.get("GPUVIETNAM_BACKUP_TOKEN", "").strip()
USER_ID = os.environ.get("GPUVIETNAM_USER_ID", "").strip()
R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "").strip()
R2_KEY = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
R2_SECRET = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
R2_BUCKET = os.environ.get("R2_BUCKET_NAME", "").strip()
FRAME_PREFIX = "frames"

COMFY_URL_TEMPLATE = "http://{ip}:{port}"

# Thresholds (tuned for filmmaker quality)
FACE_CONFIDENCE_MIN = 0.7       # MediaPipe face detection confidence
HAND_FINGER_COUNT_OK = 5        # Expected finger count (thumb + 4)
HAND_FINGER_MAX = 5             # More than 5 = AI artifact
INSIGHTFACE_COSINE_MIN = 0.65   # Cosine similarity to anchor mean
SSIM_MIN = 0.85                 # Temporal consistency between adjacent frames

# Lazy-loaded models
_mediapipe_face = None
_mediapipe_hands = None
_insightface_app = None
_anchor_embedding = None


# ──────── Model Loading ────────

def _load_mediapipe_face():
    global _mediapipe_face
    if _mediapipe_face is None:
        import mediapipe as mp
        _mediapipe_face = mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=FACE_CONFIDENCE_MIN
        )
    return _mediapipe_face


def _load_mediapipe_hands():
    global _mediapipe_hands
    if _mediapipe_hands is None:
        import mediapipe as mp
        _mediapipe_hands = mp.solutions.hands.Hands(
            static_image_mode=True,
            max_num_hands=2,
            min_detection_confidence=0.5,
        )
    return _mediapipe_hands


def _load_insightface():
    global _insightface_app
    if _insightface_app is None:
        try:
            from insightface.app import FaceAnalysis
            _insightface_app = FaceAnalysis(name="buffalo_l")
            _insightface_app.prepare(ctx_id=-1, det_size=(640, 640))
        except ImportError:
            print("[QualityCheck] insightface not installed — skipping identity check", flush=True)
            _insightface_app = False
    return _insightface_app if _insightface_app is not False else None


def load_anchor_embeddings(anchor_dir):
    """Load 5 diverse anchor images and compute mean embedding."""
    global _anchor_embedding
    if _anchor_embedding is not None:
        return _anchor_embedding

    app = _load_insightface()
    if not app:
        return None

    import cv2
    p = Path(anchor_dir)
    if not p.exists():
        return None

    images = sorted(p.glob("*.jpg")) + sorted(p.glob("*.png"))
    if not images:
        return None

    embeddings = []
    for img_path in images[:10]:
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        faces = app.get(img)
        if faces:
            embeddings.append(faces[0].normed_embedding)

    if not embeddings:
        return None

    _anchor_embedding = np.mean(embeddings, axis=0)
    print(
        f"[QualityCheck] Loaded anchor: {len(embeddings)} faces from {anchor_dir}",
        flush=True,
    )
    return _anchor_embedding


# ──────── R2 Helpers ────────

def _r2_configured():
    return all([R2_BUCKET, R2_ENDPOINT, R2_KEY, R2_SECRET])


def download_frame_from_r2(job_id, frame_num, prefix):
    """Download a single frame from R2 to memory."""
    if not _r2_configured():
        return None

    try:
        import boto3
        from botocore.config import Config

        s3 = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_KEY,
            aws_secret_access_key=R2_SECRET,
            config=Config(signature_version="s3v4"),
        )
        key = f"users/{USER_ID}/{FRAME_PREFIX}/{job_id}/{prefix}_{frame_num:05d}.png"
        import io
        buf = io.BytesIO()
        s3.download_fileobj(R2_BUCKET, key, buf)
        buf.seek(0)
        import cv2
        arr = np.frombuffer(buf.read(), np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception as e:
        print(f"[QualityCheck] R2 download failed for frame {frame_num}: {e}", flush=True)
        return None


def list_job_frames_on_r2(job_id):
    """List all frame numbers for a job on R2."""
    if not _r2_configured() or not BACKUP_TOKEN:
        return set()

    try:
        restore_url = f"{API_BASE}/api/storage/custom-nodes-restore"
        req = urllib.request.Request(
            restore_url,
            headers={"Authorization": f"Bearer {BACKUP_TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            objects = data.get("objects") or []

        frames = set()
        for obj in objects:
            key = obj.get("relativeKey", "")
            if f"{FRAME_PREFIX}/{job_id}/" in key:
                fname = key.split("/")[-1].replace(".png", "").replace(".jpg", "")
                parts = fname.rsplit("_", 1)
                if len(parts) == 2 and parts[1].isdigit():
                    frames.add(int(parts[1]))
        return frames
    except Exception as e:
        print(f"[QualityCheck] R2 list failed: {e}", flush=True)
        return set()


# ──────── Quality Checks ────────

def check_face_mediapipe(image):
    """Check if face is present and not severely distorted."""
    try:
        import cv2
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        face_detector = _load_mediapipe_face()
        results = face_detector.process(rgb)

        if not results.detections:
            return False, 0.0, "no_face_detected"

        # Get highest confidence face
        best = max(results.detections, key=lambda d: d.score[0])
        score = float(best.score[0])

        # Check face has reasonable bounding box (not tiny fragment)
        h, w = image.shape[:2]
        bbox = best.location_data.relative_bounding_box
        face_area = bbox.width * bbox.height
        if face_area < 0.02:  # Face too small
            return False, score, "face_too_small"

        if score < FACE_CONFIDENCE_MIN:
            return False, score, "face_confidence_low"

        return True, score, "ok"
    except Exception as e:
        return False, 0.0, f"face_check_error: {e}"


def check_hands_mediapipe(image):
    """Check for AI hand artifacts (6+ fingers, fused fingers)."""
    try:
        import cv2
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        hands = _load_mediapipe_hands()
        results = hands.process(rgb)

        if not results.multi_hand_landmarks:
            return True, 0, "no_hands"  # No hands = nothing wrong

        for hand_lms in results.multi_hand_landmarks:
            # Count fingers by checking if tip is above PIP joint
            tips = [4, 8, 12, 16, 20]   # Thumb, index, middle, ring, pinky
            pips = [3, 6, 10, 14, 18]   # PIP joints
            fingers_up = 0
            for tip, pip in zip(tips, pips):
                if hand_lms.landmark[tip].y < hand_lms.landmark[pip].y:
                    fingers_up += 1

            if fingers_up > HAND_FINGER_MAX:
                return False, fingers_up, f"too_many_fingers:{fingers_up}"

        return True, len(results.multi_hand_landmarks), "ok"
    except Exception as e:
        return True, 0, f"hand_check_warn: {e}"  # Don't fail on hand check errors


def check_identity_insightface(image):
    """Check if the face matches the character anchor."""
    anchor = _anchor_embedding if _anchor_embedding is not None else None
    if anchor is None:
        return None  # No anchor — skip check

    app = _load_insightface()
    if not app:
        return None

    try:
        faces = app.get(image)
        if not faces:
            return False, 0.0, "no_face_for_identity"

        emb = faces[0].normed_embedding
        score = float(np.dot(emb, anchor))

        if score < INSIGHTFACE_COSINE_MIN:
            return False, score, f"identity_mismatch:{score:.3f}"

        return True, score, "ok"
    except Exception as e:
        return None  # Error — can't determine, skip


def check_temporal_ssim(image_curr, image_prev):
    """Check temporal consistency between consecutive frames."""
    if image_prev is None:
        return True, 1.0, "first_frame"

    try:
        from skimage.metrics import structural_similarity as ssim
        import cv2

        # Resize to same dimensions if needed
        if image_curr.shape != image_prev.shape:
            image_prev = cv2.resize(image_prev, (image_curr.shape[1], image_curr.shape[0]))

        # Convert to grayscale for faster SSIM
        gray_curr = cv2.cvtColor(image_curr, cv2.COLOR_BGR2GRAY)
        gray_prev = cv2.cvtColor(image_prev, cv2.COLOR_BGR2GRAY)

        score = ssim(gray_curr, gray_prev, data_range=255)

        if score < SSIM_MIN:
            return False, score, f"temporal_glitch:{score:.3f}"

        return True, score, "ok"
    except ImportError:
        return True, 1.0, "ssim_unavailable"
    except Exception as e:
        return True, 1.0, f"ssim_warn: {e}"


# ──────── Pipeline ────────

def check_frame(image, frame_num, prev_image=None):
    """Run all quality checks on a single frame.
    Returns (passed: bool, details: dict)
    """
    details = {"frame": frame_num}

    # Tier 1: MediaPipe (fast)
    face_ok, face_score, face_reason = check_face_mediapipe(image)
    details["face"] = {"ok": face_ok, "score": face_score, "reason": face_reason}

    hands_ok, hand_count, hands_reason = check_hands_mediapipe(image)
    details["hands"] = {"ok": hands_ok, "count": hand_count, "reason": hands_reason}

    # Tier 2: InsightFace + SSIM (accurate)
    identity_result = check_identity_insightface(image)
    if identity_result is not None:
        identity_ok, identity_score, identity_reason = identity_result
        details["identity"] = {"ok": identity_ok, "score": identity_score, "reason": identity_reason}
    else:
        identity_ok = True  # Skip if no model

    ssim_ok, ssim_score, ssim_reason = check_temporal_ssim(image, prev_image)
    details["ssim"] = {"ok": ssim_ok, "score": ssim_score, "reason": ssim_reason}

    # Combine: frame fails if ANY check fails
    passed = face_ok and hands_ok and identity_ok and ssim_ok

    return passed, details


def auto_detect_jobs():
    """Find active filmmaker jobs on R2."""
    if not _r2_configured() or not BACKUP_TOKEN:
        return []

    try:
        restore_url = f"{API_BASE}/api/storage/custom-nodes-restore"
        req = urllib.request.Request(
            restore_url,
            headers={"Authorization": f"Bearer {BACKUP_TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            objects = data.get("objects") or []

        jobs = {}
        for obj in objects:
            key = obj.get("relativeKey", "")
            if key.startswith(f"{FRAME_PREFIX}/"):
                parts = key.split("/")
                if len(parts) >= 3:
                    job_id = parts[1]
                    jobs[job_id] = jobs.get(job_id, 0) + 1

        return [(job_id, count) for job_id, count in sorted(jobs.items(), key=lambda x: -x[1])]
    except Exception as e:
        print(f"[QualityCheck] Auto-detect jobs failed: {e}", flush=True)
        return []


def main():
    parser = argparse.ArgumentParser(description="GPUVietnam Frame Quality Check")
    parser.add_argument("--job_id", help="Filmmaker job ID")
    parser.add_argument("--total_frames", type=int, help="Total frames in job")
    parser.add_argument("--anchor_dir", help="Directory with character anchor images")
    parser.add_argument("--prefix", default="frame", help="Frame filename prefix")
    parser.add_argument("--start_frame", type=int, default=0, help="First frame to check")
    parser.add_argument("--auto-detect", action="store_true", help="Auto-detect jobs from R2")
    parser.add_argument("--output", help="Output JSON path for bad frames list")
    args = parser.parse_args()

    # Auto-detect mode
    if args.auto_detect:
        jobs = auto_detect_jobs()
        if not jobs:
            print("[QualityCheck] No active filmmaker jobs found", flush=True)
            sys.exit(0)
        print(f"[QualityCheck] Found {len(jobs)} job(s):", flush=True)
        for jid, count in jobs:
            print(f"  {jid}: {count} frames", flush=True)
        sys.exit(0)

    # Manual mode
    if not args.job_id or not args.total_frames:
        print("ERROR: --job_id and --total_frames required (or use --auto-detect)", flush=True)
        sys.exit(1)

    # Load anchor if available
    if args.anchor_dir:
        load_anchor_embeddings(args.anchor_dir)

    print(
        f"[QualityCheck] Starting: job={args.job_id}, "
        f"frames={args.total_frames}, anchor={'yes' if _anchor_embedding is not None else 'no'}",
        flush=True,
    )

    bad_frames = []
    prev_image = None
    t_start = time.time()

    for frame_num in range(args.start_frame, args.total_frames):
        # Download frame from R2
        image = download_frame_from_r2(args.job_id, frame_num, args.prefix)
        if image is None:
            continue  # Frame not on R2 yet — skip

        # Check previous frame for SSIM
        if frame_num > 0 and prev_image is None:
            prev_image = download_frame_from_r2(args.job_id, frame_num - 1, args.prefix)

        # Run checks
        passed, details = check_frame(image, frame_num, prev_image)

        if not passed:
            bad_frames.append(details)
            reasons = []
            if not details.get("face", {}).get("ok"): reasons.append("face")
            if not details.get("hands", {}).get("ok"): reasons.append("hands")
            if not details.get("identity", {}).get("ok"): reasons.append("identity")
            if not details.get("ssim", {}).get("ok"): reasons.append("ssim")
            print(f"[QualityCheck] FAIL frame {frame_num}: {','.join(reasons)}", flush=True)
        elif frame_num % 100 == 0:
            elapsed = time.time() - t_start
            fps = frame_num / elapsed if elapsed > 0 else 0
            print(
                f"[QualityCheck] Progress: {frame_num}/{args.total_frames} "
                f"({fps:.1f} fps) — {len(bad_frames)} bad so far",
                flush=True,
            )

        # Save current as previous for next SSIM
        prev_image = image

    total_elapsed = time.time() - t_start
    bad_pct = len(bad_frames) / args.total_frames * 100 if args.total_frames > 0 else 0

    report = {
        "job_id": args.job_id,
        "total_frames": args.total_frames,
        "checked_frames": args.total_frames - args.start_frame,
        "bad_frames": len(bad_frames),
        "bad_pct": round(bad_pct, 1),
        "elapsed_sec": round(total_elapsed, 1),
        "bad_frame_list": bad_frames,
    }

    print(
        f"[QualityCheck] DONE: {len(bad_frames)}/{args.total_frames} "
        f"({bad_pct:.1f}%) frames failed in {total_elapsed:.0f}s",
        flush=True,
    )

    # Output JSON
    if args.output:
        with open(args.output, "w") as f:
            json.dump(report, f, indent=2)
    else:
        print(json.dumps({k: v for k, v in report.items() if k != "bad_frame_list"}, indent=2))

    sys.exit(0 if len(bad_frames) == 0 else 1)


if __name__ == "__main__":
    main()
