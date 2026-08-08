# Host Intelligence — orphan guard (Vast probes)

> Ops probes rent short-lived Vast instances labeled `gpuvietnam-host-intel`.  
> Customer sessions never use this label.

## Failure mode (fixed 2026-08-09)

Overlapping systemd oneshot cycles (`OnUnitActiveSec`) could SIGTERM a mid-rent probe.  
Destroy was best-effort / ignored → instance kept running (cost leak).

## Guards

| Layer | What |
|-------|------|
| Single-flight lock | `tmp/host-intel.lock` — skip if another cycle holds the lock |
| Track + SIGTERM cleanup | Track rented Vast/Clore IDs; destroy on SIGTERM/SIGINT (`TimeoutStopSec=120`) |
| Probe TTL | `HOST_INTEL_PROBE_MAX_MS` (default 5m) caps gate wait |
| Periodic sweeper | Lifecycle worker: `startVastHostIntelOrphanReconciliation` — destroy label matches past grace (default **10 min**) |
| Alert | `orphan_host_intel` via `opsAlertAsync` on destroy/cleanup failure |
| Timer anti-overlap | `OnUnitInactiveSec=25min` (not `OnUnitActiveSec`) |

## Env (VPS lifecycle.env)

| Var | Default | Note |
|-----|---------|------|
| `VAST_HOST_INTEL_ORPHAN_RECONCILE` | `true` | Set `false` to disable sweeper |
| `VAST_HOST_INTEL_ORPHAN_GRACE_MS` | `600000` | Age before destroy |
| `VAST_HOST_INTEL_ORPHAN_INTERVAL_MS` | `300000` | Sweeper interval |
| `HOST_INTEL_PROBE_MAX_MS` | `300000` | Per-probe wall clock |
| `HOST_INTEL_LOCK_PATH` | `tmp/host-intel.lock` | Lock file |

## Manual cleanup

```bash
# from repo root with VAST_AI_KEY
node --env-file=.env.local scripts/cleanup-host-intel-orphans.mjs
# force all matching label:
node --env-file=.env.local scripts/cleanup-host-intel-orphans.mjs --force
```

## Code

- Runtime: `src/lib/gpu/host-reputation/host-intel-runtime.js`
- Sweeper: `src/lib/gpu/providers/vast/vast-host-intel-orphan.js` (+ runner)
- Cron: `scripts/host-intelligence-cron.mjs`
- Units: `scripts/gpuvietnam-host-intel.service` / `.timer`
