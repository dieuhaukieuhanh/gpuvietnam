# ComfyUI brand reverse proxy (Level C)

Hides Clore/Vast upstream hostnames behind `work.gpuvietnam.com`.

### Clore vs Vast (Worker fetch)

| | Clore | Vast |
|---|---|---|
| Upstream shape | `https://*.clorecloud.net` (hostname) | `http://IP:HostPort` |
| CF Worker `fetch` | OK | **Fails with 1003** (no literal IP subrequests) |
| Fix | none | rewrite IPv4 → `http://{dashed-ip}.sslip.io:{port}` at Worker (and mint) |

Same brand URL for both; only the Worker→GPU hop differs. Override suffix with `COMFY_IP_LITERAL_HOP_SUFFIX` (Worker `[vars]` + app env); `off` disables.

## Feature flag (rollback)

Default **OFF**. Enable only after Worker + DNS are live:

```
COMFY_PROXY_ENABLED=1
COMFY_PROXY_BASE_URL=https://work.gpuvietnam.com
COMFY_PROXY_SECRET=<long random secret>
```

### Cloudflare KV mirror (required while Next has no stable public host)

Worker resolves tokens from KV first, then falls back to origin. Apex `gpuvietnam.com` is currently **WordPress** — it does **not** serve `/api/internal/comfy-proxy-resolve`. Until the Next app has a stable public URL, set KV env so mint writes the token to the edge:

```
CF_ACCOUNT_ID=<cloudflare account id>
CF_KV_NAMESPACE_ID=<COMFY_ACCESS namespace id>
CF_API_TOKEN=<API token with Account → Workers KV Storage → Edit>
# alias also accepted: CLOUDFLARE_API_TOKEN
```

Create the token: Cloudflare Dashboard → My Profile → API Tokens → Create Token →
custom token with **Workers KV Storage:Edit** on the account that owns namespace `COMFY_ACCESS`.

Put the same three vars on the Next host (local `.env.local` and production env).

When proxy is disabled, dashboard opens upstream `comfyUrl` directly (previous behavior).

## Deploy Worker

```bash
cd workers/comfy-proxy
npm install
npx wrangler login
npx wrangler kv namespace create COMFY_ACCESS
# put id into wrangler.toml [[kv_namespaces]]
npx wrangler secret put COMFY_PROXY_SECRET   # same as app COMFY_PROXY_SECRET
# ORIGIN_RESOLVE_URL in wrangler.toml [vars]:
#   After apex cut-over: https://gpuvietnam.com/api/internal/comfy-proxy-resolve
#   Before cut-over / staging: https://app.gpuvietnam.com/api/internal/comfy-proxy-resolve
#   Empty = KV-only resolve (safe while apex is still WordPress).
npx wrangler deploy
```

See also [APEX_NEXT_CUTOVER.md](./APEX_NEXT_CUTOVER.md).

DNS: CNAME `work` → workers.dev route, or Workers route `work.gpuvietnam.com/*`.

## Align mint vs resolve

| App that mints token | How Worker resolves | Result |
|---|---|---|
| Local/prod Next with `CF_API_TOKEN` | KV hit | OK |
| Next public host = `ORIGIN_RESOLVE_URL` + matching secret | Origin fallback | OK |
| Local mint, no KV, origin = WordPress/dead tunnel | miss | **401** |

## DB

```bash
npm run db:migrate
# applies 0040 supabase/comfy-access-tokens.sql
```

## How it works

1. Dashboard POST `/api/session/comfy-access` → brand `workUrl` (+ CP bootstrap hash) (upstream never returned)
2. App mirrors token hash → Cloudflare KV (if `CF_*` configured)
3. Browser opens `https://work.gpuvietnam.com/enter/{token}`
4. Worker sets HttpOnly cookie, redirects to `/#gvn_cp=…` (extension bootstrap)
5. All `/` and `/ws` traffic proxied to upstream; address bar stays on brand domain
6. Extension sync: `/gpuvietnam/cp/sync` → origin `/api/cp/comfy-sync` (Bearer `gvc.*`)
7. Stop/destroy revokes tokens

Cookie routing (not `/s/:token` path prefix) is required so ComfyUI absolute paths (`/ws`, `/api/...`) keep working.

## Smoke

```bash
curl -sS https://work.gpuvietnam.com/health
# expect: ok

# After minting from dashboard (with CF_API_TOKEN set), open workUrl —
# expect 302 from /enter/... then ComfyUI on work.gpuvietnam.com (not 401).
```
