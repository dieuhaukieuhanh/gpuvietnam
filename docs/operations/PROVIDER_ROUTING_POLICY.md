# Provider routing policy (Admin Hạ tầng)

## Mục tiêu

Một chỗ bật/tắt + xếp thứ tự Vast / Clore / Salad. Áp dụng cho **thuê máy mới** (Start), không cắt phiên đang chạy.

## SoT

| Layer | Path |
|-------|------|
| DB | `public.provider_routing_policy` (id=1) — migration `0056` |
| Fallback file | `tmp/provider-routing-policy.json` |
| Admin UI | Tab **Hạ tầng** → panel *Provider routing* |
| API | `GET/PUT /api/admin/provider-routing-policy` |
| Code | `resolveProviderAttemptOrder` / `resolveProviderAttemptOrderAsync` |

Cache ~5s (`PROVIDER_ROUTING_POLICY_CACHE_MS`). Mỗi lần Start gọi `loadProviderRoutingPolicyAsync` trước khi rent.

## Phạm vi

| Việc | Có áp dụng? |
|------|-------------|
| Start phiên mới | Có |
| KH đang `running` | **Không** |
| Stop / settle | Không đổi provider |
| Env `GPU_VAST_ONLY` / `GPU_CLORE_ONLY` / `GPU_SALAD_ONLY` | Ghi đè khẩn cấp |

## GPU

Clore + Vast: 3090 / 4090 / **5090** (`CLORE_SUPPORTED_GPU_LINES`).

## Default

`vast=true`, `clore=false`, `salad=false`, priority `vast → clore → salad`.

## Prod status (2026-08-09)

| Layer | Status |
|-------|--------|
| Migration `0056` | ✅ applied (Supabase prod) |
| Vercel | ✅ Ready (`gpuvietnam.com`, commit `dbfe602`) |
| VPS worker | ✅ loads policy from Supabase; unit **không** pin `GPU_VAST_ONLY` (giữ `GPU_ALLOW_VAST=true`) |
| Admin UI | ✅ Tab Hạ tầng → *Provider routing* |
