# SCB 3.4B — Milestone Completion Report

Status: COMPLETE
Milestone: SCB 3.4B — Settlement Transaction RPC
Authority (frozen architecture):
- `docs/scb/SCB_3_4_SPECIFICATION_FREEZE.md`
- `docs/scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md`
Companion documents:
- `supabase/settle-session-transaction.sql`
- `src/lib/gpu/settlement-transaction-rpc.js`
- `docs/scb/SCB_3_4B_TECH_DEBT.md`

---

# Objective

SCB 3.4B introduced a single server-side atomic settlement transaction,
`settle_session_transaction(payload json)`, that replaces the previous
client-side W2–W7 write sequence with one indivisible PostgreSQL unit of
work.

Prior to SCB 3.4B, settlement was orchestrated in JavaScript: the JS layer
performed a claim UPDATE on `gpu_sessions`, a wallet debit on `users`, a
ledger INSERT on `wallet_transactions`, a sequence of Compare-and-Swap
updates on `manual_hour_grants` / `subscriptions`, a projection sync on
`user_plan_inventory`, and a finalize UPDATE on `gpu_sessions` — as
separate, non-atomic round-trips. A failure mid-sequence could leave
partial financial state committed.

SCB 3.4B collapses that sequence into one PL/pgSQL function executed under
a single Postgres transaction via PostgREST (`supabaseAdmin.rpc(...)`). The
function is a pure transaction executor: it computes nothing — all
eligibility, allocation, wallet, entitlement allocation, and breakdown math
remains in the JS domain. It receives a JS-prepared settlement plan and
applies it atomically, or rejects atomically with a structured ERROR and
guaranteed rollback.

The migration preserves every external contract: the `SettlementResult`
shape, reconciliation compatibility, logging style, retry semantics,
Compare-and-Swap behaviour for entitlement updates, and wallet-ledger
idempotency as defence-in-depth. W1 and W8–W11 remain outside the
transaction exactly as specified by SCB 3.4.

---

# Architecture changes

## Migration from client-side W2–W7 to the server-side atomic transaction

Before SCB 3.4B the settlement write path was a chain of independent
`supabaseAdmin` round-trips issued from `settlement.js` (claim → wallet
debit → ledger insert → per-line entitlement CAS → inventory projection
sync → finalize). Each round-trip was its own implicit transaction; a crash
or exception between them could persist a claim without a debit, a debit
without an entitlement decrement, or an entitlement decrement without a
finalized session.

After SCB 3.4B, the same logical steps (W2–W7) execute inside one
PL/pgSQL function call. PostgREST wraps the RPC in a single transaction; a
normal function return commits the unit, and any exception — whether a
controlled abort raised by the function's precondition / CAS / idempotency
guards or an unhandled Postgres error — rolls back every write performed
inside the function. The JS layer no longer issues any settlement write;
it only reads CAS guard values, computes the plan, invokes the RPC, and
classifies the response.

### Transaction boundary

Per SCB 3.4 §1, the atomic unit T is exactly steps W2–W7:

- W1 (close session: `status='closed'`, `ended_at`,
  `verified_destroyed_at`, `settlement_status='pending'`, `destroy_reason`)
  is **outside** T, performed by the destroy pipeline before settlement.
- T = W2–W7, executed inside `settle_session_transaction`:
  - W2 — Claim `settlement_status = 'in_progress'` on `gpu_sessions`.
  - W3 — Deduct `users.wallet_balance`.
  - W4 — Insert `wallet_transactions` ledger row.
  - W5 — Compare-and-Swap `hours_used` on `manual_hour_grants` /
    `subscriptions`, per allocation line, in input order.
  - W6 — Re-derive `user_plan_inventory.hours_remaining` + `status` from
    the authoritative entitlement tables (inside T per SCB 3.4 §3).
  - W7 — Finalize `gpu_sessions.settlement_status = 'settled'`,
    `settlement_at`, `settlement_breakdown`.
- W8–W11 (`finalizeSession`, `clearBillingFields`, `markMachineDestroyed`,
  `markSubscriptionOffline`) remain **outside** T in
  `destroy-pipeline-run.js`.

### RPC responsibility

`settle_session_transaction(payload json) RETURNS json` is a pure
transaction executor (SCB 3.4A §2):

- Receives a fully-prepared JSON payload (session id, user id,
  `provider_destroyed_verified`, `expected_pre_settlement_status`,
  `wallet_charge`, `entitlement_lines` with `expected_hours_used`,
  `projection_sync` flag, `settlement_breakdown`, `settlement_at`,
  `idempotency_key`).
- Performs no business math: no eligibility evaluation, no allocation, no
  billable-second computation, no breakdown construction.
- Applies W2–W7 atomically under one Postgres transaction.
- Returns the SCB 3.4A §4 result shape: `OK`, `IDEMPOTENT`, or `ERROR`
  with a structured code and `rolled_back: true`.
- `SECURITY DEFINER`, `search_path = public, pg_temp`, granted to
  `service_role`.

### JS responsibility

The JS layer (`settlement.js` + `settlement-transaction-rpc.js` +
`settlement-core.js`) owns all business logic and orchestration
(SCB 3.4A §9):

- Load session; pre-RPC idempotency fast paths for `settled` / `skipped`.
- Evaluate settlement eligibility (closed session, `ended_at`, verify
  DESTROYED, not terminal).
- Compute billable seconds, available entitlement seconds, cap, allocation
  lines, and the settlement breakdown — unchanged from pre-SCB 3.4B.
- Read CAS guard values (`users.wallet_balance` and each entitlement
  target's `hours_used`) **outside** T, to populate the RPC payload.
- Assemble the SCB 3.4A §3 payload.
- Invoke `supabaseAdmin.rpc('settle_session_transaction', { payload })`.
- Translate the §4 response into the existing `SettlementResult` shape.
- Classify ERROR codes per §9: `CLAIM_LOST` / `LEDGER_CONFLICT` → re-load
  and decide IDEMPOTENT-vs-escalation; `CLAIM_PRECONDITION` → abort and
  surface to reconciliation; `WALLET_CAS` / `CAS_EXHAUSTED` /
  `PROJECTION_FAILED` / `INTERNAL` → retryable, surface to upstream retry.

### Replay model

The replay boundary is the transaction T — i.e. a single RPC call
(SCB 3.4 §6). A committed T leaves `gpu_sessions.settlement_status =
'settled'`. Any subsequent invocation for the same session is caught by
either the JS pre-check (returns `IDEMPOTENT` without invoking the RPC) or
the RPC's claim guard (returns `CLAIM_LOST`, after which JS re-loads and
returns `IDEMPOTENT`). There is no path by which a replay double-debits the
wallet or double-increments entitlement.

### Idempotency model

Two-layered (SCB 3.4 §6, SCB 3.4A §7/§8):

1. **Primary — `settlement_status` claim guard.** The RPC's W2 claim
   requires `settlement_status = expected_pre_settlement_status` (one of
   `pending` / `failed`), verified under a `FOR UPDATE` row lock and
   re-asserted by the W2 UPDATE's `WHERE settlement_status = expected_pre`
   clause. A duplicate call after a committed T sees `'settled'` and is
   rejected with `CLAIM_LOST`.
2. **Defence-in-depth — `wallet_transactions.idempotency_key` partial
   unique index.** A nullable `idempotency_key text` column is added to
   `wallet_transactions` with a partial unique index
   `WHERE idempotency_key IS NOT NULL`. The RPC sets it to
   `settle:<session_id>` on the ledger INSERT. A duplicate INSERT that
   bypasses the claim guard raises `unique_violation`, which the RPC
   translates to `LEDGER_CONFLICT`. Existing non-settlement wallet rows
   keep `NULL` and are unaffected.

### Locking model

Per SCB 3.4A §8, locks are acquired in a deterministic order and held until
function return (commit):

1. `gpu_sessions` row — `SELECT ... FOR UPDATE` at W2 (held through W7).
2. `users` row — `PERFORM ... FOR UPDATE` at W3 (held through commit).
3. Entitlement rows — `SELECT ... FOR UPDATE` per allocation line, in JS
   input order (which is the deterministic plan tier/expiry/id order).
4. `user_plan_inventory` rows — implicitly locked by the W6
   `UPDATE ... FROM` for the user's grant/ and subscription-backed rows.

This order prevents deadlock between concurrent settlements for the same
user: the `users` row `FOR UPDATE` serializes concurrent same-user
settlements at the wallet step, and entitlement rows within one settlement
are acquired in a stable order. Rival settlers for the same session
serialize on the `gpu_sessions` row lock; the loser observes `'settled'`
and returns `CLAIM_LOST`.

---

# Validation

## Implementation review

A detailed implementation review was performed against the current
repository schema and codebase, verifying:

- SQL RPC compatibility with the existing database schema — every
  referenced table and column exists, enum/string values match the
  schema's CHECK constraints (`wallet_transactions.type` /
  `wallet_transactions.status` after the deposit-status migration;
  `gpu_sessions.settlement_status` including `'in_progress'` /
  `'settled'`; `users.wallet_balance` / `users.updated_at`), and no
  incompatible data types are assumed.
- RPC compatibility with `settlement.js`, `settlement-core.js`,
  `destroy-pipeline.js`, `destroy-pipeline-run.js`, and
  `reconciliation.js` — every settlement entry point reaches the RPC.
- RPC response shape exactly matches the JS wrapper's expectations
  (`translateSettlementRpcResult` reads `state`, `settlement_status`,
  `wallet_charged`, `code`, `message`, `rolled_back`).
- Transaction correctness — PL/pgSQL exception semantics, subtransaction
  rollback propagation from nested handlers (W4 unique violation, W6
  `OTHERS`) to the outer block, `RETURN` inside an EXCEPTION handler
  returning from the function, deterministic lock order, CAS convergence
  under `FOR UPDATE`, idempotency, and dynamic-SQL safety (whitelisted
  table name + `%I` quoting + parameterised `id`).

The review concluded that the atomicity, CAS, idempotency, rollback, and
financial-write core are sound, with one regression found.

## Repository-wide audit

A full repository audit confirmed:

- No production code bypasses `settle_session_transaction`.
- No client-side W2–W7 implementation remains in production code.
- Every settlement entry point (normal destroy pipeline, reconciliation
  retry, recursive settlement retry, `settleSessionForMachine`) reaches the
  RPC.
- `skipSessionSettlement` correctly remains a non-financial W1-only path
  outside T.
- W8–W11 remain outside T, including the W11 reachability fix on the
  `ALREADY_DESTROYED` early-return path.

## Regression found

One regression was identified during the implementation review:

`src/lib/gpu/settlement.js` built
`SettlementResult.breakdown.uncharged_seconds` incorrectly. The SCB 3.4B
refactor had changed the computation to
`Math.max(0, billableSeconds - chargedSeconds) + (capAppliedSeconds ?? 0)`,
which double-counts `capAppliedSeconds`. The original behaviour was
`allocation.unchargedSeconds + (capAppliedSeconds ?? 0)` on the normal
path and `billableSeconds` on the zero-charge `skipSessionSettlement`
path. The inflated value was persisted into
`gpu_sessions.settlement_breakdown` and returned in
`SettlementResult.breakdown`, violating "preserve SettlementResult
compatibility." The regression was not caught by tests because no test
exercised the cap-applied path with a non-null `capAppliedSeconds` and
asserted on `uncharged_seconds`.

## Regression fixed

A minimal patch was applied to `src/lib/gpu/settlement.js` and nothing
else:

- Introduced a per-path `unchargedSeconds` variable.
- Normal path: `unchargedSeconds = allocation.unchargedSeconds +
  (capAppliedSeconds ?? 0)` (resolves to `billableSeconds -
  chargedSeconds`, no double-count).
- Zero-charge path: `unchargedSeconds = billableSeconds` (preserves the
  previous `skipSessionSettlement` breakdown behaviour).
- `buildSettlementBreakdown` now receives the corrected `unchargedSeconds`.

No other settlement logic, the RPC, or transaction behaviour was touched.

## Test results

- Settlement-related suites (`settlement.test.mjs`,
  `settlement-transaction-rpc.test.mjs`,
  `entitlement-increment.test.mjs`): 36 / 36 pass.
- Full repository suite (`npm test`): 298 / 298 pass, 0 fail.
- No linter errors in the modified or new files.

## Final verification

- All 298 tests pass after the regression fix.
- The RPC's W2–W7 atomicity, CAS, idempotency, rollback, and locking
  guarantees verified against Postgres PL/pgSQL semantics.
- The `SettlementResult` shape, reconciliation compatibility, logging
  style, retry semantics, CAS behaviour, and wallet-ledger idempotency
  preserved.
- W11 reachability on the `ALREADY_DESTROYED` path confirmed.
- Zero architectural deviations from SCB 3.4 / SCB 3.4A.

---

# Deliverables

## Production files added

- `supabase/settle-session-transaction.sql` — the
  `settle_session_transaction(payload json)` PL/pgSQL RPC implementing W2–W7
  atomically; adds `wallet_transactions.idempotency_key` + partial unique
  index; `SECURITY DEFINER`; granted to `service_role`.
- `src/lib/gpu/settlement-transaction-rpc.js` — JS client wrapper:
  `SETTLEMENT_RPC_ERROR`, `isSettlementRpcRetryable`, `readCasGuardValues`,
  `buildSettlementTransactionPayload`, `translateSettlementRpcResult`,
  `executeSettlementTransaction`.

## Production files modified

- `src/lib/gpu/settlement.js` — `settleSession` refactored to compute the
  plan in JS, read CAS guard values outside T, invoke the RPC, and
  classify the response per SCB 3.4A §9. Removed the client-side W2–W7
  write helpers. Fixed the `breakdown.uncharged_seconds` regression.
- `src/lib/destroy-pipeline-run.js` — W11 reachability fix: the
  `ALREADY_DESTROYED` early-return path now calls
  `markSubscriptionOffline` so a retry converges the subscription
  projection.
- `package.json` — `test` script extended with
  `src/lib/gpu/settlement-transaction-rpc.test.mjs`.

## New tests

- `src/lib/gpu/settlement-transaction-rpc.test.mjs` — unit tests for
  `SETTLEMENT_RPC_ERROR` classification, `isSettlementRpcRetryable`,
  `readCasGuardValues` (CAS guard values read outside T),
  `buildSettlementTransactionPayload` (wallet aggregation + clamping,
  entitlement line mapping, `expected_hours_used`, `idempotency_key`),
  `translateSettlementRpcResult` (OK / IDEMPOTENT / ERROR →
  `SettlementResult`), and `executeSettlementTransaction` end-to-end
  including supabase-js error → `INTERNAL`.

## Modified tests

- `src/lib/gpu/settlement.test.mjs` — `createMockSupabase` extended with
  an `async rpc(name, args)` mock that simulates the atomic RPC behaviour
  (claim guard, wallet/entitlement/projection/finalize updates, structured
  OK / ERROR responses). T7 rewritten to assert SCB 3.4 idempotency (a
  second call after a committed T returns `IDEMPOTENT` and creates no
  duplicate wallet transaction).
- `src/lib/gpu/entitlement-increment.test.mjs` — the source-string
  regression block rewritten to assert the SCB 3.4 architecture:
  `settlement.js` imports and calls `executeSettlementTransaction`; the
  old client-side write helpers are absent; the unguarded
  SELECT-`hours_used` + JS-add pattern is absent; entitlement routing
  resides in `settlement-transaction-rpc.js`'s `resolveEntitlementTarget`;
  the RPC payload carries `expected_hours_used` and
  `expected_pre_settlement_status`; wallet-charge clamping is preserved.

## New SQL artifacts

- `supabase/settle-session-transaction.sql` — the RPC function plus the
  `wallet_transactions.idempotency_key` column and
  `wallet_transactions_idempotency_key_uniq` partial unique index
  (defence-in-depth per SCB 3.4A §7/§8). Idempotent to re-apply
  (`CREATE OR REPLACE FUNCTION`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE UNIQUE INDEX IF NOT EXISTS`).

## Documentation added

- `docs/scb/SCB_3_4B_TECH_DEBT.md` — technical debt report (referenced
  below).

---

# Known deferred work

The final audit identified a set of non-blocking cleanup items that are
intentionally deferred so that SCB 3.4B remains a pure architectural
transaction refactor. They are recorded in:

`docs/scb/SCB_3_4B_TECH_DEBT.md`

That document covers the dead `entitlement-increment.js` module, the
unused `settleSession` `deps` parameter, obsolete comments, the
outdated billing / safety / architecture documents, and deferred
improvements (double `wallet_balance` read, non-`pending`/`failed`
short-circuit, W6 projection reconciliation, unwired
`settleSessionForMachine`). It is the single source of truth for
post-SCB 3.4B cleanup and is not duplicated here.

---

# Final status

SCB 3.4B COMPLETE
