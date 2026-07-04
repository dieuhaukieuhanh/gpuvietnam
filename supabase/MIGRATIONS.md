# GPUVietnam — SQL Migration System (RC1)

A deterministic, production-safe migration system for the `supabase/` SQL files.
It introduces ordering, a tracking ledger, a version marker, and a runner —
**without merging, rewriting, or altering any existing SQL file**. Existing
databases remain upgradeable.

> Scope: DevOps / deployment plumbing only. No business logic, settlement
> behaviour, lifecycle behaviour, or transaction semantics are changed.

---

## 1. Components

| File | Role |
|---|---|
| `supabase/MIGRATION_MANIFEST.json` | Machine-readable canonical order + dependency graph + category per file. Source of truth for the runner. |
| `supabase/0000_schema_migrations.sql` | Bootstrap: creates `public.schema_migrations` (the applied-migration ledger). |
| `supabase/0099_sc_schema_version.sql` | Version marker: `public.schema_version` single-row table + `public.sc_schema_verification` readiness view; recomputes `scb_3_4b_ready` from the Postgres catalog. |
| `supabase/verify-sc-schema.sql` | Human-facing read-only verification checklist (sections A–F). |
| `scripts/run-migrations.mjs` | Runner. Applies pending migrations in order, records each, supports baseline / dry-run / list / only / verify / include-seeds. |

No existing `.sql` file was modified, merged, renamed, or moved. The two new
`0000_*` / `0099_*` files are additive and run first / last respectively.

---

## 2. SQL dependency graph

Edges are "must run before". The canonical order in `MIGRATION_MANIFEST.json`
(`applied_order`) is a topological sort of this graph.

```
auth.users (Supabase built-in)
   │
   ├─ 0001 schema.sql ─┬─ 0002 add-user-role.sql
   │                   ├─ 0003 add-updated-at.sql
   │                   ├─ 0005 subscriptions.sql ─── 0015 plan-renew-requests.sql
   │                   ├─ 0006 storage-upgrades.sql          (users.wallet_balance)
   │                   ├─ 0007 user-settings.sql ── 0008 wallet-deposit-status.sql
   │                   │        (wallet_transactions, user_settings)
   │                   ├─ 0010 models.sql
   │                   ├─ 0011 workflows.sql
   │                   ├─ 0012 storage.sql
   │                   ├─ 0014 notifications.sql
   │                   ├─ 0016 support-sessions.sql
   │                   ├─ 0017 admin-machine-logs.sql
   │                   ├─ 0018 backup-logs.sql
   │                   ├─ 0019 machines.sql ──┬─ 0021 gpu-sessions.sql ── 0022 machines-billing.sql
   │                   │                      ├─ 0023 machines-idle.sql
   │                   │                      └─ (0025 adds machines FKs)
   │                   ├─ 0020 user-plan-inventory.sql ─────┐
   │                   └─ 0024 hour-grants.sql               │
   │                                                            │
   │   0025 scb-schema.sql ◄── 0021, 0022, 0020 ──────────────┘
   │        (gpu_sessions SCB cols + CHECKs; machines.gpu_session_id FK;
   │         machines.billing_inventory_id FK → user_plan_inventory)
   │            │
   │            ├─ 0026 scb-schema-m5-finalize.sql
   │            └─ 0027 settle-session-transaction.sql ◄── 0005,0006,0007,0008,0020,0024,0025
   │                 (wallet_transactions.idempotency_key + partial uniq idx +
   │                  public.settle_session_transaction(json) SECURITY DEFINER)
   │                           │
   │                           └─ 0099 sc_schema_version.sql  (version marker + readiness)
   │
   ├─ 0028 infrastructure-reconciliation.sql ◄── 0019  (M13 reconciliation_runs + drift_items)
   │
   └─ 0004 drop-auth-trigger.sql        (independent of public schema)
   0009 gpu-pricing-config.sql          (independent)
   0013 storage-pricing.sql             (independent)

0000 schema_migrations.sql  (bootstrap; no deps; runs before everything)
```

**SCB 3.4B settlement critical path** (verified end-to-end):
`0001 → 0005/0006/0007+0008/0020/0024 → 0019 → 0021 → 0022 → 0025 → 0026 → 0027 → 0099`.

### SCB 3.4B requirements coverage (Requirement 7)

| Requirement | Provided by migration |
|---|---|
| `settle_session_transaction(json)` RPC function | `0027 settle-session-transaction.sql` |
| `wallet_transactions.idempotency_key` column | `0027` (ALTER TABLE ADD COLUMN IF NOT EXISTS) |
| `wallet_transactions_idempotency_key_uniq` partial unique index | `0027` (CREATE UNIQUE INDEX IF NOT EXISTS WHERE idempotency_key IS NOT NULL) |
| `gpu_sessions.settlement_status` claim-guard column + CHECK | `0025 scb-schema.sql` (+ narrowed by `0026`) |
| `users.wallet_balance` (W3 debit target) | `0006 storage-upgrades.sql` |
| `wallet_transactions` (W4 ledger target) | `0007 user-settings.sql` (+ `0008`) |
| `manual_hour_grants` / `subscriptions` (W5 CAS targets) | `0024` / `0005` |
| `user_plan_inventory` (W6 projection sync target) | `0020` |
| `gpu_sessions` (W2/W7) | `0021` (+ `0025` constraints) |

All nine are checked live by `public.sc_schema_verification` and gate the
`scb_3_4b_ready` flag in `public.schema_version`.

---

## 3. File categories

| Category | Count | Runner behaviour |
|---|---|---|
| `system` | 2 (`0000`, `0099`) | Applied by the runner (bootstrap + version marker). |
| `migration` | 28 | Applied once, in order, recorded in `schema_migrations`. |
| `seed` | 4 | Applied only with `--include-seeds` (dev/staging). Never in production. |
| `operational` | 1 (`storage-models.sql`) | One-shot storage-bucket/policy script. Manual SQL Editor. Not tracked. |
| `historical` | 5 | **Never applied** by the runner. Retained for audit history. |

### Historical files (do NOT apply)

| File | Reason |
|---|---|
| `scb-schema-apply-nodrop.sql` | Self-marked SUPERSEDED by `scb-schema.sql` (M2). |
| `scb-schema-started-at-nullable.sql` | Self-marked SUPERSEDED by `scb-schema.sql` (M2). |
| `fix-trigger.sql` | Duplicate of `drop-auth-trigger.sql` (both drop `on_auth_user_created`). `0004` is canonical. |
| `admin-approve-payment.sql` | One-shot operational snippet with placeholder `SUBSCRIPTION_ID`. Not a migration. |
| `set-admin-role.sql` | Operational role backfill UPDATE; the `role` column is added idempotently by `add-user-role.sql` (`0002`). |

---

## 4. Execution instructions

### Prerequisites

Add to `.env.local` (already gitignored):
```
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```
(Connection string: Supabase Dashboard → Project Settings → Database → URI.)

### Fresh database

```bash
npm run db:migrate:dry-run     # preview the plan (no changes)
npm run db:migrate             # apply 0000 → 0099 in order, record each
npm run db:verify              # read-only checklist; scb_3_4b_ready must be true
```

### Existing database (built manually before this system)

The database already has the schema but no `schema_migrations` ledger. Use
**baseline mode** to record the already-applied set without re-executing, then
apply anything newer:

```bash
# 1. Inspect what is present (read-only) — open SQL Editor, run sections A & F
#    of supabase/verify-sc-schema.sql, OR:
npm run db:migrate:list        # shows pending/applied (after bootstrap runs)

# 2. Baseline at the latest migration you know is already applied.
#    Example: production already has SCB 3.4B (0027) but not the version marker:
npm run db:migrate:baseline -- 0027
#    This records 0000..0027 as applied WITHOUT executing them.

# 3. Apply anything after the baseline:
npm run db:migrate             # applies 0099 (version marker) + any future migrations
npm run db:verify
```

If you are unsure which migrations an existing DB has applied, baseline at the
**last migration whose effect you can confirm** via `verify-sc-schema.sql`
sections C–E (e.g. if the RPC exists but M5 validation is uncertain, baseline
at `0025` then run `npm run db:migrate` to apply `0026`, `0027`, `0099`). All
`migration` entries are idempotent, so re-applying a missed one via `--only` is
safe: `npm run db:migrate -- --only 0026`.

### Other modes

```bash
npm run db:migrate:list                        # manifest + applied status (read-only)
node scripts/run-migrations.mjs --only 0027    # apply one migration + its prerequisites
node scripts/run-migrations.mjs --include-seeds  # also run seed-* (dev/staging only)
```

### Operator notes

- The runner aborts on the first failing migration and records nothing for it.
  Fix the cause and re-run — already-applied migrations are skipped.
- `0026 scb-schema-m5-finalize.sql` has a built-in PRE-CHECK that aborts if any
  legacy `gpu_sessions.status` row (`closing` / `interrupted` / `completed`)
  exists. Migrate those rows first (`completed → closed`, `interrupted → closed`,
  `closing → running|closed`) and re-run.
- Seeds (`seed-*`) are **not** for production. They `DELETE` then `INSERT`; only
  run them in dev/staging via `--include-seeds`.

---

## 5. Production verification checklist

Run `npm run db:verify` (or paste `supabase/verify-sc-schema.sql` into the
Supabase SQL Editor). Pass criteria:

- **Section A** — every `sc_schema_verification` row shows `present = true`.
- **Section B** — `schema_version.scb_3_4b_ready = true`, `version = SCB-3.4B-RC1`.
- **Section C** — exactly one `settle_session_transaction(json)` row,
  `security_definer = true`.
- **Section D** — `wallet_transactions_idempotency_key_uniq` index exists with
  predicate `WHERE (idempotency_key IS NOT NULL)`.
- **Section E** — `gpu_sessions_status_check` def =
  `CHECK (status IN ('pending','running','closed'))`, `convalidated = true`;
  `gpu_sessions_settlement_status_check` present.
- **Section F** — `schema_migrations` contains every id in `applied_order`
  (30 rows for a fully-migrated DB: `0000`..`0028` + `0099`).

The single go/no-go gate:
```sql
SELECT scb_3_4b_ready FROM public.schema_version WHERE id = 1;
-- must return true
```

---

## 6. Convergence proof (fresh DB vs existing DB)

**Claim:** a fresh database and a baseline-then-migrate existing database
produce the same final schema and the same `schema_migrations` ledger.

**Fresh path** `npm run db:migrate`:
1. Runner runs `0000` → creates `schema_migrations`, records `0000`.
2. Runner applies `0001..0027` in order, recording each.
3. Runner applies `0099` → creates `schema_version` + `sc_schema_verification`,
   upserts the version row with `scb_3_4b_ready` recomputed from the catalog
   (all prerequisites now present → `true`), records `0099`.
4. Final ledger: `{0000, 0001, …, 0027, 0099}`. Final schema: all 27 migrations'
   effects applied.

**Existing path** `npm run db:migrate:baseline -- 0027` then `npm run db:migrate`:
1. Baseline runs `0000` (creates `schema_migrations`), records `0000`, then
   records `0001..0027` **without executing** (the schema already reflects them).
2. `npm run db:migrate` reads the ledger, sees `0000..0027` applied, skips them,
   applies `0099` (the only pending migration), records it.
3. Final ledger: `{0000, 0001, …, 0027, 0099}`. Final schema: unchanged from
   step 1 plus `0099`'s `schema_version` table + readiness view.

Both paths end with:
- identical `schema_migrations` ledger (same id set),
- identical final schema (same objects, since every `migration` entry is
  idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE OR REPLACE FUNCTION`, `DO $$ … EXCEPTION WHEN duplicate_object`),
- `schema_version.version = 'SCB-3.4B-RC1'` and `scb_3_4b_ready = true`.

**Idempotency is what makes baseline safe**: even if the baseline target is
set too low (a migration was actually already applied but not baselined), the
subsequent `npm run db:migrate` re-applies it idempotently — no duplicate
objects, no data loss, no error. The only non-idempotent files (`seed-*`,
`admin-approve-payment.sql`, `set-admin-role.sql`) are excluded from the
runner's auto-apply path, so they cannot be double-applied by mistake.

---

## 7. Adding a future migration

1. Place the new SQL file in `supabase/` (e.g. `scb-schema-m15-foo.sql`).
   Keep it idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / `DO $$…EXCEPTION`).
2. Add one entry to `supabase/MIGRATION_MANIFEST.json` `applied_order` with the
   next free id (e.g. `0028`), before `0099`. Declare `depends_on`.
3. `npm run db:migrate:dry-run` to verify ordering, then `npm run db:migrate`.

The `0099` version marker stays last by convention; its id leaves the
`0030–0098` range free for future schema migrations.
