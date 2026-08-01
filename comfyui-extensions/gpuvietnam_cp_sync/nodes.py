"""
GPUVietnam Frame Saver — saves each rendered frame and uploads to R2.
Works with any ComfyUI image pipeline. Non-blocking upload.
"""
import os
import json
import subprocess
import hashlib
import time
from pathlib import Path

import numpy as np
from PIL import Image
import folder_paths


OUTPUT_DIR = folder_paths.get_output_directory()

R2_BUCKET = os.environ.get("R2_BUCKET_NAME", "").strip()
R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "").strip()
R2_KEY = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
R2_SECRET = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
USER_ID = os.environ.get("GPUVIETNAM_USER_ID", "").strip()
PUBLIC_API_URL = os.environ.get("GPUVIETNAM_PUBLIC_API_URL", "").strip()
BACKUP_TOKEN = os.environ.get("GPUVIETNAM_BACKUP_TOKEN", "").strip()
FRAME_CHECKPOINT_BASE = "frames"

# Track uploaded hashes to skip re-uploads
_uploaded_hashes = set()


def _r2_configured():
    return all([R2_BUCKET, R2_ENDPOINT, R2_KEY, R2_SECRET])


def _file_hash(filepath):
    """Fast partial hash for dedup — first and last 4KB."""
    size = os.path.getsize(filepath)
    with open(filepath, "rb") as f:
        head = f.read(4096)
        if size > 8192:
            f.seek(-4096, os.SEEK_END)
            tail = f.read(4096)
        else:
            tail = b""
    return hashlib.sha256(head + tail + str(size).encode()).hexdigest()


def _upload_to_r2(filepath, r2_key):
    """Upload a single file to R2 via presigned URL from GPUVietnam API."""
    if not _r2_configured() or not USER_ID or not PUBLIC_API_URL or not BACKUP_TOKEN:
        return False

    try:
        # 1. Get presigned upload URL
        import urllib.request
        presign_url = f"{PUBLIC_API_URL}/api/storage/presign-upload"
        content_type = "image/png" if filepath.endswith(".png") else "image/jpeg"
        size = os.path.getsize(filepath)

        body = json.dumps({
            "objects": [{
                "key": f"users/{USER_ID}/{FRAME_CHECKPOINT_BASE}/{r2_key}",
                "contentType": content_type,
                "sizeBytes": size,
            }],
            "expiresIn": 3600,
        }).encode("utf-8")

        req = urllib.request.Request(
            presign_url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {BACKUP_TOKEN}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        uploads = result.get("uploads") or []
        if not uploads:
            print(f"[FrameSaver] No presigned URL for {r2_key}", flush=True)
            return False

        # 2. PUT file to R2
        upload_url = uploads[0].get("uploadUrl")
        if not upload_url:
            return False

        with open(filepath, "rb") as f:
            data = f.read()

        put_req = urllib.request.Request(upload_url, data=data, method="PUT")
        put_req.add_header("Content-Type", content_type)
        with urllib.request.urlopen(put_req, timeout=120) as put_resp:
            pass  # 200 OK

        print(f"[FrameSaver] Uploaded {r2_key} ({size} bytes)", flush=True)
        return True

    except Exception as e:
        print(f"[FrameSaver] Upload failed for {r2_key}: {e}", flush=True)
        return False


class GpuvietnamFrameSaver:
    """
    Saves images and uploads them to R2 for filmmaker resume.
    Output is identical to SaveImage — transparent to the pipeline.
    """
    def __init__(self):
        self.output_dir = OUTPUT_DIR
        self.type = "output"
        self.prefix_append = ""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "frame"}),
            },
            "optional": {
                "job_id": ("STRING", {"default": "", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "save_frames"
    OUTPUT_NODE = True
    CATEGORY = "image"

    def save_frames(self, images, filename_prefix="frame", job_id=""):
        import torch

        results = []
        job = job_id.strip() or str(int(time.time()))

        for batch_number, image in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            # Full paths
            filename = f"{filename_prefix}_{batch_number:05d}.png"
            local_path = os.path.join(self.output_dir, filename)

            # Save locally
            img.save(local_path, compress_level=4)
            results.append({
                "filename": filename,
                "subfolder": "",
                "type": self.type,
            })

            # Upload to R2 asynchronously (best-effort, non-blocking)
            r2_key = f"{job}/{filename}"
            hash_val = _file_hash(local_path)
            if hash_val not in _uploaded_hashes:
                _uploaded_hashes.add(hash_val)
                # Fire-and-forget upload via subprocess for true non-blocking
                subprocess.Popen(
                    [
                        "python3", "-c",
                        f"from nodes import _upload_to_r2; _upload_to_r2({repr(local_path)}, {repr(r2_key)})",
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )

        return {"ui": {"images": results}, "result": (images,)}


class GpuvietnamFrameSkip:
    """
    Check R2 for existing frames and skip if already rendered.
    Returns count of already-rendered frames so the workflow can resume.
    """
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "total_frames": ("INT", {"default": 100, "min": 1, "max": 100000}),
                "filename_prefix": ("STRING", {"default": "frame"}),
                "job_id": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("INT", "INT", "STRING")
    RETURN_NAMES = ("start_frame", "total_frames", "status")
    FUNCTION = "check_resume"
    CATEGORY = "image"

    def check_resume(self, total_frames, filename_prefix="frame", job_id=""):
        job = job_id.strip() or str(int(time.time()))
        start_frame = 0
        found = False

        if _r2_configured() and USER_ID and PUBLIC_API_URL and BACKUP_TOKEN:
            try:
                import urllib.request
                restore_url = f"{PUBLIC_API_URL}/api/storage/custom-nodes-restore"
                req = urllib.request.Request(
                    restore_url,
                    headers={"Authorization": f"Bearer {BACKUP_TOKEN}"},
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    objects = data.get("objects") or []

                    # Find frames belonging to this job
                    for obj in objects:
                        key = obj.get("relativeKey", "")
                        if f"{FRAME_CHECKPOINT_BASE}/{job}/" in key:
                            # Extract frame number from filename
                            fname = key.split("/")[-1]
                            if fname.startswith(filename_prefix):
                                try:
                                    num_part = fname[len(filename_prefix) + 1 :].replace(".png", "")
                                    frame_num = int(num_part)
                                    if frame_num >= start_frame:
                                        start_frame = frame_num + 1
                                        found = True
                                except ValueError:
                                    continue
            except Exception as e:
                print(f"[FrameSkip] Check failed: {e}", flush=True)

        status = f"Resume from frame {start_frame}/{total_frames}"
        if found:
            status += " — skipped already-rendered frames"
        else:
            status += " — fresh start"

        print(f"[FrameSkip] {status}", flush=True)
        return (start_frame, total_frames, status)


NODE_CLASS_MAPPINGS = {
    "GpuvietnamFrameSaver": GpuvietnamFrameSaver,
    "GpuvietnamFrameSkip": GpuvietnamFrameSkip,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GpuvietnamFrameSaver": "GPUVietnam Frame Saver (R2)",
    "GpuvietnamFrameSkip": "GPUVietnam Frame Skip (Resume)",
}
