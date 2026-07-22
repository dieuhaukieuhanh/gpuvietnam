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
