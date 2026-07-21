# AI Debugging Guide (GPUVietnam)

This document tells Cursor, ChatGPT, and other AI assistants how to debug this project **from log files** â€” without asking the user to paste terminal output.

## Golden rule

1. Ask the user for the **Support Code** (`REQ-XXXXXXXX`) or full **requestId** (UUID).
2. Run `npm run logs:trace -- <code-or-id>`.
3. Read the ordered JSON timeline. Do **not** ask the user to scroll the terminal.

If the user has no Support Code, ask them to reproduce once and copy the code from the dashboard error UI.

---

## How Cursor should debug

1. Confirm the symptom (e.g. "Má»Ÿ phiĂªn lĂ m viá»‡c" failed).
2. Collect `requestId` / Support Code from the user or from the latest `logs/api.log` / `logs/error.log` lines.
3. Run:
   ```bash
   npm run logs:trace -- REQ-XXXXXXXX
   # or
   npm run logs:trace -- <full-uuid>
   ```
4. Open matching channel files if needed:
   - `logs/error.log` first for failures
   - `logs/api.log` for request lifecycle
   - `logs/provider.log` for Clore/Vast
   - `logs/worker.log` for queue/SCB ops
   - `logs/app.log` for boot / SCB transitions
5. Reconstruct the timeline by `time` + `phase` (`START` â†’ `SUCCESS`/`FAILURE`).
6. Fix code based on `err.message`, `err.stack`, `err.cause`, and provider fields (`offerId`, `httpStatus`, `providerLatencyMs`, â€¦).
7. Re-run the failing unit tests related to the change.

## How ChatGPT (or any external AI) should debug

When the user pastes logs or a Support Code:

1. Treat Support Code `REQ-A1B2C3D4` as a search key for the first 8 hex chars of the UUID.
2. Prefer structured JSON fields over prose.
3. Identify the first `phase:"FAILURE"` line â€” that is usually the root cause boundary.
4. Walk backward to the last successful `provider.attempt` / `scb.transition`.
5. Propose a concrete fix + a verification command (`npm run logs:trace`, targeted `node --test â€¦`).

If the user can run commands locally, ask them to paste **only** the output of `npm run logs:trace -- <id>` (not the whole terminal session).

---

## Which log files to inspect first

| Priority | File | When |
|----------|------|------|
| 1 | `logs/error.log` | Any failure, crash, unhandled rejection |
| 2 | `logs/api.log` | User actions (`start-machine`, status, stop) |
| 3 | `logs/provider.log` | Rent / offer / failover issues |
| 4 | `logs/app.log` | SCB transitions, boot diagnostics |
| 5 | `logs/worker.log` | Queue, projection verify, drift repair |

Rotated archives appear as timestamped/gzipped siblings under `logs/` (size 50M / daily by default).

---

## How to trace a Request ID

```bash
npm run logs:trace -- 550e8400-e29b-41d4-a716-446655440000
npm run logs:trace -- REQ-550E8400
```

Customer UI shows `REQ-XXXXXXXX` (first 8 hex of the UUID). **Copy** stores the full UUID for exact tracing.

API responses include:

```json
{
  "error": "â€¦",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "supportCode": "REQ-550E8400"
}
```

Headers: `x-request-id`, `x-correlation-id`, `x-support-code`.

---

## Common debugging workflow ("Má»Ÿ phiĂªn lĂ m viá»‡c")

1. User clicks start â†’ `POST /api/user/start-machine`.
2. Expect in `api.log`:
   - `user.startMachine START`
   - `user.startProvision START` (background)
3. Expect in `provider.log`:
   - `provider.failover START`
   - `provider.attempt` for `clore` then maybe `vast`
   - `clore.createInstance` / `vast.createInstance` with `offerId`, `instanceId`, `region`, â€¦
4. On failure: `phase:"FAILURE"` + `err` in `api.log` and mirrored in `error.log`.
5. Check `app.log` for `scb.transition` (`stateBefore` â†’ `stateAfter`) to see if subscription/machine state stuck in `provisioning`.

---

## Typical root causes

| Signal in logs | Likely cause |
|----------------|--------------|
| `provider=clore` + currency / wallet errors | Clore wallet / allowed coins |
| `no matching offer` / `No Available Workstation` | Marketplace stock / filters too strict |
| `vast` + bad host / provision gate | Vast host quality / sanity gates |
| `IGNORED` / reclaim race in start-machine | Concurrent start / stale provisioning claim |
| `scb.transition` stuck provisioning | Persist/claim failure after rent |
| `unhandledRejection` in `error.log` | Missing await / fire-and-forget bug |
| Missing `requestId` on provider lines | Background work not wrapped in `withBackgroundLogContext` |

---

## Best practices for collecting logs

- Prefer `npm run logs:trace` output over screenshots.
- Include Support Code + approximate time (UTC in log `time` field).
- Do **not** paste `.env`, Authorization headers, or cookies (logger redacts these; keep it that way).
- After a fix, reproduce once and confirm a `SUCCESS` timeline for a new requestId.
- For long sessions, check rotated files if the active `*.log` was truncated by rotation.

---

## Logging architecture (short)

See `LOGGING.md` for full details.

- Channels: `app` / `api` / `worker` / `provider` / `error`
- Context via AsyncLocalStorage: `requestId`, `userId`, `machineId`, `gpuSessionId`, `operation`
- Secrets redacted; large/base64 payloads truncated
- Async rotating file sinks (`rotating-file-stream`)
- SCB transitions log `stateBefore` / `stateAfter` / versions when present

---

## Commands cheat sheet

```bash
npm run dev                 # ensures logs/ + starts Next
npm run logs:trace -- <id>  # full request timeline
node --test src/lib/logging/logger.test.mjs
node --test src/lib/gpu/providers/clore/clore-orphan-reconcile.test.mjs
node --test src/lib/provision-lease.test.mjs
```
---

## Provision Lease & Heartbeat

Provisioning claims no longer expire on a fixed 3-minute wall clock. They use a **lease + heartbeat** model so long Clore rents (marketplace retries, rate limits, order_id recovery, image pull, Comfy health) stay protected while progress continues.

### Lease lifecycle

1. **LEASE_CREATED** — `claimSubscriptionForProvision` (offline -> provisioning) writes:
   - `provisioning_lease_id`
   - `provisioning_lease_expires_at` (now + `PROVISION_LEASE_MS`, default 90s)
   - `provisioning_heartbeat_at`
   - `provisioning_lease_owner` (worker pid/host/token)
   - `provisioning_started_at` (audit start)
2. Background `completeUserStartProvision` starts auto-renew (`PROVISION_HEARTBEAT_MS`, default 25s) and heartbeats after meaningful steps.
3. **LEASE_HEARTBEAT / LEASE_EXTENDED** — atomic update only if `provisioning_lease_id` still matches (prevents dual owners).
4. **LEASE_RELEASED** — provision success / status leaves provisioning (lease fields cleared).
5. **LEASE_EXPIRED** — heartbeat lost ownership (another worker reclaimed).
6. **LEASE_RECOVERED** — `reclaimStaleProvisionClaim` wins only when lease expired (or legacy null-lease + old `started_at`).

### Heartbeat flow

Renew after: wallet check, marketplace fetch, offer selection, create_order, order_id recovery, rate-limit waits, machine insert, session create, status poll, health/Comfy ready, provider failover attempts, plus the 25s interval.

### Crash recovery

If the worker dies, heartbeats stop -> lease expires (~90s) -> next `start-machine` may **LEASE_RECOVERED** and start one new provision. No manual cleanup required.

### Expiration rules

Reclaim only when:

- `provisioning_lease_expires_at < now` (primary), or
- heartbeat idle > `PROVISION_MAX_IDLE_MS` (dual check), or
- legacy row with null lease columns and `provisioning_started_at` older than legacy stale window

Never reclaim while an owner is still heartbeating.

### Env

| Env | Default | Meaning |
|-----|---------|---------|
| `PROVISION_LEASE_MS` | `90000` | Lease TTL after create/heartbeat |
| `PROVISION_HEARTBEAT_MS` | `25000` | Auto-renew interval |
| `PROVISION_MAX_IDLE_MS` | same as lease | Max idle since last heartbeat |

### Common failure scenarios

| Scenario | Behavior |
|----------|----------|
| Clore rent takes 5+ minutes with heartbeats | Lease stays valid; no duplicate reclaim |
| Worker crash mid-rent | Lease expires; reclaim starts one recovery provision; Clore orphan reconcile may cancel/reconnect unpaid orders |
| Two start-machine calls while lease fresh | Second waits (`alreadyStarting`) |
| Two reclaim races after expiry | CAS on expired lease — one wins |
| Heartbeat after reclaim stole lease | `LEASE_EXPIRED` / provision aborts with lease-lost error |

Logs: `operation:"provision.lease"` in `logs/api.log`. Metrics: `getProvisionLeaseMetrics()`.

## Recovering Clore Orphan Orders

Clore can charge for an order even when GPUVietnam never persisted a `machines` / `gpu_sessions` row (crash after `create_order`, missing `order_id`, DB insert failure, process restart).

### How to identify an orphan

1. Clore `GET /my_orders` shows a live order with our ComfyUI image (`*gpuvietnam*`).
2. No active DB machine (`creating` / `starting` / `running`) has `provider='clore'` and `instance_id = order_id`.
3. Logs in `logs/provider.log` with `operation:"clore.orphan"` and `event:"ORPHAN_DETECTED"`.

Manual check:

```bash
# After a failed start, compare Clore orders vs DB instance_ids
npm run logs:trace -- <requestId>
# Look for ORPHAN_DETECTED / ORPHAN_CANCEL_* / ORPHAN_RECONNECT_*
```

### How reconciliation works

On Node server boot (`src/instrumentation.js` -> `startCloreOrphanReconciliation`):

1. Query Clore `my_orders` (provider = source of truth).
2. Query active Clore machines + pending/running sessions from Supabase.
3. Match by `orderId` <-> `machines.instance_id` (serverId logged for diagnostics).
4. Unmatched GPUVietnam orders -> orphan candidates (`ORPHAN_DETECTED`).
5. **Grace period** (default 2 minutes, `CLORE_ORPHAN_GRACE_MS`) - do not cancel yet.
6. Recheck (`ORPHAN_RECHECK`):
   - If a fresh `subscriptions.server_status=provisioning` claim has no machine -> **reconnect** (insert machine + pending session).
   - Else if still unmatched -> **`cancel_order`** (`ORPHAN_CANCEL_STARTED` -> `SUCCESS`/`FAILED`).
7. Periodic interval (default 5 minutes, `CLORE_ORPHAN_RECONCILE_INTERVAL_MS`) repeats the pass.

**Safety - never cancel when:**

- Matched machine status is `running`
- Matched machine is `creating`/`starting` inside `PROVISIONING_BOOT_MAX_MS` (30 min)
- Ambiguous multiple fresh provisioning claims without a close timestamp match (wait again)

Env knobs:

| Env | Default | Meaning |
|-----|---------|---------|
| `CLORE_ORPHAN_RECONCILE` | `true` | Set `false` to disable |
| `CLORE_ORPHAN_GRACE_MS` | `120000` | Grace before cancel |
| `CLORE_ORPHAN_BOOT_DELAY_MS` | `15000` | Delay after boot before first pass |
| `CLORE_ORPHAN_RECONCILE_INTERVAL_MS` | `300000` | Periodic pass (`0` = boot-only) |

Missing `order_id` on `create_order` is recovered inline via `CloreClient.recoverOrderIdAfterCreate` (multi-attempt `my_orders` by `serverId`, logged as `ORDER_ID_RECOVERY_*`).

### Expected log sequence

**Cancel path (true orphan):**

```
ORPHAN_DETECTED -> (grace) -> ORPHAN_RECHECK -> ORPHAN_CANCEL_STARTED -> ORPHAN_CANCEL_SUCCESS
```

**Crash mid-provision (reconnect):**

```
ORPHAN_DETECTED -> ORPHAN_RECHECK -> ORPHAN_RECONNECT_STARTED -> ORPHAN_RECONNECT_SUCCESS
```

**create_order without order_id:**

```
ORDER_ID_RECOVERY_STARTED -> ORDER_ID_RECOVERY_ATTEMPT (n) -> ORDER_ID_RECOVERY_SUCCESS
```

Every orphan log includes: `requestId`, `provider`, `orderId`, `serverId`, `machineId`, `gpuSessionId`, `elapsedTime`, `recoveryAction`.

Metrics (in-process, `getCloreOrphanMetrics()`): `orphanDetected`, `orphanRecovered`, `orphanCancelled`, `orphanReconnectSuccess`, `orphanReconnectFailure`.

### Common failure scenarios

| Scenario | What happens |
|----------|----------------|
| Process dies after Clore rent, before DB insert | Startup reconcile detects orphan -> grace -> reconnect if claim still `provisioning`, else cancel |
| `create_order` returns `{code:0}` without id | Inline `my_orders` recovery by `serverId`; if still missing, later orphan cancel |
| User start still in flight during grace | Grace + provisioning-window protection avoids cancel; may reconnect |
| Manual / non-GPUVietnam Clore order | Ignored (image filter) |
| `cancel_order` succeeds but order still listed | `ORPHAN_CANCEL_FAILED` + `still_active_after_cancel` - investigate on Clore dashboard |
| Multiple users provisioning at once | Timestamp proximity matching; if ambiguous, wait (no blind cancel) |

## Host Reputation

Adaptive host quality memory for Clore + Vast offer selection. Not a permanent blacklist: scores recover over time and temporary exclusions expire automatically.

### When a host earns a success reward

A host is rewarded **only after the machine is READY for customer usage**:

1. Provider order/rent succeeded
2. Machine is online
3. Networking / endpoint mapping is ready
4. ComfyUI health check succeeds (`resolveLiveMachineStatus` → `status: running`, `healthOk: true`)
5. Required workflow endpoint is reachable

That READY signal is recorded in `completeUserStartProvision` via `rememberHostSuccess` (events: `HOST_READY`, optional `HOST_LATENCY`, `HOST_SCORE_UPDATED`).

**Rent / `create_order` success alone does not increase reputation.** Rewarding at rent time would credit hosts that later fail image pull, networking, or Comfy health — which does not match user experience.

If provisioning fails before READY, the host is not rewarded (and may be penalized via `rememberHostFailure`).

### GPU-line-specific reputation

Keys are scoped by provider + host + GPU product line:

```
{provider}-host:{hostId}|{gpuLine}
```

Examples:

- `clore-host:123|rtx4090_1x`
- `clore-host:123|rtx3090_1x`
- `vast-host:7788|rtx4090_1x`

A host that is reliable for one GPU line is not automatically trusted for another.

### Scoring

| Event | Effect |
|-------|--------|
| READY success | +`HOST_REP_SUCCESS_DELTA` (default 10), clear blacklist, reset consecutive failures |
| READY latency bonus | +0..2 if `readyLatencyMs` is fast (`HOST_READY` / `HOST_LATENCY`); no bonus if ≥ 5 minutes |
| Failure | Subtract category penalty × consecutive multiplier (up to 3×) |
| Idle time | Exponential recovery toward neutral (see below) |

### Exponential recovery

Idle recovery approaches neutral (50) asymptotically:

```
score' = neutral + (score - neutral) * e^(-lambda * hours)
```

Default `HOST_REP_RECOVERY_LAMBDA=0.4` ≈ `20 → 30 → 38 → 42 → 45 → 47 → 49 → 50`.

This prevents instant reputation resets while still allowing natural recovery. Logged as `HOST_RECOVERY`.

### Blacklist lifecycle

1. Failure classified → score drops → optional `blacklistUntil` set.
2. Selection skips blacklisted hosts (`HOST_SKIPPED`).
3. If **all** candidates are blacklisted → least-bad fallback (soonest expiry, then highest score) + log.
4. TTL elapses → `HOST_BLACKLIST_EXPIRED`.
5. READY while blacklisted → blacklist cleared (`HOST_RECOVERED`) + `HOST_READY`.

Default durations: minor 15m / repeated 30m / critical 60m. Currency mismatches do **not** blacklist.

### Failure categories

| Category | Typical signals | Penalty | Blacklist |
|----------|-----------------|---------|-----------|
| `CURRENCY` | code 6, currency-not-allowed | 2 | none |
| `RATE_LIMIT` | 429, code 5 | 3 | minor |
| `NETWORK` | timeout, ETIMEDOUT | 8 | minor→repeated |
| `UNKNOWN` | other | 10 | minor |
| `PROVIDER_INTERNAL` | code 1, 5xx | 15 | critical |
| `ENDPOINT_FAILURE` | port map / endpoint | 18 | critical |
| `IMAGE_PULL_FAILURE` | docker pull / no container | 20 | critical |
| `HEALTH_FAILURE` | Comfy never healthy | 25 | critical |

### How host selection works

1. Provider marketplace fetch + package filters (price, GPU line, currency, Vast sanity).
2. `selectWorkstationOffers` (uptime / latency / price groups).
3. `applyHostReputationToOffers` for that **gpuLine** — drop blacklisted, re-rank by score → ping → uptime → price.
4. Rent loop records failures; Vast post-rent gate + provision health record outcomes.
5. `gpuvietnam_selection.host_key` (+ `gpu_line`) is attached; READY success is attributed later.

### How to inspect

```bash
# Persistent store
type tmp\host-reputation.json
# or
cat tmp/host-reputation.json

# Structured logs (provider channel)
# HOST_READY | HOST_LATENCY | HOST_RECOVERY | HOST_SCORE_UPDATED
# HOST_BLACKLISTED | HOST_BLACKLIST_EXPIRED | HOST_SELECTED | HOST_SKIPPED | HOST_RECOVERED

# Unit tests
node --test src/lib/gpu/host-reputation/host-reputation.test.mjs
```

In-process metrics via `getHostReputationMetrics()`: `hostSelectionCount`, `hostBlacklistCount`, `hostRecoveryCount`, `hostSuccessRate`, `averageHostScore`, `topFailureReasons`.

### Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `HOST_REP_STORE_FILE` | `tmp/host-reputation.json` | Persist path |
| `HOST_REP_NEUTRAL_SCORE` | 50 | Starting score |
| `HOST_REP_SUCCESS_DELTA` | 10 | READY success bump |
| `HOST_REP_RECOVERY_LAMBDA` | 0.4 | Exponential recovery rate / hour |
| `HOST_REP_LATENCY_FAST_MS` | 60s | Fast READY threshold |
| `HOST_REP_LATENCY_NO_BONUS_MS` | 5m | No latency bonus at/above |
| `HOST_REP_LATENCY_BONUS_FAST` | 2 | Bonus if READY < fast threshold |
| `HOST_REP_LATENCY_BONUS_MEDIUM` | 1 | Bonus if READY between fast and no-bonus |
| `HOST_REP_BLACKLIST_MINOR_MS` | 15m | Minor TTL |
| `HOST_REP_BLACKLIST_REPEATED_MS` | 30m | Repeated TTL |
| `HOST_REP_BLACKLIST_CRITICAL_MS` | 60m | Critical TTL |
| `HOST_REP_PRUNE_AFTER_MS` | 14d | Drop idle records |

## Session Resume

Resume-first architecture: a browser refresh, network blip, or clicking **Mở phiên làm việc** must never start a second provision when a valid machine, lease, or GPU session already exists.

### Lifecycle

```
OFFLINE → (start) → PROVISIONING → BOOTING → STARTING_COMFY → RUNNING
                ↘ ERROR
RUNNING → STOPPING → OFFLINE
Any in-flight state → RESUMING (client) → restored state
```

| State | Meaning |
|-------|---------|
| `OFFLINE` | No resumable work — new provision allowed |
| `RESUMING` | Client restoring from API |
| `PROVISIONING` | Active lease / pending session / rent in flight |
| `BOOTING` | Machine row exists, provider still starting |
| `STARTING_COMFY` | Online / ports up, Comfy not healthy yet |
| `RUNNING` | Comfy healthy — customer usable |
| `STOPPING` | Destroy / stop in progress |
| `ERROR` | Failed machine — resume UI, do not double-start |

### Resume decision tree

1. Stopping / error machine → resume that state (no new claim)
2. Online + healthy Comfy → `RUNNING` (`SESSION_ALREADY_RUNNING`)
3. Active provisioning lease (not expired) → `PROVISIONING` / `BOOTING` / `STARTING_COMFY`
4. Pending / running `gpu_sessions` row → resume
5. Existing reconnectable machine row → resume boot
6. Expired lease + no machine → allow reclaim (one new provision)
7. Else → `OFFLINE`, allow start

### APIs

- `GET /api/user/session-resume` — full restore payload (`machineSessionView`, `billingView`, lease, endpoint, `comfyStatus`, `currentState`, …)
- `GET /api/dashboard/me` — includes compact `sessionResume` for page-load guard restore
- `POST /api/user/start-machine` — still idempotent; returns `resumed` / `duplicateStartPrevented` / `sessionResume` when an existing session is found

Frontend: on **Mở phiên làm việc**, call `session-resume` first. If `shouldResume && !allowNewProvision`, apply views and **do not** POST start-machine.

### Duplicate-start prevention

| Layer | Behavior |
|-------|----------|
| Frontend | Resume API before start POST; opening boot guard restored after refresh |
| start-machine | `alreadyOnline` / `alreadyStarting` / CAS `IGNORED` — no second lease when claim held |
| Lease | Heartbeat keeps claim alive; reclaim only after expiry |
| Metrics | `duplicateStartPrevented` via `getSessionResumeMetrics()` |

### Common resume failures

| Symptom | Check |
|---------|--------|
| Refresh shows idle briefly then opening | `sessionResume.shouldResume` on `/api/dashboard/me`; opening guard |
| Second rent after refresh | Lease expired? `SESSION_RESUME_*` logs; orphan reconcile |
| Start button still enabled while provisioning | `machineSessionView.actions.canStart` should be false |
| Resume API 500 | Live status / provider outage — snapshot still tries DB projection |

### Logs

`SESSION_RESUME_REQUEST` → `SESSION_RESUME_FOUND` / `SESSION_ALREADY_RUNNING` → `SESSION_RESUME_RESTORED`  
or `SESSION_RESUME_FAILED`

Fields: `requestId`, `machineId`, `gpuSessionId`, `provider`, `currentState`, `resumeDurationMs`.

### Debug

```bash
node --test src/lib/session-resume/session-resume.test.mjs
# Metrics: getSessionResumeMetrics()
```

## Provision Progress Engine

Real provisioning lifecycle stages for the dashboard (not a fake spinner). Built on Lease heartbeats, Session Resume, and existing `onProgress` ticks.

### Progress lifecycle

```
CHECKING_ACCOUNT → CHECKING_WALLET → SEARCHING_GPU → SELECTING_HOST
  → CREATING_ORDER → RECOVERING_ORDER_ID → CREATING_MACHINE
  → BOOTING_MACHINE → WAITING_FOR_NETWORK → STARTING_COMFY
  → VERIFYING_HEALTH → RUNNING
```

Failures jump to `FAILED`. Destroy uses `STOPPING` → `STOPPED`.

### Stage definitions (short)

| Stage | Meaning |
|-------|---------|
| `CHECKING_ACCOUNT` / `CHECKING_WALLET` | Auth + provider wallet |
| `SEARCHING_GPU` / `SELECTING_HOST` | Marketplace + reputation ranking |
| `CREATING_ORDER` / `RECOVERING_ORDER_ID` | Provider rent / Clore order id recovery |
| `CREATING_MACHINE` / `BOOTING_MACHINE` | Persist machine + provider boot |
| `WAITING_FOR_NETWORK` / `STARTING_COMFY` / `VERIFYING_HEALTH` | Ports + Comfy health |
| `RUNNING` | Customer-ready |

### How progress is restored after refresh

1. Progress is persisted under `tmp/provision-progress.json` and optionally `subscriptions.provisioning_progress` (migration **0038**).
2. `GET /api/user/provision-progress` and `GET /api/user/session-resume` return the current snapshot + timeline.
3. Dashboard polls progress every 2.5s while `phase === opening`.
4. If the JSON/DB record is missing, stage is inferred from Session Resume state (never restarts at zero when a lease/machine exists).

### Typical bottlenecks

| Stage | Why slow |
|-------|----------|
| `CREATING_ORDER` | Clore rate limit (~5.5s), retries, currency |
| `RECOVERING_ORDER_ID` | `create_order` without id → `my_orders` poll |
| `BOOTING_MACHINE` / `STARTING_COMFY` | Image pull + Comfy cold start |
| `VERIFYING_HEALTH` | Endpoint mapping / health timeouts |

### Logs / metrics

Events: `PROGRESS_STAGE_CHANGED`, `PROGRESS_COMPLETED`, `PROGRESS_FAILED`.

Metrics: `getProvisionProgressMetrics()` → `averageDurationPerStage`, `slowestStages`, `failedStages`, `averageProvisionDuration`.

```bash
node --test src/lib/provision-progress/provision-progress.test.mjs
```

## Provider Capability Cache

Caches **provider capability discovery** (supported currencies, allowed coins, marketplace *metadata*, partial GPU, max GPU count, regions, provider version). Does **not** cache live marketplace inventory — offers are always fetched live.

Built on Provider Routing, Lease, Session Resume, Host Reputation, Progress Engine, and structured logging. Does not redesign the provider abstraction layer.

### Cache hierarchy

```
Global Provider Cache (persistent JSON → Redis/DB later)
  └─ Provider Capability Cache
       ├─ Currency Cache          (cacheType: currencies)
       ├─ Capabilities            (cacheType: capabilities)
       └─ Marketplace meta        (cacheType: marketplace_meta)
            └─ Host Selection     (uses live inventory + reputation; not this cache)
```

Keys: `{provider}:{cacheType}` (e.g. `clore:currencies`).

### TTL policy (defaults, env-overridable)

| Type | Soft TTL | Env |
|------|----------|-----|
| Currencies | 10 min | `PROVIDER_CAP_CURRENCIES_TTL_MS` |
| Capabilities | 30 min | `PROVIDER_CAP_CAPABILITIES_TTL_MS` |
| Marketplace meta | 30 min | `PROVIDER_CAP_MARKETPLACE_META_TTL_MS` |
| Stale grace | 2 h | `PROVIDER_CAP_STALE_GRACE_MS` |
| Background refresh cooldown | 30 s | `PROVIDER_CAP_REFRESH_COOLDOWN_MS` |

Store file: `tmp/provider-capability-cache.json` (`PROVIDER_CAP_CACHE_FILE`).

### Stale-while-revalidate

1. **Fresh** (age < soft TTL): return immediately (`CAPABILITY_CACHE_HIT`).
2. **Stale** (soft TTL ≤ age < soft TTL + grace): return stale immediately (`CAPABILITY_CACHE_STALE`), refresh in background (`CAPABILITY_CACHE_REFRESH`, cooldown + single-flight).
3. **Missing / beyond grace**: fetch provider (`CAPABILITY_CACHE_MISS`), populate, return fresh.
4. **Fetch fails**: return stale if present (`stale_on_error`); otherwise fail gracefully. No retry storm (cooldown + in-flight dedupe).

Wallet **balances** are never cached long-term. Clore `assertPayCurrencyBalance` still does a live `GET /wallets` for balance, then `seedCurrenciesFromWallets` to refresh currency names without an extra capability round-trip.

### Manual invalidation

```js
import { invalidateCapabilityCache } from './src/lib/provider-capability-cache/index.js';
invalidateCapabilityCache('clore');                 // all Clore keys
invalidateCapabilityCache('clore', 'currencies');   // one type
invalidateCapabilityCache();                        // entire store
```

### Debugging cache issues

| Symptom | Check |
|---------|--------|
| Unexpected currency-not-allowed | Stale currency list — invalidate `clore:currencies` or wait for TTL / force refresh |
| Extra `/wallets` traffic | Confirm seed path after live wallet preflight; look for `CAPABILITY_CACHE_MISS` storms |
| Stale forever | Soft TTL + grace exceeded without successful refresh — check provider errors + cooldown |
| Metrics | `getCapabilityCacheMetrics()` → `cacheHitRate`, `cacheMissRate`, `averageCapabilityLatency`, `providerCapabilityRequests`, `backgroundRefreshCount` |

Log events: `CAPABILITY_CACHE_HIT` | `MISS` | `REFRESH` | `STALE` | `INVALIDATED` (fields: `provider`, `cacheType`, `ageMs`, `ttlMs`, `requestId`).

```bash
node --test src/lib/provider-capability-cache/capability-cache.test.mjs
```

## Provider Retry Policy Engine

Centralized retry decisions for Clore, Vast, and future providers. Provider-specific errors are classified into canonical categories; the engine returns a structured decision (wait, same host, another host, another provider, blacklist, refresh marketplace/capability cache, or fail immediately).

Integrates with Provider Routing, Host Reputation, Capability Cache, Lease, Session Resume, Progress Engine, and structured logging. Does **not** redesign provisioning.

### Retry decision flow

```
Provider error
  → classifyRetryError (canonical category)
  → RETRY_MATRIX + TTL/limits + backoff
  → provider/operation hooks (optional overrides)
  → decideRetryPolicy → applyRetryDecision
       ├─ wait / progress ticks
       ├─ invalidate capability cache
       ├─ host switch / marketplace refresh
       └─ provider failover (routing)
```

### Error mapping

| Category | Examples |
|----------|----------|
| CURRENCY | currency-not-allowed, code 6, wallet empty |
| RATE_LIMIT | 429, code 5 |
| PROVIDER_INTERNAL | code 1, 502/503/504, database error |
| NETWORK | ECONNRESET, fetch failed |
| TIMEOUT | ETIMEDOUT, timed out |
| IMAGE_PULL | failed to pull, bad host container |
| HEALTH | ComfyUI unhealthy |
| ENDPOINT | no mapped port |
| NO_CAPACITY | already rented, no offers |
| AUTH | unauthorized, invalid API key |
| VALIDATION | unsupported GPU, invalid input |
| UNKNOWN | everything else |

### Retry decision matrix (defaults)

| Category | Same host | Another host | Blacklist | Refresh caps | Refresh market | Fail now |
|----------|-----------|--------------|-----------|--------------|----------------|----------|
| CURRENCY | no | yes | no | yes | no | no |
| RATE_LIMIT | yes (exp backoff) | after budget | no | no | no | no |
| PROVIDER_INTERNAL | yes (up to 3) | then yes | no | no | no | no |
| TIMEOUT | no | yes | no | no | no | no |
| IMAGE_PULL / HEALTH / ENDPOINT | no | yes | yes | no | no | no |
| NO_CAPACITY | no | yes | no | no | yes | no |
| AUTH / VALIDATION | — | — | — | — | — | yes |
| UNKNOWN | one retry | no | no | no | no | after 1 |

Limits and backoff bases are env-overridable (`PROVIDER_RETRY_*`).

### Backoff strategy

- **immediate** — 0 ms (host switch / currency)
- **fixed** — constant delay
- **exponential** — `base * 2^retryCount` capped
- **exponential_jitter** — exponential ± jitter (default 20%) to avoid retry storms

Examples: rate limit 6s→12s→24s; provider internal 2s→4s→8s; network 1s→2s→4s.

### Provider overrides

Register without changing the engine:

```js
import { registerRetryPolicyHook } from './src/lib/provider-retry-policy/index.js';
registerRetryPolicyHook('clore', 'create_order', (input, decision) => {
  // e.g. enforce create_order spacing
  return { ...decision, waitDurationMs: Math.max(decision.waitDurationMs, 5500) };
});
```

Built-in: Clore `create_order` enforces ~5.5s spacing on RATE_LIMIT / PROVIDER_INTERNAL; Clore `rent` forces host-switch on CURRENCY + capability cache refresh.

### Progress UX

Retry ticks map to user-visible messages:

- Retrying...
- Waiting for provider...
- Trying another host...
- Refreshing marketplace...
- Trying another provider...

### Debugging retries

| Symptom | Check |
|---------|--------|
| Stuck on create_order | `RETRY_WAIT` / `RETRY_POLICY_SELECTED` — category RATE_LIMIT, waitDurationMs |
| Skipping good hosts | Host Reputation blacklist + IMAGE_PULL/HEALTH decisions |
| Immediate fail | AUTH/VALIDATION — fix credentials/config, not retries |
| Extra /wallets | CURRENCY → `refreshCapabilityCache` invalidation |
| Metrics | `getRetryPolicyMetrics()` → retryCountByCategory, retrySuccessRate, averageRetriesPerProvision, providerSwitchCount, hostSwitchCount, retryLatency |

Log events: `RETRY_POLICY_SELECTED`, `RETRY_STARTED`, `RETRY_WAIT`, `RETRY_HOST_SWITCH`, `RETRY_PROVIDER_SWITCH`, `RETRY_ABORTED`.

```bash
node --test src/lib/provider-retry-policy/retry-policy.test.mjs
```