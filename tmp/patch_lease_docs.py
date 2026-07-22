from pathlib import Path

p = Path("AI_DEBUGGING.md")
s = p.read_text(encoding="utf-8")
if s.startswith("\ufeff"):
    s = s[1:]

marker = "## Provision Lease & Heartbeat"
if marker in s:
    print("section exists")
else:
    section = """
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
"""
    orphan = "## Recovering Clore Orphan Orders"
    if orphan in s:
        s = s.replace(orphan, section.strip() + "\n\n" + orphan, 1)
    else:
        s = s.rstrip() + "\n" + section
    if "provision-lease.test.mjs" not in s:
        s = s.replace(
            "node --test src/lib/gpu/providers/clore/clore-orphan-reconcile.test.mjs",
            "node --test src/lib/gpu/providers/clore/clore-orphan-reconcile.test.mjs\nnode --test src/lib/provision-lease.test.mjs",
        )
    p.write_text(s, encoding="utf-8", newline="\n")
    print("docs updated")
