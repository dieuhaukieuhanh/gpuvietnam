# SCB 3.4B — Technical Debt Report

Status: Accepted technical debt, intentionally deferred.
Authority: Final repository-wide audit of SCB 3.4B (settlement transaction RPC).
Companion specs:
- `docs/scb/SCB_3_4_SPECIFICATION_FREEZE.md`
- `docs/scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md`

This document inventories the cleanup items identified during the final audit
of SCB 3.4B. None of these items affect correctness, atomicity, or the
SettlementResult contract. They are recorded here so that SCB 3.4B ships as a
pure architectural transaction refactor with minimal unrelated changes, and so
that a future cleanup milestone can dispose of them deliberately.

---

# Dead code

## 1. `src/lib/gpu/entitlement-increment.js`

The entire module is dead production code after SCB 3.4B.

- Exports: `incrementHoursUsedCas`, `INCREMENT_TABLE` (and the internal
  `ALLOWED_TABLES` whitelist).
- Before SCB 3.4B, `settlement.js` imported `incrementHoursUsedCas` /
  `INCREMENT_TABLE` to perform the client-side W5 CAS writes on
  `manual_hour_grants` and `subscriptions`.
- SCB 3.4B moved the entitlement CAS inside the server-side transaction
  (`settle_session_transaction`, STEP 3 — ENTITLEMENT). `settlement.js` no
  longer imports this module.
- The only remaining importer is `src/lib/gpu/entitlement-increment.test.mjs`.
  No production module imports it, and `src/lib/gpu/index.js` does not
  re-export it.
- The test file's comment ("the helper `incrementHoursUsedCas` is retained
  (SCB 3.4 §4 'CAS remains')") is misleading: SCB 3.4 §4 means the CAS
  *semantics* remain (now enforced server-side inside T), not that the JS
  helper must remain in the codebase.

Deferred action: remove `entitlement-increment.js` and fold the still-relevant
source-string regression assertions from `entitlement-increment.test.mjs` into
the SCB 3.4B test suite (or delete the direct `incrementHoursUsedCas` tests and
keep only the SCB 3.4 architecture invariants).

## 2. Unused `deps` parameter on `settleSession`

`src/lib/gpu/settlement.js` — `settleSession(supabaseAdmin, input, deps = {})`.

- `deps` is declared, JSDoc'd ("Reserved for signature compatibility"), and
  forwarded through the recursive `CLAIM_LOST` / `LEDGER_CONFLICT` re-entries
  (lines 368, 382), but `deps.` is never read in the function body.
- The previous consumer was `deps.syncUserPlanInventory`, invoked after the
  client-side commit. SCB 3.4 §3 moved the projection sync (W6) server-side
  into the RPC, so the JS-side `syncUserPlanInventory` is no longer called
  from this path.
- The tests still pass `{ syncUserPlanInventory: mock.syncInventory }`
  (`settlement.test.mjs` lines 415, 447, 498, 524, 536). These are now silent
  no-ops: the mock fixture is accepted but never invoked.

Deferred action: drop the `deps` parameter from `settleSession` (and the
recursive call sites), update the JSDoc, and remove the no-op
`syncUserPlanInventory` fixtures from `settlement.test.mjs`. Requires a
coordinated test edit, hence deferred.

## 3. Obsolete comments

- `src/lib/gpu/settlement.js` header (lines 1–5):
  "Settlement Domain — M6. Sole entitlement writer for session consumption
  (SCB §6)." — The JS module is no longer the sole entitlement writer; the
  `settle_session_transaction` RPC is. The `@see
  docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md §6` reference is also stale
  relative to the SCB 3.4 boundary.
- `src/lib/gpu/settlement-transaction-rpc.js` references "the legacy
  `commitSettlementLines`", "`deductHoursFromInventoryPlan`", and
  "`chargeWalletForSession`" in JSDoc rationale comments (lines 66, 71, 87,
  167). These are accurate as historical framing ("mirrors the legacy …"),
  but once the legacy helpers are removed in a future cleanup these comments
  should be reworded to stand on their own.

Deferred action: reword the module header to describe the SCB 3.4 division of
responsibility (JS = business math + orchestration; RPC = atomic W2–W7
executor) and decouple the RPC wrapper comments from the soon-to-be-removed
legacy helper names.

---

# Documentation updates

These documents describe the **current** architecture and are now inaccurate
after SCB 3.4B. Each should be updated at the next documentation milestone.

## 1. `docs/BILLING_LOGIC_REVIEW.md`

- Lines 32, 239: name `deductHoursFromInventoryPlan()` as the current
  entitlement writer for `subscriptions.hours_used` /
  `manual_hour_grants.hours_used`.
- Update needed: replace with `settle_session_transaction` (RPC) as the sole
  entitlement writer for session consumption, and note that the JS allocation
  math remains in `settlement-core.js` / `settlement.js`.
- Why: the document is a live billing-logic review used as a reference; an
  active reader would be misled into thinking the client-side helper is still
  the writer.

## 2. `docs/BILLING_SAFETY.md`

- Line 43: attributes `subscriptions.hours_used` / `manual_hour_grants.hours_used`
  writes to `deductHoursFromInventoryPlan()`.
- Update needed: attribute entitlement writes to the atomic RPC; mention the
  `settlement_status` claim guard and `wallet_transactions.idempotency_key`
  partial unique index as the defence-in-depth guarantees (SCB 3.4 §6,
  SCB 3.4A §7/§8).
- Why: this is the billing-safety reference; it must reflect the actual
  exactly-once and atomicity guarantees, which are now server-side.

## 3. `docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md`

- §6 / line 340: describes the Commit step as "Cập nhật `hours_used` / grant /
  wallet + wallet_transaction (hourly)" with no mention of the atomic
  transaction boundary or `settle_session_transaction`.
- Update needed: document the SCB 3.4 transaction boundary (W1 outside, T =
  W2–W7 inside `settle_session_transaction`, W8–W11 outside) and the
  JS-orchestrates / RPC-executes split.
- Why: this is the architecture document referenced by the `settlement.js`
  module header; it is the canonical description of the settlement flow and
  must reflect the atomic refactor.

## 4. `src/lib/gpu/settlement.js` header comment

- Lines 1–5: "Sole entitlement writer for session consumption (SCB §6)."
- Update needed: the JS module is the orchestrator; the RPC is the writer.
- Why: in-code architecture signage; reviewers reading the module header
  would misunderstand the write boundary.

## 5. `docs/scb/SCB-ARCHITECTURE.md`

- Contains no reference to SCB 3.4, the settlement transaction boundary, or
  the `settle_session_transaction` RPC.
- Update needed: add a section or pointer to
  `docs/scb/SCB_3_4_SPECIFICATION_FREEZE.md` and
  `docs/scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md`, and summarise the W2–W7 atomic
  boundary.
- Why: this is the umbrella SCB architecture document; it should index the
  current settlement transaction architecture.

## 6. `docs/ARCHITECTURE_VERSION.md` / `docs/ARCHITECTURE_LOCK.md`

- Should be checked for a settlement-architecture version/lock entry.
- Update needed: record SCB 3.4B (settlement transaction RPC) as the current
  settlement write architecture, superseding the M6 client-side commit.
- Why: these documents track which architecture is currently locked; a
  transaction-boundary change of this magnitude should be recorded.

## Historical documents (deferred — likely leave as-is)

These reference removed helpers (`deductHoursFromInventoryPlan`,
`chargeWalletForSession`, `commitSettlementLines`) but are point-in-time
implementation reports / plans / feasibility studies. They should be updated
only if repository policy requires keeping historical reports current;
otherwise they remain valid as historical records of their respective
milestones:

- `docs/IMPLEMENTATION_REPORT_M6.md` (lines 25, 62, 63, 90)
- `docs/SESSION_BASED_BILLING_FEASIBILITY.md` (lines 100, 122)
- `docs/IMPLEMENTATION_PLAN_SCB.md` (lines 384, 385, 403)
- `docs/IMPLEMENTATION_REPORT_M7.md`
- `docs/IMPLEMENTATION_REPORT_M13.md`

## Documents verified accurate (no update needed)

- `docs/SESSION_DOMAIN_DESIGN.md` — the settlement state machine is unchanged
  (`pending` / `in_progress` → `settled` / `skipped` / `failed`; `in_progress`
  is now set by the RPC claim, which is consistent with the documented
  transition `SettlementStarted → settlement_status = in_progress`).
- `docs/CODING_RULES.md` — the "call `settleSession()` twice → entitlement
  delta once" idempotency test is still valid.
- `docs/ARCHITECTURE_EXTENSION_GUIDE.md` — `settleSession` references still
  hold.
- `docs/OPERATIONAL_STATE_MACHINE.md` — `syncUserPlanInventory` repair entry
  still exists for non-settlement projection repair paths.
- `docs/PROJECT_CONTEXT.md`, `docs/IMPLEMENTATION_REPORT_M10.md`,
  `docs/ARCHITECTURE_REVIEW.md` — `syncUserPlanInventory` references are for
  non-settlement (dashboard / inventory projection) flows, which still use it.

---

# Deferred improvements

## 1. Remove the dead `entitlement-increment.js` module

- Optimization / cleanup: deletes an unused module and its dedicated test
  file, reducing the surface reviewers must reason about.
- Why deferred: removal touches a test file with a mixed purpose (direct
  `incrementHoursUsedCas` tests + SCB 3.4 source-string regression tests).
  The regression assertions must be migrated first to avoid losing the
  "no client-side W2–W7 in `settlement.js`" invariant check. That is a
  scoped test refactor, not part of a transaction-refactor milestone.

## 2. Drop the unused `deps` parameter and no-op test fixtures

- Optimization: simplifies the `settleSession` signature and removes
  misleading test fixtures.
- Why deferred: requires coordinated edits across `settlement.js` and
  `settlement.test.mjs` (5 call sites + the recursive re-entries). Keeping
  the parameter for now preserves the public signature for any external
  caller (e.g. `settleSessionForMachine` or admin tooling) that might still
  pass a `deps` object.

## 3. Collapse the double `wallet_balance` read

- Optimization: `settleSession` reads `users.wallet_balance` once for the
  allocation math (line 271) and `readCasGuardValues` reads it again for the
  CAS guard (`settlement-transaction-rpc.js` line 128). The first read could
  feed both, saving one round-trip.
- Why deferred: the second read is fresher (closer to the RPC call) and thus
  a better CAS guard value; collapsing them would slightly weaken the CAS
  freshness. The cost is one extra `SELECT` per settlement — non-critical.
  Needs a measured trade-off decision, not a drive-by change.

## 4. Short-circuit non-`pending`/`failed` sessions before the RPC

- Optimization: `in_progress` / `awaiting_verify` / `not_applicable` sessions
  pass `evaluateSettlementEligibility` (which only blocks `settled` /
  `skipped`), perform wallet + plans + CAS reads, invoke the RPC, and only
  then get `CLAIM_PRECONDITION`. A JS-side `SETTLEABLE_SETTLEMENT_STATUSES`
  check before the reads would avoid the wasted work.
- Why deferred: the current behaviour is correct (the RPC is the authority
  and rejects cleanly → `INVALID_SETTLEMENT_STATE`), and the wasted-work
  pattern matches the pre-SCB 3.4 client-side claim guard. Optimising it is a
  behavioural change that should be measured and reasoned about separately.

## 5. Reconcile the W6 projection sync with the JS `syncUserPlanInventory`

- Non-blocking architectural cleanup: the RPC's W6 re-derives
  `user_plan_inventory.hours_remaining` + `status` for all of the user's
  grant/subscription-backed rows, while the JS `syncUserPlanInventory`
  (still used by dashboard / repair paths) carries richer active/inactive
  status logic. A settlement can flip a previously-deactivated grant's
  inventory row back to `active` if it still has hours remaining.
- Why deferred: SCB 3.4 §3 explicitly sanctions the simplified inside-T
  projection whose invariant is `hours_remaining` consistency. The
  `status` divergence is spec-compliant and self-heals on the next
  dashboard / repair `syncUserPlanInventory` pass. Aligning the two
  projections is a projection-domain change, not a transaction-refactor
  change.

## 6. `settleSessionForMachine` — unwired public entry point

- Non-blocking: the "legacy wrapper" is exported (`src/lib/gpu/index.js`
  line 94) and delegates correctly to `settleSession` → RPC, but has no
  current caller in `src/pages` or `scripts`.
- Why deferred: it is a documented admin/retry tooling entry point. Removing
  it would change the public `gpu` barrel surface; keeping it is harmless
  and it reaches the RPC correctly. Revisit when admin tooling is audited.

---

# Explicit statement

These items are intentionally deferred to a future cleanup milestone so that
SCB 3.4B remains a pure architectural transaction refactor with minimal
unrelated changes.

Specifically, the SCB 3.4B milestone:
- introduced the `settle_session_transaction` RPC and wired the settlement
  entry points to it;
- preserved the `SettlementResult` shape, reconciliation compatibility,
  logging style, retry semantics, CAS behaviour, and wallet-ledger
  idempotency;
- fixed the W11 reachability gap;
- fixed the single `breakdown.uncharged_seconds` regression found during
  review.

It did **not**:
- remove `entitlement-increment.js` or its tests;
- remove the `settleSession` `deps` parameter or the no-op test fixtures;
- reword the `settlement.js` module header or the RPC wrapper's
  legacy-helper comments;
- update the billing / safety / architecture documents;
- collapse the double `wallet_balance` read;
- short-circuit non-`pending`/`failed` sessions before the RPC;
- reconcile the W6 projection with the JS `syncUserPlanInventory`; or
- remove the unwired `settleSessionForMachine` entry point.

No production code was modified to produce this report. The items above are
recorded for a future, separately-scoped cleanup milestone.
