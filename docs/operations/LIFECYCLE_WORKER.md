# GPUVietnam P0-A — Always-on Lifecycle Worker (VPS Linux)

| | |
|---|---|
| **Status** | Code + unit tests ready · **P0-A CLOSED chỉ khi acceptance smoke PASS** |
| **Host** | VPS nhỏ Linux always-on (`systemd`) |
| **Related** | [GO_LIVE_READINESS_AUDIT.md](./GO_LIVE_READINESS_AUDIT.md) P0-A |
| **Smoke** | `node scripts/p0a-lifecycle-smoke.mjs` |

---

## Topology

```text
Vercel Next (API) → enqueue user_start_provision → Supabase machine_operations
        ↓
VPS lifecycle-worker claims / executes / reconciles
        ↓
Clore / Vast
```

**Không** còn `accepted → void completeUserStartProvision()` trên serverless.

---

## Prerequisites

1. Apply migration **0049** — `supabase/p0a-user-start-provision-op.sql`  
   - Prefer Supabase SQL Editor (paste file) nếu `SUPABASE_DB_URL` / `npm run db:migrate -- --only 0049` không connect từ máy local.  
   - **Không** chạy full migrate trên DB đã có sẵn nếu `schema_migrations` trống — runner sẽ cố apply lại `schema.sql`.
2. Clone/deploy repo trên VPS; Node.js 20+.
3. Copy production secrets vào `/etc/gpuvietnam/lifecycle.env` (không commit):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLORE_API_KEY` / Vast keys nếu dùng
   - Các env provision/image giống Next prod (`GPUVIETNAM_COMFYUI_IMAGE_V3`, …)
4. Deploy API enqueue path (`start-machine` trả `operationId`) lên apex.

---

## Write-path audit (`ProtectSystem=strict`)

Worker **chỉ** cần ghi:

| Path (cwd = `/opt/gpuvietnam`) | Source |
|--------------------------------|--------|
| `logs/` | `src/lib/logging` file channels |
| `tmp/host-reputation.json` | host-reputation store |
| `tmp/clore-bad-hosts.json` | Clore bad-host exclusion |
| `tmp/vast-bad-hosts.json` | Vast bad-host exclusion |
| `tmp/provision-progress.json` | provision progress store |
| `/tmp` (PrivateTmp) | OS temp only |

**Không** dùng npm cache lúc runtime. Unit hiện tại đủ với:

```text
ReadWritePaths=/opt/gpuvietnam/logs /opt/gpuvietnam/tmp
PrivateTmp=true
HOME=/opt/gpuvietnam/tmp
XDG_CACHE_HOME=/opt/gpuvietnam/tmp/cache
```

Nếu journal có `EACCES` / `EROFS` ngoài `logs|tmp` → mở rộng `ReadWritePaths` có chủ đích (đừng nới `/opt/gpuvietnam` cả cây).

---

## Run manually (smoke)

```bash
cd /opt/gpuvietnam
set -a && source /etc/gpuvietnam/lifecycle.env && set +a
node --import ./scripts/register-src-alias.mjs scripts/lifecycle-worker.mjs
```

Expect log: `P0-A lifecycle worker ready`.

Schema / watch:

```bash
node scripts/p0a-lifecycle-smoke.mjs
# after start-machine returns operationId:
node scripts/p0a-lifecycle-smoke.mjs --watch <operationId>
```

---

## systemd unit

File: `deploy/systemd/gpuvietnam-lifecycle-worker.service` (copy to `/etc/systemd/system/`).

```bash
sudo mkdir -p /opt/gpuvietnam/logs /opt/gpuvietnam/tmp
sudo chown -R gpuvietnam:gpuvietnam /opt/gpuvietnam/logs /opt/gpuvietnam/tmp
sudo systemctl daemon-reload
sudo systemctl enable --now gpuvietnam-lifecycle-worker
sudo journalctl -u gpuvietnam-lifecycle-worker -f
```

---

## What the process runs

| Loop | Source |
|------|--------|
| machine_operations drain (30s + kick) | `startMachineOperationBackgroundWorker` |
| Clore orphan reconcile | `startCloreOrphanReconciliation` |
| Vast host-intel orphan reconcile | `startVastHostIntelOrphanReconciliation` (label `gpuvietnam-host-intel` only) |
| Infrastructure reconcile + settlement retry | `executeReconciliation({ repair: true })` every `LIFECYCLE_RECONCILE_INTERVAL_MS` (default 15m) |

---

## start-machine contract (after P0-A)

```text
POST /api/user/start-machine
  → claim subscription lease
  → enqueue user_start_provision (durable)
  → 200 { accepted: true, operationId }
```

Nếu enqueue fail → **503** `PROVISION_ENQUEUE_FAILED` (không pretend accepted).

Frontend tiếp tục poll machine / progress như hiện tại.

---

## P0-A acceptance gate (đóng P0-A chỉ khi PASS)

Chuỗi cần chứng minh trên production:

```text
POST start-machine
  → operationId
  → machine_operations = pending
  → Worker claim
  → lease_until + heartbeat
  → Clore order
  → machine row
  → Comfy Runtime ready
  → operation = completed
```

| Gate | Kết quả cần có |
|------|----------------|
| Schema | Migration 0049 applied |
| Enqueue | `start-machine` trả `operationId` |
| Durable | Row tồn tại sau khi request kết thúc |
| Worker | VPS claim được operation |
| Lease | `lease_until` + heartbeat hoạt động |
| Recovery | Kill worker → lease hết hạn → worker reclaim |
| Provision | GPU thật được cấp |
| Completion | Machine `running` + operation `completed` |
| Restart | `systemctl restart` không làm mất operation |
| Orphan | Worker reconcile được order/machine lệch trạng thái |
| Service | systemd tự restart khi process chết |

**Unit tests** = code sẵn sàng; **không** thay acceptance smoke.

### Concurrency / marketplace guards (cùng P0-A hardening)

| Rule | Hành vi |
|------|---------|
| Single start | 1 `user_start_provision` open slot / user; bấm Start lại → dedupe |
| Cancel start | Hủy op (kể cả `running`) + giải phóng slot + destroy machine leftovers |
| Dual-run | Tối đa **2 GPU** qua `/api/cp/dual-run` (không qua `start-machine`) |
| Vast | Reject storage-only (`num_gpus`/`vram`/`gpu_frac`); search `gpu_frac=1` |

Sau khi bảng acceptance PASS → chuyển **P0-B — T11 billing proof**.

---

## Terminal states

| machine_operations.state | Ý nghĩa |
|-------------------------|----------|
| `pending` / `leased` / `running` / `retry_scheduled` | RETRYING / in progress |
| `completed` | SUCCESS |
| `dead_letter` / `failed` | TERMINAL_FAILURE |

---

## Rollback

Tạm thời: dừng worker + **không** revert API nếu đã deploy enqueue (start sẽ 503 khi không có worker drain).  
Muốn rollback API: revert `start-machine.js` sang void background (không khuyến nghị).

---

## Out of scope (P0-A)

Ticket C · dual-run · warm pool · alerting webhook (P0-C) · billing E2E T11 (P0-B)
