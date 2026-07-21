# Backup runbook — periodic + stop (A–D)

## Architecture (quick)

| Layer | When | How | Auth |
|-------|------|-----|------|
| **Periodic** | Machine running | Container `periodic-backup.sh` → presign → R2 PUT | `GPUVIETNAM_BACKUP_TOKEN` (scoped) |
| **Stop-backup** | Before destroy | App SSH → tar.gz → R2 + `backup_logs` | Server R2 keys (never in container) |
| **Catalog** | After upload / stop | `backup-report` + R2 reconcile → `storage_files` | Token / service role |

Container **must not** have `R2_SECRET_ACCESS_KEY` / access key.

## Env (app / `.env.local`)

| Var | Purpose |
|-----|---------|
| `GPUVIETNAM_PUBLIC_API_URL` | Public URL containers can reach (not useless localhost for remote GPU) |
| `R2_*` | Server-only credentials for stop-backup + presign signing |
| `GPUVIETNAM_COMFYUI_IMAGE` | Image tag with `periodic-backup.sh` (build after this work) |
| `CLORE_SSH_PASSWORD` / `VAST_SSH_PRIVATE_KEY` | Stop-backup SSH |

## Env (container — injected at rent)

| Var | Purpose |
|-----|---------|
| `GPUVIETNAM_BACKUP_TOKEN` | Opaque `gvb.` token |
| `GPUVIETNAM_PRESIGN_URL` | `…/api/storage/presign-upload` |
| `GPUVIETNAM_BACKUP_REPORT_URL` | `…/api/storage/backup-report` |
| `GPUVIETNAM_BACKUP_SKIP_MODELS` | `1` when backup quota already full |
| `GPUVIETNAM_PERIODIC_BACKUP` | Set `0` to disable periodic loop |

## D12 — Automated tests (dev)

```bash
node --test src/lib/machine-backup-token.test.mjs src/lib/machine-backup-token-db.test.mjs src/lib/backup-quota.test.mjs src/lib/backup-presign-rate-limit.test.mjs src/lib/backup-reconcile.test.mjs src/lib/backup-container-env.test.mjs
```

Covers: path allowlist/traversal, forged/expired/revoked token, quota (models blocked when over), rate limit, reconcile upsert, no R2 secrets in container env inject.

## D13 — New machine (after image build/push)

1. Apply migration `0039` (`machine-backup-tokens.sql`) if not yet.
2. Set `GPUVIETNAM_PUBLIC_API_URL` to a URL reachable from Clore/Vast.
3. Build & push image with `scripts/periodic-backup.sh`; set `GPUVIETNAM_COMFYUI_IMAGE`.
4. Start a machine → within ~5–10 minutes:
   - R2 has `users/{userId}/outputs/…` (and workflows if changed).
   - Logs show `[PeriodicBackup]`.
5. Confirm container env has **no** `R2_SECRET*` (provider panel / debug).

## D14 — Stop machine

1. Stop from dashboard.
2. `machine_backup_tokens.revoked_at` set for that machine/subscription.
3. Presign with old token → `401`.
4. `backup_logs` row created; stop-backup still attempted via SSH.
5. Backup panel / `storage_files` updated (report + reconcile).

## D15 — Crash simulation

1. While machine running, ensure periodic uploaded at least one output to R2.
2. Force-kill instance at provider (or power-off) **without** clean stop-backup.
3. Objects from periodic remain under `users/{userId}/…`.
4. Optional: reconcile on next stop for same user (lists R2 → `storage_files`).

## D16 — Operations

### Disable periodic (without rebuild)

- Provider/container env override: `GPUVIETNAM_PERIODIC_BACKUP=0`.
- Or skip injecting backup token (no `GPUVIETNAM_PUBLIC_API_URL`) — script idles.

### Rotate backup token

1. Stop machine (revokes tokens) → start again (issues new token).
2. Or revoke rows in `machine_backup_tokens` and restart.

### Monitor

- App logs: `[storage/presign-upload]`, `[storage/backup-report]`, `[machine-backup]`, `[destroy-pipeline] revoke backup tokens`.
- Container logs: `[PeriodicBackup] ERROR:`.
- HTTP `429` + `Retry-After` = rate limit (default 60 req/min per token hash).
- Quota: over limit → models rejected; outputs/workflows still allowed.

### Quota soft skip

If `backup_plan_gb` already full at start, app sets `GPUVIETNAM_BACKUP_SKIP_MODELS=1`. Presign still enforces models rejection when over.

## Ship order reminder

1. Migrate DB `0039`
2. Deploy app (presign + report + token issue/revoke)
3. Build/push ComfyUI image
4. Point `GPUVIETNAM_COMFYUI_IMAGE` + public API URL
5. Run D13–D15 on one test account

**Official Image v1.0:** see `docs/COMFYUI_IMAGE.md` + `image/official-nodes.lock`.  
**Smart Restore Level 1:** see `docs/SMART_RESTORE.md` (workflows / settings / outputs).  
Periodic prefixes: `outputs` · `workflows` · `settings` · `models` (incremental).

## Backup entitlement + retention (B/C)

| Rule | Value |
|------|-------|
| Starter | 10 GB, retain 30 days after no hours |
| Pro | 100 GB, retain 90 days |
| Studio | 200 GB, retain 120 days |
| Multi-plan | **max** tier (no sum) |
| Upgrade pack | `limit = max(planGb, backup_upgrade_gb)` |
| States | `active` → `grace` → `deleted` |

Sync runs after `syncUserPlanInventory`, successful settlement, and storage-upgrade apply.

Cron: `GET/POST /api/cron/backup-retention` (daily `15 3 * * *`) — sync grace clocks then purge past `backup_purge_after` (R2 prefix + `storage_files`).

Apply migration `0041` (`supabase/backup-entitlement-retention.sql`) before relying on new columns.

## Auto-backup policy (plan + Admin)

| Layer | Default / control |
|-------|-------------------|
| Plan default | Starter **off** · Pro/Studio **on** |
| Global Starter campaign | Admin → Giá bộ nhớ → “Auto backup — Starter” (`backup_auto_policy`, windowed) |
| Per-user override | Admin → Khách hàng → expand → `force_on` / `force_off` / theo chính sách |

`enabled = userOverride ?? (starter ? globalStarterWindow : planDefault)`

- **Start:** only injects backup token / flush secret when enabled.
- **Stop L2:** skips backup (log `skipped`) when disabled; takes effect on that stop.
- Running machines keep existing L1 until stop → start again.

Migration: `supabase/backup-auto-policy.sql`. APIs: `GET/PUT /api/admin/backup-auto-policy`, `GET/PUT /api/admin/customers/auto-backup`.

Tests: `node --test src/lib/backup-auto-policy.test.mjs`

## L2 HTTP flush (Clore)

Stop-backup prefers **HTTP** `POST {comfyUrl}/gpuvietnam/backup/flush` (custom node) which runs `periodic-backup.sh --once` — same L1 presign path. Auth: `Authorization: Bearer {machines.backup_flush_secret}`.

Requires image with `gpuvietnam_backup` custom node + migration `0042`. Falls back to SSH if HTTP fails.
