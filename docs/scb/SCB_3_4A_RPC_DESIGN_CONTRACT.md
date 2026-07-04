SCB 3.4A — Settlement Transaction RPC Design
Status: Design contract. Implementation-independent. Source of truth: SCB 3.4 Specification Freeze (this session). Constraint: No SQL, no PL/pgSQL, no migrations, no code. RPC contract only. Consumer: SCB 3.4B (implementation).

1. RPC Name
Recommendation: settle_session_transaction

Why:

Matches the existing domain vocabulary (settleSession in JS, settlement_* columns, SETTLEMENT_* constants). Implementers and reviewers immediately map RPC ↔ JS function.
_transaction suffix distinguishes it from any future non-atomic helper and signals "this is the atomic boundary" — the same convention the spec uses (T).
Snake_case is the established convention for PostgREST-exposed functions in this codebase's planned surface.
Single, unambiguous name; no overloading (no settle_session_v2, no _inner variant). Revisions bump a version field inside the response, not the RPC name.
2. RPC Responsibility
The RPC is a pure transaction executor. It receives a fully-prepared settlement plan and applies it atomically, or rejects it atomically. It computes nothing.

The RPC DOES:

Open a transaction.
Re-validate the immutable preconditions the JS domain already checked (claim fence, idempotency guard).
Apply the supplied wallet debit, ledger insert, entitlement increments, projection sync, and settlement finalize — in that order.
Commit or roll back atomically.
Return a minimal result.
The RPC does NOT:

calculate billing or billable seconds
calculate entitlement allocation or plan ordering
compute settlement_breakdown
call providers / Comfy / object storage
perform backup or notify
verify destroy
decide settlement eligibility
choose which plans to charge
pick wallet charge amount per line
compute charged_seconds, uncharged_seconds, cap_applied_seconds
All of the above remain in JS (settlement-core.js, settlement.js). The RPC trusts the JS-prepared payload but re-checks the fence (settlement_status transition guard) so a race with another settler cannot double-commit.

3. RPC Inputs
Single JSON argument (one PostgREST parameter, conventional for typed RPC payloads).

Field	Type	Required	Purpose
session_id
uuid
yes
Target gpu_sessions.id. Scoped key for the transaction.
user_id
uuid
yes
Owner check; scopes users and wallet_transactions writes. Must equal gpu_sessions.user_id.
provider_destroyed_verified
boolean
yes
Echoed precondition. RPC rejects if false. (JS has already enforced it; this is defence in depth.)
expected_pre_settlement_status
enum string
yes
One of pending or failed. RPC's claim guard requires settlement_status to equal this value before transitioning to in_progress. Prevents races with concurrent settlers and with reconciliation.
wallet_charge
object | null
no
If present, contains amount (integer > 0, VND), description (string, idempotency key), balance_after (integer, JS-computed expected post-debit balance). If absent or amount ≤ 0, RPC skips wallet debit and ledger insert.
entitlement_lines
array
no
Ordered list of entitlement debits. Each line: { table: 'manual_hour_grants' | 'subscriptions', id: uuid, hours: number > 0, expected_hours_used: number }. expected_hours_used is the CAS guard value JS read before the call. Empty array ⇒ no entitlement debit.
projection_sync
boolean
yes
If true, RPC invokes the existing syncUserPlanInventory equivalent server-side before finalize. If false, projection sync is deferred to JS post-commit (allowed fallback per §3 of the spec; default true).
settlement_breakdown
json
yes
The JS-computed breakdown blob written verbatim to gpu_sessions.settlement_breakdown at finalize. RPC does not interpret it.
settlement_at
timestamptz
yes
Single canonical timestamp for the settlement. Used for settlement_at, wallet_transactions.created_at (if RPC aligns), and users.updated_at. JS supplies new Date().toISOString().
idempotency_key
string
yes
Stable per-session key (e.g. settle:<session_id>). Used by the ledger dedup check and by any RPC-level dedup the implementation may add. Mandatory even if unused server-side, to keep the contract forward-compatible.
Notes:

wallet_charge.balance_after is JS's expected value. RPC may use it as a CAS guard on the users.wallet_balance UPDATE (defence in depth) or ignore it. Either way it is in the contract so implementers have the option without redesigning.
entitlement_lines[].expected_hours_used carries the CAS guard value. Inside T, CAS is concurrency defence in depth (per §4 of the spec); the primary guarantee is T's atomicity.
4. RPC Outputs
Minimal JSON response. Three top-level shapes.

Success / Idempotent
{
  state: 'OK' | 'IDEMPOTENT',
  session_id: uuid,
  settlement_status: 'settled',
  settlement_at: timestamptz,
  wallet_charged: integer,         // actual amount debited (0 if none)
  entitlement_consumed: [          // one entry per applied line
    { table: 'manual_hour_grants'|'subscriptions',
      id: uuid,
      hours: number,
      final_hours_used: number }
  ],
  projection_synced: boolean,
  attempts: { claim: integer, entitlement_lines: [integer] }  // optional, for observability
}
state='OK' — T committed this call.
state='IDEMPOTENT' — T had already committed for this session in a prior call; no writes performed this call; wallet_charged and entitlement_consumed reflect the prior commit (read back from ledger / breakdown) or 0/[] if not recoverable. JS treats both identically: settlement is terminal.
Recoverable Error (transaction rolled back, safe to retry)
{
  state: 'ERROR',
  code: 'CLAIM_LOST' | 'CLAIM_PRECONDITION' | 'CAS_EXHAUSTED'
        | 'WALLET_CAS' | 'LEDGER_CONFLICT' | 'PROJECTION_FAILED'
        | 'INTERNAL',
  message: string,
  rolled_back: true,               // always true for ERROR
  settlement_status: 'pending'|'failed'   // post-rollback observed value
}
rolled_back: true is contractual. Any ERROR means no partial financial state persists.
CLAIM_LOST — another settler won the claim. JS should re-read and return IDEMPOTENT-or-ERROR to its caller; do not blind-retry.
CLAIM_PRECONDITION — expected_pre_settlement_status did not match. JS should re-load session and decide.
CAS_EXHAUSTED / WALLET_CAS / LEDGER_CONFLICT — retryable after backoff.
PROJECTION_FAILED — T rolled back; safe to retry. (If projection sync is non-fatal by implementation choice, it would not appear here; default is fatal.)
INTERNAL — anything else; treat as retryable but log loudly.
Output deliberately excludes:
settlement_breakdown (JS already has it; it was an input).
billable_seconds, charged_seconds, cap_applied_seconds, uncharged_seconds (JS domain math).
wallet_balance final value (JS can read users if needed; RPC returns only what it debited).
Any provider/verify/machine data (out of scope).
5. Transaction Steps
Exact execution order inside T.

BEGIN
  1. CLAIM
     Re-read gpu_sessions row FOR UPDATE.
     Verify user_id matches input.user_id.
     Verify status IN ('closed','completed').
     Verify settlement_status = expected_pre_settlement_status.
     If any fail → ROLLBACK → return ERROR (CLAIM_LOST | CLAIM_PRECONDITION).
     UPDATE settlement_status='in_progress'.
  2. WALLET (only if wallet_charge present and amount > 0)
     Lock users row FOR UPDATE (by user_id).
     Optionally CAS: WHERE wallet_balance = wallet_charge.balance_after + amount
       (i.e. guard against concurrent debit).
     UPDATE users.wallet_balance = wallet_charge.balance_after,
            users.updated_at = settlement_at.
     INSERT wallet_transactions (
       user_id, type='payment', amount=wallet_charge.amount,
       bonus_amount=0, balance_after=wallet_charge.balance_after,
       description=wallet_charge.description, status='completed',
       created_at=settlement_at
     ).
     On ledger conflict (description dup) → ROLLBACK → return ERROR (LEDGER_CONFLICT).
  3. ENTITLEMENT (for each entitlement_lines entry, in order)
     Lock target row FOR UPDATE (manual_hour_grants.id OR subscriptions.id).
     CAS guard: WHERE hours_used = line.expected_hours_used.
     UPDATE hours_used = roundHours(line.expected_hours_used + line.hours).
     If CAS fails (0 rows):
        re-read, retry within T up to N (default 5).
        If still failing → ROLLBACK → return ERROR (CAS_EXHAUSTED).
     Record { table, id, hours, final_hours_used } for response.
  4. PROJECTION SYNC (only if projection_sync = true)
     Invoke the existing syncUserPlanInventory equivalent
       server-side (re-derive user_plan_inventory from
       subscriptions + manual_hour_grants for user_id).
     On failure → ROLLBACK → return ERROR (PROJECTION_FAILED).
  5. FINALIZE SETTLEMENT
     UPDATE gpu_sessions SET
       settlement_status='settled',
       settlement_at=settlement_at,
       settlement_breakdown=settlement_breakdown
     WHERE id=session_id AND settlement_status='in_progress'.
     If 0 rows (claim was stolen mid-T) → ROLLBACK → return ERROR (CLAIM_LOST).
COMMIT
return OK payload.
Step ordering rationale:

Claim first — establishes the in-T fence; nothing else runs if the claim is lost.
Wallet before entitlement — wallet has the simpler lock surface (one users row) and the most expensive mistake to leak (real money); committing it first inside T means a later entitlement failure rolls it back cleanly.
Entitlement after wallet — may iterate multiple lines; each is independently CAS-guarded.
Projection before finalize — so a projection failure rolls back the financial writes (atomicity guarantee for projection consistency per §3 of the spec).
Finalize last — its visibility is the commit signal; nothing else may write settlement_status='settled' until every other step succeeded.
6. Failure Behaviour
For every failure: T rolls back. No partial financial state persists. JS receives an ERROR payload with rolled_back: true.

Failure point	Trigger	T outcome	settlement_status after	JS receives	JS action
Claim lost
Another settler/reconciliation already moved settlement_status away from expected_pre_settlement_status between JS read and RPC claim
ROLLBACK
unchanged (pending or failed or now in_progress of rival)
ERROR CLAIM_LOST
Re-load session; if rival settled → treat as IDEMPOTENT; if still retryable → re-enter with fresh expected_pre_settlement_status
Claim precondition
user_id mismatch, status not in (closed, completed), or provider_destroyed_verified=false
ROLLBACK
unchanged
ERROR CLAIM_PRECONDITION
Abort settlement; surface to reconciliation
Wallet CAS
Concurrent debit changed wallet_balance between JS read and RPC
ROLLBACK
unchanged (pending/failed)
ERROR WALLET_CAS
Re-read balance, recompute wallet_charge, retry
Ledger conflict
wallet_transactions.description already exists for this user
ROLLBACK
unchanged
ERROR LEDGER_CONFLICT
Treat as possible prior committed T; re-load session; if settled → IDEMPOTENT; else investigate (potential duplicate)
Entitlement CAS exhausted
hours_used changed on every retry attempt within T (rare; requires contention with non-T writer)
ROLLBACK
unchanged
ERROR CAS_EXHAUSTED
Backoff + retry; if persistent, surface to operator (indicates a non-T writer is mutating hours_used)
Projection failure
syncUserPlanInventory server-side raises
ROLLBACK
unchanged
ERROR PROJECTION_FAILED
Retry; projection is convergent so retries are safe
Finalize 0 rows
Claim stolen between step 1 and step 5 (extremely unlikely under row lock)
ROLLBACK
unchanged
ERROR CLAIM_LOST
Same as Claim lost
Internal
Any uncaught exception / constraint violation
ROLLBACK
unchanged
ERROR INTERNAL
Log loudly; retry with backoff; surface to operator if persistent
Invariant: for every ERROR, rolled_back: true and the post-rollback settlement_status is one of pending, failed. Both are in SETTLEABLE_SETTLEMENT_STATUSES, so replay can re-enter the RPC.

7. Idempotency
Replay boundary: the transaction T (= the RPC call).

Pre-RPC state: settlement_status ∈ {pending, failed}. Both are settleable.
In-RPC: settlement_status transitions pending|failed → in_progress → settled entirely inside T. A crash mid-RPC (process killed, network drop between PostgREST and Postgres) leaves no committed in_progress; Postgres aborts the implicit transaction.
Post-RPC success: settlement_status='settled'. Any subsequent RPC call with the same session_id hits the claim guard (settlement_status ≠ expected_pre_settlement_status) and returns ERROR CLAIM_LOST. JS re-loads, sees settled, returns IDEMPOTENT upstream.
Duplicate RPC calls:

Two concurrent calls for the same session: the first wins the claim (UPDATE … WHERE settlement_status = expected returns 1 row under row lock); the second gets 0 rows → CLAIM_LOST. Exactly one T commits.
Two sequential calls (retry after JS-side timeout, but RPC actually committed): claim guard fails → CLAIM_LOST → JS re-loads → IDEMPOTENT. No double debit.
Same-process double-call (bug): same path; no double debit.
settlement_status participation:

It is the primary idempotency token. The claim guard WHERE settlement_status = expected_pre_settlement_status is what makes the RPC exactly-once.
The wallet-ledger description lookup is retained as defence in depth (per §6 of the spec) — it catches duplicate calls that bypass the claim guard (e.g. a future admin path). It is not the primary mechanism.
idempotency_key in the input is forward-compatible: implementations may use it for an RPC-level dedup table without redesigning the contract. Mandatory in the input even if unused initially.
8. Locking
Logical row locks acquired inside T, in acquisition order:

gpu_sessions row for session_id — FOR UPDATE at claim. Held until COMMIT. This is the primary serialization point per session; guarantees at most one active T per session_id.

users row for user_id — FOR UPDATE only if wallet_charge.amount > 0. Held until COMMIT. Serializes concurrent settlements per user on the wallet side. Bounded contention: one user, one row.

manual_hour_grants or subscriptions rows — one FOR UPDATE per entitlement_lines entry, locked in input order. Held until COMMIT. Serializes per-grant / per-subscription. Multiple sessions of the same user on different grants do not contend; multiple sessions on the same grant serialize (expected and correct).

user_plan_inventory rows for user_id — written during projection sync (step 4). Locks the user's projection rows until COMMIT. Acceptable because T already holds the users row lock; the projection lock is on the same logical serialization domain.

wallet_transactions — no row lock; protected by unique constraint on (user_id, description) (or by primary key if the implementation adds an idempotency_key column). Conflict manifests as LEDGER_CONFLICT, not as a lock wait.

Locking invariants:

All locks are acquired inside T and released at COMMIT/ROLLBACK. No lock spans an external call (no provider/Comfy/backup inside T — per spec §9).
Lock ordering is deterministic: gpu_sessions → users → entitlement rows → projection rows. This prevents deadlock between concurrent settlements for the same user (they acquire in the same order).
No table-level locks. No LOCK TABLE. Row-level only.
No advisory locks. The settlement_status claim guard is the fence; row locks provide isolation.
9. JS Responsibilities After RPC
The RPC's responsibility ends at COMMIT. JS (destroy-pipeline-run.js and settlement.js) remains responsible for everything else, in this order:

Pre-RPC (unchanged from spec §1, steps 1–8):

Resolve active machine
Backup before stop
Notify backup started
Collect session metrics
Provider pre-verify destroyed
Provider destroyInstance
Provider verify destroyed
Close session (W1)
Compute allocation, breakdown, lines (settlement-core.js)
Read users.wallet_balance and entitlement hours_used for CAS guard values
Assemble RPC payload
Post-RPC (unchanged from spec §1, steps 16–19):

W8 — finalizeGpuSession: write duration_seconds, vram_avg_pct, output_count, output_summary (idempotent overwrite)
W9 — clearMachineBillingFields: null out billing_started_at, gpu_session_id, billing_inventory_id (idempotent)
W10 — markMachineDestroyed: machines.status='destroyed', stopped_at, updated_at (idempotent)
W11 — markSubscriptionOffline: subscriptions.server_status='offline' (idempotent, and must be retry-reachable per spec §9 — fix the ALREADY_DESTROYED early-return skip)
Reconciliation paths (unchanged):

repairOrphanSession — closes orphan running sessions; no settlement, no RPC.
repairViaDestroyPipeline — re-enters runDestroyPipeline; reaches the RPC normally.
repairSettlementDrift — calls settleSession; reaches the RPC with expected_pre_settlement_status='failed'.
JS error handling for RPC response:

OK / IDEMPOTENT → proceed to post-RPC steps.
ERROR CLAIM_LOST → re-load session; if settled → return IDEMPOTENT; else retry with refreshed expected_pre_settlement_status.
ERROR CLAIM_PRECONDITION → abort; surface to reconciliation.
ERROR WALLET_CAS / CAS_EXHAUSTED / PROJECTION_FAILED / INTERNAL → backoff retry.
ERROR LEDGER_CONFLICT → re-load session; if settled → IDEMPOTENT; else escalate (possible duplicate).
10. Sequence Diagram
 ┌──────────────────────┐                ┌──────────────────────┐
 │         JS           │                │   PostgREST / RPC    │
 │ (settlement.js +     │                │ settle_session_      │
 │  destroy-pipeline)   │                │ transaction          │
 └──────────────────────┘                └──────────────────────┘
          │                                        │
          │  0. Resolve, backup, notify,           │
          │     collect metrics, destroy,          │
          │     verify destroyed, close session    │
          │     (all OUTSIDE T, JS-only or HTTP)   │
          │                                        │
          │  0a. Compute allocation + breakdown    │
          │      (settlement-core.js)              │
          │                                        │
          │  0b. Read users.wallet_balance,        │
          │      entitlement hours_used (for CAS)  │
          │                                        │
          │  ──── settle_session_transaction ────► │
          │       { session_id, user_id,           │
          │         provider_destroyed_verified,   │
          │         expected_pre_settlement_status,│
          │         wallet_charge,                 │
          │         entitlement_lines,             │
          │         projection_sync,               │
          │         settlement_breakdown,          │
          │         settlement_at,                 │
          │         idempotency_key }              │
          │                                        │
          │                              ╔════════════════════╗
          │                              ║   BEGIN TRANSACTION║
          │                              ║                    ║
          │                              ║  1. CLAIM          ║
          │                              ║     gpu_sessions   ║
          │                              ║     FOR UPDATE     ║
          │                              ║     status, user,  ║
          │                              ║     settlement_sts ║
          │                              ║     → in_progress  ║
          │                              ║                    ║
          │                              ║  2. WALLET         ║
          │                              ║     users FOR UPD  ║
          │                              ║     CAS optional   ║
          │                              ║     UPDATE balance ║
          │                              ║     INSERT ledger  ║
          │                              ║                    ║
          │                              ║  3. ENTITLEMENT    ║
          │                              ║     per line:      ║
          │                              ║       row FOR UPD  ║
          │                              ║       CAS guard    ║
          │                              ║       UPDATE h_used║
          │                              ║       retry ≤ N    ║
          │                              ║                    ║
          │                              ║  4. PROJECTION     ║
          │                              ║     syncUserPlan   ║
          │                              ║     Inventory srv  ║
          │                              ║                    ║
          │                              ║  5. FINALIZE       ║
          │                              ║     gpu_sessions   ║
          │                              ║     settled, _at,  ║
          │                              ║     breakdown      ║
          │                              ║     WHERE in_prog  ║
          │                              ║                    ║
          │                              ║      COMMIT        ║
          │                              ╚════════════════════╝
          │                                        │
          │  ◄──── { state:'OK',                  │
          │          session_id,                   │
          │          settlement_status:'settled',  │
          │          settlement_at,                │
          │          wallet_charged,               │
          │          entitlement_consumed:[...],   │
          │          projection_synced,            │
          │          attempts } ───────────────────│
          │                                        │
          │  W8. finalizeGpuSession                │
          │      (gpu_sessions usage UPDATE)       │
          │                                        │
          │  W9. clearMachineBillingFields         │
          │      (machines UPDATE)                 │
          │                                        │
          │  W10. markMachineDestroyed             │
          │       (machines UPDATE)                │
          │                                        │
          │  W11. markSubscriptionOffline          │
          │       (subscriptions UPDATE)           │
          │       (retry-reachable)                │
          │                                        │
          ▼                                        ▼
        done
Failure path (any step 1–5 raises):

          │                              ╔════════════════════╗
          │                              ║     ROLLBACK       ║
          │                              ╚════════════════════╝
          │  ◄──── { state:'ERROR',              │
          │          code:'CLAIM_LOST'|...        │
          │          message,                     │
          │          rolled_back:true,            │
          │          settlement_status:'pending'  │
          │          |'failed' } ─────────────────│
          │                                        │
          │  JS: re-load session, classify,        │
          │      retry / IDEMPOTENT / escalate     │
          ▼                                        ▼
End of SCB 3.4A design contract. No SQL, no PL/pgSQL, no migrations, no code, no patches produced. This document is the implementation input for SCB 3.4B.