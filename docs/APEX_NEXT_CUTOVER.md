# Apex cut-over: WordPress → Next (`gpuvietnam.com`)

Kiến trúc app không đổi. Chỉ đổi host apex + env public URL + Worker origin fallback.

## Blockers đã gặp (API)

- Token Cloudflare hiện tại: đọc zone OK, **không** sửa DNS (403).
- Chưa có `VERCEL_TOKEN` / Vercel CLI login trên máy deploy.

Cần làm tay trên dashboard (hoặc cấp token đủ quyền), rồi chạy lại smoke.

## Vercel plan note

Team đang **Hobby**: Vercel chặn cron dày hơn 1 lần/ngày. `vercel.json` giữ `crons: []` để deploy được.
Khi upgrade **Pro**, copy lại lịch từ [`vercel.crons.pro.json`](../vercel.crons.pro.json) vào `vercel.json`.

## Phase 1 — Staging (đã làm một phần)

- Project: `gpuvietnam/gpuvietnam` trên Vercel.
- Production live: https://gpuvietnam.vercel.app (homepage/login OK).
- Domains đã add trên Vercel: `app.gpuvietnam.com`, `gpuvietnam.com`, `www`.
- Env đã sync; Worker `ORIGIN_RESOLVE_URL` trỏ `gpuvietnam.vercel.app`.
- Cron Pro: xem `vercel.crons.pro.json` (Hobby = `crons: []`).

### DNS còn thiếu (Cloudflare)

Domain Connect (duyệt & Apply trên Cloudflare):

- app: https://vercel.com/api/v9/projects/prj_WA01z2BaUymn9o76QW6RFyLI00GT/domains/app.gpuvietnam.com/domain-connect/apply?teamId=team_UmfhZIY01kjCL43Aw0yfmgLz
- apex: https://vercel.com/api/v9/projects/prj_WA01z2BaUymn9o76QW6RFyLI00GT/domains/gpuvietnam.com/domain-connect/apply?teamId=team_UmfhZIY01kjCL43Aw0yfmgLz

Hoặc tay:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `app` | `76.76.21.21` | DNS only |
| A | `@` | `76.76.21.21` | DNS only (cắt WP) |
| CNAME | `www` | `cname.vercel-dns.com` | DNS only |

Sau DNS: `npx vercel domains verify app.gpuvietnam.com --scope gpuvietnam` rồi smoke `https://app.gpuvietnam.com`.

## Phase 2 — Redirect map (đã có trong repo)

`next.config.mjs` redirects:

| Cũ (WP) | Mới (Next) |
|---|---|
| `/wp-admin`, `/wp-login.php` | `/login` |
| `/feed` | `/` |
| `/dieu-khoan` | `/dieu-khoan-dich-vu` |
| `/chinh-sach` | `/chinh-sach-bao-mat` |

Next đã có: `/`, `/login`, `/register`, `/bang-gia`, `/dashboard`, checkout, payment, legal.

## Phase 3 — Cut-over apex

1. Hạ TTL DNS apex/`www` trước (nếu có thể).
2. Cloudflare DNS:
   - Apex: theo hướng dẫn Vercel (A/`ALIAS` hoặc CNAME flattened).
   - `www` → apex hoặc Vercel.
3. Vercel → add `gpuvietnam.com` + `www`.
4. Vercel env:
   - `NEXT_PUBLIC_APP_URL=https://gpuvietnam.com`
   - `NEXT_PUBLIC_SITE_URL=https://gpuvietnam.com`
   - `GPUVIETNAM_PUBLIC_API_URL=https://gpuvietnam.com`
5. Supabase Auth → Redirect URLs thêm `https://gpuvietnam.com/**` (và `www` nếu dùng).
6. Worker (`workers/comfy-proxy/wrangler.toml`):
   - `ORIGIN_RESOLVE_URL = "https://gpuvietnam.com/api/internal/comfy-proxy-resolve"`
   - `npx wrangler deploy` (secret đã sync).
7. Smoke:

```bash
npm run smoke:apex
```

Expect: homepage Next (`__NEXT_DATA__` hoặc `/_next/`), resolve API không trả HTML WP, `/health` trên `work.*` ok.

### Rollback

Đổi DNS apex về origin WordPress cũ (giữ host WP 48–72h).

## Phase 4 — Ổn định

- Monitor auth / provision / cron / Comfy 24–72h.
- Park WP hosting.
- 301 `app.` → apex (optional).
- Gỡ tunnel trycloudflare khỏi env prod.

## Quyền token khuyến nghị

- **Vercel:** token deploy (env `VERCEL_TOKEN`).
- **Cloudflare:** Zone.DNS Edit + Workers KV Edit (tách token KV prod khỏi OAuth wrangler).
