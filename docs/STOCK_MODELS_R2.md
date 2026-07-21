# Stock models on R2 (Solution A)

Containers download checkpoints via **app redirect → R2 presigned GET** (no R2 secrets in the image).

## R2 key layout

```
stock/models/checkpoints/sd_xl_base_1.0.safetensors
stock/models/checkpoints/RealVisXL_V6.0_B1.safetensors
stock/models/upscale_models/RealESRGAN_x4plus.pth
```

## One-time setup

1. Upload files (script downloads from HF/GitHub if needed, multipart for >5GB):

```bash
node scripts/sync-stock-models-to-r2.mjs
# or from an existing folder:
node scripts/upload-stock-models-to-r2.mjs --dir ./local-models
```

2. **Do not** make the whole bucket public. Containers fetch via app:

`GET {GPUVIETNAM_PUBLIC_API_URL}/api/storage/stock/models/{relative}`  
→ 302 to short-lived R2 presigned GET (allowlist only).

Optional: set `R2_PUBLIC_BASE_URL` / `GPUVIETNAM_MODELS_BASE_URL` if you prefer a public CDN for `stock/models/` only.

3. Set on the **app** (`.env.local` / production):

```bash
# Required for remote GPU containers to reach the redirect API
GPUVIETNAM_PUBLIC_API_URL=https://your-domain.com
```

App injects `GPUVIETNAM_MODELS_BASE_URL` automatically (`…/api/storage/stock/models`).

4. Rebuild/push ComfyUI image so `download-models.sh` prefers R2/API.

## Boot behaviour

`scripts/download-models.sh`:

1. Try `{MODELS_BASE}/{relative}`
2. If miss and `GPUVIETNAM_MODELS_FALLBACK=1` (default): HuggingFace / CivitAI / GitHub
3. Skip if file already on disk

## Notes

- Backup objects stay under `users/{userId}/…` (private).
- Stock models are shared read-only assets — separate from user backup quota.