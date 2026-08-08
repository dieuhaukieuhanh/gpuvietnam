# P0-C — Minimal Alerting (email)

> Critical event → `opsAlert` → Resend → operator inbox.

## Channel (MVP)

| | |
|---|---|
| Channel | **Email** (Resend) |
| To | `OPS_ALERT_EMAIL` (default `dieuhaukieuhanh@gmail.com`) |
| From | `GPUVietnam <notify@gpuvietnam.com>` |

Discord/Slack webhook có thể thêm sau; hiện tại chỉ email.

## 5 events

| Event | Trigger |
|-------|---------|
| `provision_timeout` | Start provision FAIL (timeout / no workstation / rent failed) |
| `orphan_clore` | Clore orphan order detected |
| `orphan_host_intel` | Host-intel probe destroy/cleanup failed (or sweeper destroy fail) |
| `settlement_failed` | Settlement RPC fail |
| `machine_op_stuck` | Self-heal recovers stale leased/running ops |
| `recovery_exhausted` | Machine operation → `dead_letter` |

## Env

| Var | Default | Note |
|-----|---------|------|
| `RESEND_API_KEY` | — | **Bắt buộc** để gửi |
| `OPS_ALERT_EMAIL` | `dieuhaukieuhanh@gmail.com` | Inbox ops |
| `OPS_ALERT_ENABLED` | `true` | `false` = tắt |
| `OPS_ALERT_DEDUP_MS` | `900000` (15 phút) | Chống spam cùng key |

Cần có trên:

- Vercel Production (settle path API)
- VPS `/etc/gpuvietnam/lifecycle.env` (worker: dead_letter, self-heal, orphan, provision)

## Code

- Dispatcher: `src/lib/ops/alert-dispatcher.js`
- Smoke: `node scripts/ops-alert-smoke.mjs`

## Smoke

```bash
node scripts/ops-alert-smoke.mjs
```

Kiểm tra inbox (và spam) của `OPS_ALERT_EMAIL`.
