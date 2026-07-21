"""GPUVietnam — HTTP L2 backup flush on Comfy PromptServer (same path as L1 presign)."""

from __future__ import annotations

import asyncio
import os
import secrets

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

FLUSH_PATH = "/gpuvietnam/backup/flush"
FLUSH_SCRIPT = os.environ.get("GPUVIETNAM_BACKUP_ONCE_SCRIPT", "/app/periodic-backup.sh")
FLUSH_TIMEOUT_SEC = int(os.environ.get("GPUVIETNAM_BACKUP_FLUSH_TIMEOUT_SEC") or "600")


def _authorized(request) -> bool:
    expected = (os.environ.get("GPUVIETNAM_BACKUP_FLUSH_SECRET") or "").strip()
    if not expected:
        return False
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return False
    got = auth[7:].strip()
    return bool(got) and secrets.compare_digest(got, expected)


def _register_routes() -> None:
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception as exc:  # pragma: no cover
        print(f"[gpuvietnam_backup] PromptServer unavailable: {exc}", flush=True)
        return

    routes = PromptServer.instance.routes

    @routes.post(FLUSH_PATH)
    async def backup_flush(request):
        if not _authorized(request):
            return web.json_response({"ok": False, "error": "unauthorized"}, status=401)

        if not os.path.isfile(FLUSH_SCRIPT) or not os.access(FLUSH_SCRIPT, os.X_OK):
            return web.json_response(
                {"ok": False, "error": f"flush script missing: {FLUSH_SCRIPT}"},
                status=503,
            )

        try:
            proc = await asyncio.create_subprocess_exec(
                FLUSH_SCRIPT,
                "--once",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=FLUSH_TIMEOUT_SEC
            )
        except asyncio.TimeoutError:
            return web.json_response(
                {"ok": False, "error": f"flush timed out after {FLUSH_TIMEOUT_SEC}s"},
                status=504,
            )
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=500)

        stdout = (stdout_b or b"").decode("utf-8", errors="replace")[-6000:]
        stderr = (stderr_b or b"").decode("utf-8", errors="replace")[-3000:]
        ok = proc.returncode == 0
        return web.json_response(
            {
                "ok": ok,
                "code": proc.returncode,
                "stdout": stdout,
                "stderr": stderr,
            },
            status=200 if ok else 500,
        )

    print(f"[gpuvietnam_backup] registered POST {FLUSH_PATH}", flush=True)


_register_routes()