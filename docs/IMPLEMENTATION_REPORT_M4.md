# IMPLEMENTATION_REPORT_M4

**Milestone:** M4 — Provider Verification Module  
**Architecture Version:** 2.0 (Frozen)  
**Design Reference:** [IMPLEMENTATION_PLAN_SCB.md](./IMPLEMENTATION_PLAN_SCB.md) M4 · [SESSION_CENTRIC_BILLING_ARCHITECTURE.md](./SESSION_CENTRIC_BILLING_ARCHITECTURE.md) §7 · [OPERATIONAL_STATE_MACHINE.md](./OPERATIONAL_STATE_MACHINE.md) PRV-* · ADR-003 · ADR-007  
**Date:** 2026-07-03  
**Scope:** Provider verify gates only — no API wiring, billing, settlement, destroy pipeline, reconciliation implementation

---

## Objective

Triển khai **Provider Verification Module** — gate duy nhất cho:

- **Verify RUNNING** — session `pending → running` (SCB §7.2)
- **Verify DESTROYED** — trước settlement (OP-1, ADR-003)

Mọi đọc trạng thái live instance **chỉ** qua `ProviderVerifyPort` (GPU Provider Adapter). Không tin DB alone. Không gọi Vast HTTP trực tiếp từ billing/API/UI.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/provider-verify.js` | **File mới** — verify RUNNING/DESTROYED, pure evaluators, M13 contract stubs |
| `src/lib/gpu/provider-verify.test.mjs` | **File mới** — 18 unit tests |
| `src/lib/gpu/index.js` | Export provider-verify public API |
| `src/lib/machines.js` | **Thêm** `resolveVerifiedProviderState()` — không sửa `resolveLiveMachineStatus()` |
| `package.json` | `npm test` includes provider-verify tests |

**Không thay đổi:** `session-lifecycle.js`, `remaining-time.js`, `billing.js`, API routes, frontend, destroy pipeline, Supabase schema, auto-stop.

---

## Public API

### Verification (primary)

| Function | Purpose |
|----------|---------|
| `verifyInstanceRunning(instanceId, port, options?)` | Gate RUNNING — pass khi instance running (+ health khi port hỗ trợ) |
| `verifyInstanceDestroyed(instanceId, port, options?)` | Gate DESTROYED — pass khi destroyed / 404 / stopped |
| `verifyProviderState(instanceId, port, options?)` | Đọc normalized live state — không ghi DB (M4 + M13 contract) |
| `readProviderStateSnapshot(instanceId, port, options?)` | Low-level snapshot từ adapter |
| `createProviderVerifyPortFromGpuService(gpuService)` | Wrap `GPUService` → `ProviderVerifyPort` |

### Pure domain (deterministic, unit-testable)

| Function | Purpose |
|----------|---------|
| `normalizeGpuStatusCode(code)` | Map `GPUStatusCode` → normalized state |
| `buildProviderStateSnapshot(instanceId, instance, options?)` | Build snapshot object |
| `evaluateRunningVerify(snapshot)` | Pure RUNNING gate evaluation |
| `evaluateDestroyedVerify(snapshot)` | Pure DESTROYED gate evaluation |
| `isVerifyPass(result, 'running' \| 'destroyed')` | Idempotent pass check |
| `isProviderVerifyTimeoutError(error)` | Timeout classifier |
| `buildUnknownVerifyResult(instanceId, error, now?)` | UNKNOWN result builder |

### M13 reconciliation contract (stub only)

| Function | M4 behavior |
|----------|-------------|
| `reconcileMachine(input?)` | No-op — `{ drifts: [], message: 'M13 not implemented' }` |
| `reconcileSession(input?)` | No-op |
| `reconcileSettlement(input?)` | No-op — **không** trigger settlement |

### Constants

| Export | Description |
|--------|-------------|
| `PROVIDER_VERIFY_MODULE_VERSION` | `'1.0'` |
| `NORMALIZED_PROVIDER_STATE` | running, destroyed, starting, stopping, stopped, failed, unknown |
| `PROVIDER_VERIFY_STATE` | OK, FAILED, UNKNOWN |
| `PROVIDER_VERIFY_OUTCOME` | verified_running, verified_destroyed, verify_failed, unknown |
| `PROVIDER_VERIFY_ERROR_CODE` | Structured error codes |
| `RECONCILIATION_STUB_MESSAGE` | M13 placeholder message |

### Integration helper (`machines.js`)

| Function | Purpose |
|----------|---------|
| `resolveVerifiedProviderState(gpuService, machine, options?)` | Verify path cho machine row — resolve `machines.instance_id` qua adapter |

### Verify result shape

```javascript
// Pass
{ state: 'OK', outcome: 'verified_running' | 'verified_destroyed', snapshot, verifiedAt }

// Fail (business — no throw)
{ state: 'FAILED', outcome: 'verify_failed', snapshot, code, message, retryable? }

// Timeout / provider error — no settlement (T4)
{ state: 'UNKNOWN', outcome: 'unknown', snapshot, code, message, retryable? }
```

---

## Architecture Compliance

| Requirement | Status |
|-------------|--------|
| ADR-003 — Settlement chỉ sau Verify DESTROYED | `verifyInstanceDestroyed` blocks when still running |
| ADR-007 — Provider qua Adapter | `ProviderVerifyPort` only; no `vast-client` import |
| CODING_RULES Rule 4, 13 | Verify qua `provider-verify.js` |
| OP-1 — No settlement without verify destroy | FAILED/UNKNOWN destroyed verify |
| SCB §7.2 pass conditions | RUNNING + health; DESTROYED / 404 / stopped |
| SCB §7.4 — Tách reconciliation | Stubs only; no settlement in reconcile |
| M1 — `verified_*_at` columns | **Not written in M4** — caller persists (M7/M9) |
| M3 — Session lifecycle | **Unchanged** — caller passes `providerRunningVerified` / `verifyOutcome` |
| PRV-1, PRV-2 (OSM) | Enforced by verify functions |

### Provider instance SoT

Resolve `instanceId` từ `machines.instance_id` (M1 Review) — module nhận `instanceId` string; không đọc Supabase.

### IMPLEMENTATION_PLAN test cases

| # | Case | Covered |
|---|------|---------|
| T1 | Provider returns running | ✓ `verifyInstanceRunning` |
| T2 | Provider 404 | ✓ `verifyInstanceDestroyed` → `GPUInstanceNotFoundError` |
| T3 | Running when expect destroyed | ✓ `INSTANCE_STILL_RUNNING` |
| T4 | API timeout | ✓ `UNKNOWN`, retryable |
| T5 | Verify RUNNING fail at start | ✓ `INSTANCE_NOT_READY` (starting) |

---

## Test Coverage

**Runner:** `npm test`  
**M4 tests:** 18 in `provider-verify.test.mjs`  
**Total (M2 + M3B + M4):** 85 tests, 0 failures

| Category | Tests |
|----------|-------|
| Pure `normalizeGpuStatusCode` | Status mapping |
| Pure `evaluateRunningVerify` / `evaluateDestroyedVerify` | Gate logic |
| `verifyInstanceRunning` | T1, T5, T4, idempotency |
| `verifyInstanceDestroyed` | T2, T3, T4, stopped |
| `verifyProviderState` | Snapshot read, no side effects |
| Reconciliation stubs | M13 no-op contract |
| Invalid input | Empty instanceId |

---

## Limitations

| Item | M4 status | Owner |
|------|-----------|-------|
| Persist `verified_running_at` / `verified_destroyed_at` | Not implemented — verify returns timestamp; DB write in M7/M9 | Destroy pipeline |
| Wire verify into start/destroy API | Not implemented | M9 |
| `resolveLiveMachineStatus` unchanged | UI poll path giữ behavior cũ | M9 may align |
| `providerRunningVerified` in Remaining snapshot | Caller still sets flag manually | M9 |
| Reconciliation scan/repair | Contract stubs only | M13 |
| Retry backoff orchestration | Caller responsibility | M7 |
| Health check optional | Port without `healthCheck` passes RUNNING on status code only | By design |

---

## Next Milestone Dependencies

| Milestone | Depends on M4 |
|-----------|----------------|
| **M6 Settlement** | `verifyInstanceDestroyed` pass before commit |
| **M7 Destroy Pipeline** | `verifyInstanceDestroyed` + `createProviderVerifyPortFromGpuService` |
| **M9 API wiring** | `verifyInstanceRunning` at start; pass flags to `session-lifecycle` |
| **M13 Reconciliation** | `verifyProviderState`, `reconcileMachine/Session/Settlement` contracts |

**Recommended integration pattern (M7+):**

1. Resolve `machines.instance_id` for session's `machine_id`.
2. `verifyInstanceRunning` / `verifyInstanceDestroyed` via `createProviderVerifyPortFromGpuService(gpuService)`.
3. On OK → call `session-lifecycle` with `providerRunningVerified` / `providerDestroyedVerified`.
4. Persist `verified_*_at` from `verifiedAt` in adapter layer.

---

## Verdict

**M4 Provider Verification Module — complete.**

Pure verify gates + adapter port + M13 contract stubs. Không thay đổi runtime behavior của M1–M3. Sẵn sàng cho M7 (Destroy Pipeline) và M9 (API wiring).

---

*GPUVietnam Implementation Report M4 — 2026-07-03*
