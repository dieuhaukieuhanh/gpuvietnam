# IMPLEMENTATION_REPORT_M3

**Milestone:** M3B — Session Lifecycle Domain  
**Architecture Version:** 2.0  
**Design Reference:** [SESSION_DOMAIN_DESIGN.md](./SESSION_DOMAIN_DESIGN.md) v1.1  
**Date:** 2026-07-03  
**Scope:** Pure domain state machine only — no API, billing, DB, Provider Verify, Destroy Pipeline, Settlement wiring

---

## Objective

Implement **Session Lifecycle Domain** (`session-lifecycle.js`) — sole authority for session `status` transitions per SCB Architecture 2.0. Module quyết định **transition nào hợp lệ**; M4–M9 sẽ gọi domain API sau.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gpu/session-lifecycle.js` | **File mới** — pure Session Domain state machine |
| `src/lib/gpu/session-lifecycle.test.mjs` | **File mới** — 44 unit tests |
| `src/lib/gpu/index.js` | Export session-lifecycle public API |
| `package.json` | `npm test` includes session-lifecycle tests |

**Không thay đổi:** `billing.js`, API routes, frontend, auto-stop, destroy pipeline, Supabase schema, Provider Verify, Settlement engine.

---

## Architecture

### Pure Domain

| Constraint | Status |
|------------|--------|
| No Supabase | ✓ |
| No Vast / HTTP | ✓ |
| No React | ✓ |
| No logger | ✓ |
| No env reads | ✓ |
| No side effects | ✓ |
| No DB writes | ✓ |

Input/output: plain `SessionRecord` objects + `SessionContext` (subscription, machine, verify flags, clock).

### Data-Driven Transition Engine

State machine đọc từ `SESSION_TRANSITION_MAP` (20 rows). Mỗi row:

| Field | Purpose |
|-------|---------|
| `transitionId` | Stable identifier (`SES-TR-001` … `SES-TR-020`) — không phụ thuộc thứ tự runtime |
| `from` | Current state (`null` = creation) |
| `command` | Command enum |
| `to` | Next state |
| `guards` | Guard name list (tách riêng trong `SESSION_GUARDS`) |
| `illegalPolicy` | IGNORE / DOMAIN_ERROR / INVARIANT_VIOLATION |
| `match` | Optional condition (retry fatal vs transient, interrupt reason) |
| `apply` | Pure transition function |
| `idempotent` | Optional idempotency check |

Engine: `executeCommand(session, command, context, payload)` — không dùng switch/case lớn.

### Technical Hardening (M3B completion)

| Item | Implementation |
|------|----------------|
| **Immutable transition map** | `SESSION_TRANSITION_MAP` deep-frozen sau khởi tạo (`deepFreeze`) — không mutate tại runtime |
| **Frozen constants** | `Object.freeze` trên `SESSION_STATUS`, `SESSION_COMMAND`, `SESSION_DOMAIN_EVENT`, `SESSION_ERROR_CODE`, `ILLEGAL_POLICY`, `INTERRUPT_REASON` |
| **Stable transition IDs** | Mỗi row có `transitionId` cố định `SES-TR-001` … `SES-TR-020` |
| **State machine version** | `SESSION_STATE_MACHINE_VERSION = '1.0'` — bump khi định nghĩa transition thay đổi |

**Không thay đổi:** business logic, transition rules, public command API, transition result shape.

#### Transition ID Registry

| ID | From | Command | To |
|----|------|---------|-----|
| SES-TR-001 | — | CREATE_PENDING | pending |
| SES-TR-002 | pending | ACTIVATE_RUNNING | running |
| SES-TR-003 | pending | RUNNING_VERIFY_FAILED | pending |
| SES-TR-004 | pending | RUNNING_VERIFY_FAILED | interrupted |
| SES-TR-005 | pending | INTERRUPT (provision_failed) | interrupted |
| SES-TR-006 | pending | INTERRUPT (cancelled) | interrupted |
| SES-TR-007 | running | REQUEST_DESTROY | closing |
| SES-TR-008 | closing | REQUEST_DESTROY | closing (ignore) |
| SES-TR-009 | running | INTERRUPT (orphan/admin) | interrupted |
| SES-TR-010 | closing | CLOSE | closed |
| SES-TR-011 | closing | ROLLBACK_CLOSING | running |
| SES-TR-012 | closing | RETRY_DESTROY_VERIFY | closing |
| SES-TR-013 | closing | INTERRUPT (admin) | interrupted |
| SES-TR-014 | closed | START_SETTLEMENT | closed |
| SES-TR-015 | closed | COMPLETE_SETTLEMENT | closed |
| SES-TR-016 | closed | SKIP_SETTLEMENT | closed |
| SES-TR-017 | closed | FAIL_SETTLEMENT | closed |
| SES-TR-018 | closed | RETRY_SETTLEMENT | closed |
| SES-TR-019 | interrupted | INTERRUPT | interrupted (ignore) |
| SES-TR-020 | completed | ACTIVATE_RUNNING | completed (legacy guard) |

---

## Public API

### Commands (primary)

| Function | Design Command | Domain Event (on success) |
|----------|----------------|---------------------------|
| `createPendingSession(input, context)` | CreateSession | SessionCreated |
| `activateRunningSession(session, context, payload?)` | ProviderRunningVerified | SessionActivated |
| `requestDestroy(session, context, { destroyReason })` | RequestDestroy | DestroyInitiated |
| `closeSession(session, context, payload?)` | ProviderDestroyedVerified | SessionClosed |
| `interruptSession(session, context, { reason })` | RequestInterrupt | SessionInterrupted / SessionCancelled |
| `retryDestroyVerification(session, context)` | RetryDestroyVerify | SessionClosed / rollback / timeout |
| `retrySettlement(session, context)` | RetrySettlement | SettlementRetried |

### Supporting commands (transition coverage)

| Function | Purpose |
|----------|---------|
| `cancelSession(session, context)` | Wrapper — `interruptSession` với `cancelled` |
| `handleRunningVerifyFailed(session, context)` | Pending stay or → interrupted |
| `rollbackClosingToRunning(session, context)` | ProviderDestroyVerifyFailed |
| `startSettlement` / `completeSettlement` / `skipSettlement` / `failSettlement` | Settlement sub-state rules (domain only — M6 implements commit) |

### Engine & validation

| Function | Purpose |
|----------|---------|
| `executeCommand(session, command, context, payload?)` | Low-level transition engine |
| `findTransitions(from, command)` | Lookup transition rows |
| `getTransitionMap()` | Full map (testing / introspection) |
| `assertSessionIntegrity(session)` | SD-2, SD-3, SD-4 pre/post check — **throws** on corruption |
| `assertAtMostOneRunningSession(context)` | SD-1 — **throws** when count > 1 |

### Constants

| Export | Description |
|--------|-------------|
| `SESSION_STATUS` | pending, running, closing, closed, interrupted, completed |
| `SETTLEMENT_STATUS` | not_applicable, awaiting_verify, pending, in_progress, settled, skipped, failed |
| `SESSION_COMMAND` | Command enum |
| `SESSION_DOMAIN_EVENT` | Domain event names |
| `SESSION_ERROR_CODE` | Domain error codes |
| `ILLEGAL_POLICY` | Ignore / Domain Error / Invariant Violation |
| `INTERRUPT_REASON` | provision_failed, cancelled, orphan, admin, running_verify_fatal |
| `SESSION_STATE_MACHINE_VERSION` | `'1.0'` — semantic version of transition definition |
| `SESSION_GUARDS` | Guard registry (exported for testing) |
| `SessionInvariantViolationError` | Throw only for invariant corruption |

---

## Transition Result

```javascript
// Success
{ state: 'OK', session, transition: { from, to, command }, event }

// Idempotent no-op
{ state: 'IGNORED', session, transition: null, event: null }

// Business error — no throw
{ state: 'ERROR', code, message }
```

**Throw** chỉ khi: `SessionInvariantViolationError` (SD-1 data drift, SD-2/3/5/6 field corruption, immutable field violation).

---

## Transition Coverage

| From | Command / Event path | To | Covered |
|------|----------------------|-----|---------|
| — | createPendingSession | pending | ✓ |
| pending | activateRunningSession | running | ✓ |
| pending | handleRunningVerifyFailed (retries) | pending | ✓ IGNORED |
| pending | handleRunningVerifyFailed (fatal) | interrupted | ✓ |
| pending | interrupt (provision_failed) | interrupted | ✓ |
| pending | cancelSession | interrupted | ✓ |
| running | requestDestroy | closing | ✓ |
| closing | requestDestroy (duplicate) | closing | ✓ IGNORED |
| running | interrupt (orphan/admin) | interrupted | ✓ |
| closing | closeSession | closed | ✓ |
| closing | rollbackClosingToRunning | running | ✓ |
| closing | retryDestroyVerification (timeout) | closing | ✓ IGNORED |
| closing | interrupt (admin) | interrupted | ✓ |
| closed | startSettlement | closed (in_progress) | ✓ |
| closed | completeSettlement | closed (settled) | ✓ |
| closed | skipSettlement | closed (skipped) | ✓ |
| closed | failSettlement | closed (failed) | ✓ |
| closed | retrySettlement | closed (in_progress) | ✓ |
| interrupted | interrupt (duplicate) | interrupted | ✓ IGNORED |
| completed | any write | — | ✓ DOMAIN_ERROR |

### Forbidden transitions (return ERROR, không mutate)

| Attempt | Error code |
|---------|------------|
| running → closed (skip closing) | SESSION_NOT_CLOSING |
| pending → closing | SESSION_NOT_RUNNING |
| pending → closed | SESSION_NOT_CLOSING |
| interrupted → running | SESSION_NOT_PENDING |
| closed → running | INVALID_TRANSITION |
| new → completed | LEGACY_STATUS_FORBIDDEN |
| close without verify | PROVIDER_NOT_VERIFIED |

---

## Invariants Implemented

| ID | Enforcement |
|----|-------------|
| SD-1 | Guard `noOtherRunning` / `ses1Activate`; throw if count > 1 |
| SD-2 | Guard `startedAtSet`; set on activate |
| SD-3 | Set `ended_at` on close; guard `endedAtSet` |
| SD-4 | Set `settlement_status` on close |
| SD-5 | `assertImmutableField` on `started_at` |
| SD-6 | `assertImmutableField` on `ended_at` |
| SD-7 | No running → closed row in map |
| SD-8 | No closed → * transitions |
| SD-9 | `settlementNotSettled` guard; idempotent complete/retry |
| SD-10 | No settlement write while running (no settlement commands except closed) |
| SD-11 | `providerDestroyedVerified` guard on close |
| SD-12 | `machineLinked` / `machineExists` guards |
| SD-13 | `subscriptionActive` guard |
| SD-14 | Reject completed on create; legacy read-only |
| SD-15 | Timestamps only — domain sets started_at/ended_at |
| SD-16 | Module is sole transition authority (callers use API) |
| SD-17 | interrupted terminal — IGNORE duplicate interrupt |
| SD-18 | `destroyReasonProvided` guard on requestDestroy |

---

## Illegal Transition Policy (§8.2)

| Policy | Implementation |
|--------|----------------|
| **Ignore** | `state: 'IGNORED'` — duplicate destroy, settled retry, terminal interrupt |
| **Return Domain Error** | `state: 'ERROR'` — wrong state, guard fail (business) |
| **Log Warning** | Not implemented (no logger in pure domain — M9 adapter logs) |
| **Raise Invariant Violation** | `SessionInvariantViolationError` throw |

---

## Unit Tests

**Runner:** `npm test`  
**Session tests:** 44 tests in `session-lifecycle.test.mjs`  
**Total (M2 + M3B):** 67 tests, 0 failures

| Category | Tests |
|----------|-------|
| Happy path full lifecycle | pending → running → closing → closed → settled |
| createPendingSession guards | subscription, SES-1, SD-14 |
| activateRunningSession | verify, wrong state |
| handleRunningVerifyFailed | retry / fatal |
| interruptSession | provision, cancel, orphan, idempotent |
| requestDestroy / close | SD-7, OP-1, destroy_reason |
| retryDestroyVerification | destroyed / still_running / timeout |
| Settlement sub-state | start, complete, skip, fail, retry, idempotent |
| Legacy completed | read-only reject |
| Invariants | integrity throws, immutable fields |
| Illegal transitions | INVALID_TRANSITION, SD-17 |

---

## CHƯA Implement (Out of Scope M3B)

| Milestone | Item | M3B status |
|-----------|------|------------|
| **M4** | Provider Verify HTTP / poll / `verified_*_at` writes | Context flags only — caller passes `providerRunningVerified`, `providerDestroyedVerified` |
| **M5** | Remove billing tick | Not touched |
| **M6** | Settlement entitlement commit | Domain rules for `settlement_status` sub-state only — no wallet/inventory write |
| **M7** | Destroy Pipeline orchestration | `requestDestroy` / `closeSession` API only — no backup, no Vast destroy |
| **M9** | API wiring — handlers call session-lifecycle | Not started |
| **M13** | Reconciliation / stale closing alerts | Not started |
| DB | Persist session rows via Supabase | Caller responsibility |
| Auto Stop | Trigger destroy | Not wired |
| Frontend | Session UI | Not touched |

---

## Integration Notes (Future M9+)

1. API layer loads session snapshot → calls domain command → persists returned `session` if `state === 'OK'`.
2. Provider Verify (M4) sets context flags; **never** bypasses Session Lifecycle for `status`.
3. Settlement (M6) calls `startSettlement` / `completeSettlement` after domain close.
4. Remaining (M2) reads session snapshots produced by this domain — `assertAtMostOneRunningSession` aligns with Remaining `MULTIPLE_RUNNING_SESSIONS`.

---

## Compliance

| Document | Alignment |
|----------|-----------|
| SESSION_DOMAIN_DESIGN.md v1.1 | ✓ |
| OPERATIONAL_STATE_MACHINE §4 | ✓ |
| ADR-003 Verify before settle | ✓ (OP-1 guard) |
| ADR-009 Session central | ✓ |
| ADR-014 State machine | ✓ |
| CODING_RULES Rule 11, 14 | ✓ |
| IMPLEMENTATION_PLAN M3 | ✓ |

---

## Verdict

**M3B Session Lifecycle Domain — complete** (technical hardening: immutable map, transition IDs, version `1.0`).

Pure domain state machine sẵn sàng cho M4 (Provider Verify integration) và M9 (API wiring). Không thay đổi runtime production paths trong milestone này.

---

*GPUVietnam Implementation Report M3B — 2026-07-03*

**Changelog:** Technical hardening — deep-frozen `SESSION_TRANSITION_MAP`, stable `transitionId`, `SESSION_STATE_MACHINE_VERSION`.
