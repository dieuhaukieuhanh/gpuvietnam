# SCB 3.5 — Documentation Completion Report

Status: COMPLETE
Milestone: SCB 3.5 — Cleanup & Documentation Freeze
Authority:
- `docs/scb/SCB_3_4_SPECIFICATION_FREEZE.md`
- `docs/scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md`
- `docs/scb/SCB_3_4B_COMPLETION_REPORT.md`
- `docs/scb/SCB_3_4B_TECH_DEBT.md`

Scope: documentation only. No production code, no tests, no SQL, no
transaction-behaviour changes were made in this milestone. The only file
under `src/` that was edited is `src/lib/gpu/settlement.js`, and only its
header **comment block** was rewritten (no executable code changed —
verified by re-running the settlement test suite: 22/22 pass, 0 linter
errors). This item was classified as a documentation update in
`docs/scb/SCB_3_4B_TECH_DEBT.md` (§ Documentation updates, item 4).

---

# Updated files

| File | Type | Change |
|------|------|--------|
| `src/lib/gpu/settlement.js` | Module header comment (comment-only) | Replaced the "Settlement Domain — M6. Sole entitlement writer…" header with an SCB 3.4B header stating the module orchestrates JS business math and invokes `settle_session_transaction` (W2–W7), which is the sole entitlement/wallet writer. Added `@see` links to the SCB 3.4 freeze and RPC contract. No code logic touched. |
| `docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md` | Living architecture doc | §6.3 Settlement table: added an SCB 3.4B banner describing the atomic RPC, marked each row JS vs RPC, rewrote the **Commit** row to reference `settle_session_transaction()` (W2–W7 atomic), rewrote the **Đánh dấu** row as W7 inside the same RPC, and rewrote the **Idempotent** row to cite the replay boundary + claim guard + `idempotency_key` defence-in-depth. |
| `docs/scb/SCB-ARCHITECTURE.md` | Living SCB architecture doc | Added §1.4 "SCB 3.4B — Settlement Transaction RPC" summarising the W2–W7 atomic boundary, W1/W8–W11 outside T, JS-orchestrates / RPC-executes split, replay boundary, idempotency, CAS location, and projection-sync location, with links to the frozen specs and the completion report. Noted SCB 3.4B is an allowed Architecture 2.0 refinement. |
| `docs/BILLING_LOGIC_REVIEW.md` | Stale living-as-current review | Added a prominent **OUTDATED (pre-SCB-3.0 model)** banner at the top stating the reviewed functions (`deductPerMinute`, `stopBilling`, `applyBillingDeduction`, `chargeWalletForHours`, `deductHoursFromInventoryPlan`) have been removed during the SCB rebuild, that current billing is Session-Centric Settlement with the SCB 3.4B atomic RPC, and pointing to the authoritative docs. Body left intact as a historical record. |
| `docs/BILLING_SAFETY.md` | Stale living-as-current review | Added an **OUTDATED (pre-SCB-3.0 model)** banner explaining the per-minute tick safety analysis no longer applies, that SCB 3.4B's atomic RPC + claim guard + `idempotency_key` + in-RPC CAS resolve the double-charge / lost-update / partial-commit risks analysed herein, and pointing to the authoritative docs. Body left intact as a historical record. |
| `docs/ARCHITECTURE_LOCK.md` | Living architecture lock doc | Updated the **Settlement** core-domain entry to list both `settlement.js` and the `settle_session_transaction` RPC, describe the JS-orchestrates / RPC-writes division, and link the SCB 3.4B completion report. Added an **SCB 3.4B** row to the Implementation Completion table and noted it is an allowed atomicity refactor within Architecture 2.0. |
| `docs/ARCHITECTURE_VERSION.md` | Living architecture version doc | Added a **Post-Freeze Refinements (Architecture 2.0)** section recording SCB 3.4B (settlement transaction atomicity, W2–W7 → RPC) as an allowed refactor within 2.x, with links to the frozen specs and completion report. Explicitly stated SCB 3.4B does **not** trigger Architecture 3.0. Architecture version remains 2.0. |

# Obsolete references removed

No body content was deleted from the two stale billing reviews
(`BILLING_LOGIC_REVIEW.md`, `BILLING_SAFETY.md`). Instead, a deprecation
banner was applied and the body was preserved as a historical record (per
rule 3 — leave historical content intact unless explicitly living). The
banners neutralise the obsolete references by explicitly marking the
described functions as removed and redirecting to the current architecture
authorities.

The following obsolete attributions were corrected in living docs:

- `docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md` §6.3 — "Commit: Cập nhật
  `hours_used` / grant / wallet + wallet_transaction (hourly)" → now
  attributes the commit to the atomic `settle_session_transaction()` RPC
  (W2–W7).
- `docs/ARCHITECTURE_LOCK.md` Settlement entry — "Sole entitlement writer"
  → now describes JS orchestration + RPC atomic writes.
- `src/lib/gpu/settlement.js` header — "Sole entitlement writer for
  session consumption" → now describes JS orchestration + RPC as the
  writer.

# Remaining historical references

These documents still mention `deductHoursFromInventoryPlan`,
`chargeWalletForSession`, or `commitSettlementLines`, and are **intentionally
left untouched** per rule 3 ("Leave historical reports untouched unless they
are explicitly marked as living documentation"):

| File | Why left untouched |
|------|--------------------|
| `docs/IMPLEMENTATION_REPORT_M6.md` | Historical milestone report (M6). Describes the M6 transition: removing `applyBillingDeduction` / `deductHoursFromInventoryPlan` / `chargeWalletForHours` from `billing.js` and moving logic to `settlement.js` as `chargeWalletForSession`. Accurate as a point-in-time M6 record. Not living documentation. |
| `docs/SESSION_BASED_BILLING_FEASIBILITY.md` | Feasibility study (draft). Per `ARCHITECTURE_VERSION.md`, draft/review/feasibility documents do not override Architecture 2.0. Historical. |
| `docs/scb/SCB_3_4B_TECH_DEBT.md` | The tech debt register itself; its references to the removed helpers are descriptive (listing what is deferred). Self-reference, not a production-implementation claim. |

No other document in the repository references `deductHoursFromInventoryPlan`,
`commitSettlementLines`, or `chargeWalletForSession` as the **production
settlement implementation**. The two previously-stale living reviews now carry
deprecation banners explicitly stating those functions are removed.

# Verification summary

## Task 1 — Update every live document identified in SCB_3_4B_TECH_DEBT.md

| Tech-debt item | Status |
|----------------|--------|
| `docs/BILLING_LOGIC_REVIEW.md` | Updated (deprecation banner + pointer to SCB 3.4B). On inspection, this doc describes the entirely-removed pre-SCB-3.0 per-minute tick model (the referenced functions no longer exist in `billing.js`), so a banner was applied rather than a surgical line edit to avoid creating an inconsistent half-rewritten doc. |
| `docs/BILLING_SAFETY.md` | Updated (deprecation banner + pointer to SCB 3.4B). Same rationale as above. |
| `docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md` §6 | Updated (§6.3 rewritten to reference the atomic RPC). |
| `src/lib/gpu/settlement.js` header comment | Updated (comment-only; no executable code changed). |
| `docs/scb/SCB-ARCHITECTURE.md` | Updated (new §1.4 referencing SCB 3.4B). |
| `docs/ARCHITECTURE_VERSION.md` / `docs/ARCHITECTURE_LOCK.md` | Updated (SCB 3.4B recorded as an allowed Architecture 2.0 refinement; Settlement core-domain entry updated). |

## Task 2 — Replace references to the old client-side settlement flow

Replaced/neutralised in living docs, with the new architecture described via:
`settle_session_transaction()`, W2–W7 atomic transaction, JS pre/post
responsibilities (JS = business math + orchestration; RPC = pure atomic
executor), replay boundary (= one RPC call), CAS location (inside the RPC,
W5), and projection-sync location (inside the RPC, W6).

## Task 3 — Historical reports

`docs/IMPLEMENTATION_REPORT_M6.md`, `docs/SESSION_BASED_BILLING_FEASIBILITY.md`,
and the other M-implementation reports / plans were left untouched (historical,
not living documentation).

## Task 4 — No remaining references to removed helpers as the production implementation

Verified by repository-wide grep for
`deductHoursFromInventoryPlan|commitSettlementLines|chargeWalletForSession`
across `docs/**/*.md`:

- No **live** document presents any of these as the current production
  settlement implementation.
- The two previously-stale living reviews now carry deprecation banners.
- The only remaining mentions are in: the tech-debt register (self-reference),
  the M6 historical report, and a feasibility draft — all explicitly out of
  scope per rule 3.

## No production behaviour change

- The only `src/` file edited was `src/lib/gpu/settlement.js`, and only its
  header comment block was rewritten.
- Linter: 0 errors on `src/lib/gpu/settlement.js`.
- Tests: `settlement.test.mjs` + `settlement-transaction-rpc.test.mjs` →
  22/22 pass.
- No SQL, no tests, no transaction behaviour modified.

# Final status

PASS
