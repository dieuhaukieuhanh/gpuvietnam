#!/usr/bin/env python3
"""
Minimal HTTP health server for GPU infrastructure probing.

Endpoints:
  GET /health       → 200 + GPU info (nvidia-smi)
  GET /system_stats → ComfyUI-compatible JSON (so we can reuse gate logic)
  GET /             → 200 plain text

No PyTorch dependency — image stays ~200-300 MB.
"""

import json
import os
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

HOST = os.environ.get("HOST", "::")
PORT = int(os.environ.get("PORT", 8080))

# ---------------------------------------------------------------------------
# nvidia-smi helpers
# ---------------------------------------------------------------------------

def run_nvidia_smi():
    """Run nvidia-smi and return parsed GPU info."""
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version",
             "--format=csv,noheader,nounits"],
            timeout=10,
        ).decode("utf-8", errors="replace").strip()
    except Exception:
        return None

    if not out:
        return None

    lines = out.strip().split("\n")
    gpus = []
    for line in lines:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2:
            gpus.append({
                "name": parts[0],
                "vram_total_mb": int(float(parts[1]) if len(parts) > 1 and parts[1] else 0),
                "driver_version": parts[2] if len(parts) > 2 else "",
            })
    return gpus


def run_cuda_smoke():
    """Run the CUDA compute smoke check via a small Python script."""
    try:
        out = subprocess.check_output(
            ["python3", "/app/cuda_check.py"],
            timeout=15,
        ).decode("utf-8", errors="replace").strip()
        return out
    except Exception as e:
        return f"CUDA_SMOKE_FAIL: {e}"


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------

class GpuTestHandler(BaseHTTPRequestHandler):

    def _ok(self, body, content_type="application/json"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body.encode("utf-8") if isinstance(body, str) else body)

    def _err(self, code, msg):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(msg.encode("utf-8"))

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"

        # ---- /health ----
        if path == "/health":
            gpus = run_nvidia_smi()
            if not gpus:
                self._err(503, "NO_GPU")
                return

            cuda_smoke = run_cuda_smoke()

            resp = {
                "status": "ok",
                "gpus": gpus,
                "cuda_smoke": cuda_smoke,
            }
            self._ok(json.dumps(resp))

        # ---- /system_stats (ComfyUI-compatible shape) ----
        elif path == "/system_stats":
            gpus = run_nvidia_smi()
            devices = []
            if gpus:
                for g in gpus:
                    devices.append({
                        "type": "cuda",
                        "name": g["name"],
                        "vram_total": g["vram_total_mb"],
                        "vram_free": g["vram_total_mb"],     # best-effort — no PyTorch
                        "driver": g.get("driver_version", ""),
                    })

            resp = {
                "system": {
                    "devices": devices,
                    "os": sys.platform,
                    "python_version": sys.version,
                }
            }
            self._ok(json.dumps(resp))

        # ---- / (root) ----
        elif path == "/":
            gpus = run_nvidia_smi()
            status = "GPU_OK" if gpus else "NO_GPU"
            self._ok(f"gpuvietnam-gpu-test: {status}\n", "text/plain")

        else:
            self._err(404, "Not Found")

    def log_message(self, format, *args):
        """Suppress default stderr logging; write to stdout for container logs."""
        sys.stdout.write(f"[gpu-test] {args[0]}\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), GpuTestHandler)
    print(f"[gpu-test] Listening on {HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
