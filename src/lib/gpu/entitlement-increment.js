/**
 * SCB 3.3A — Atomic entitlement increment via compare-and-swap (CAS).
 *
 * Target fields (audit Occurrence A & B):
 *   - manual_hour_grants.hours_used
 *   - subscriptions.hours_used
 *
 * Why CAS and not `SET hours_used = hours_used + ?`:
 *   The codebase's only DB interface is `@supabase/supabase-js` v2 builder
 *   (`src/lib/supabase-admin.js`). PostgREST PATCH only accepts literal
 *   values — there is no escape hatch to make it evaluate a column expression
 *   like `hours_used + ?`. A true server-side atomic increment would require
 *   either a Postgres RPC (`supabaseAdmin.rpc(...)`) or a raw `pg` client +
 *   `DATABASE_URL` — both explicitly out of scope for Task 3.3A ("Do NOT
 *   introduce RPC", "Do NOT modify SQL", no new deps/env).
 *
 * How CAS eliminates the lost-update race:
 *   1. SELECT hours_used (the "expected" value).
 *   2. UPDATE … SET hours_used = roundHours(expected + hours)
 *        WHERE id = ? AND hours_used = expected        ← CAS guard
 *      PostgREST applies the guard server-side; if a concurrent writer changed
 *      hours_used between our read and write, 0 rows match and `.maybeSingle()`
 *      returns null.
 *   3. On null, re-read (the value is now whatever the concurrent writer left)
 *      and retry. The retry converges because the contended window is tiny and
 *      settlement volumes are low; a bounded retry caps it.
 *
 *   The old code did `SELECT hours_used → JS add → UPDATE WHERE id=?` with no
 *   guard, so two concurrent settlements both read the same value, both added,
 *   and the second write silently erased the first → undercharging. The CAS
 *   guard makes that impossible: a stale read can never overwrite a fresher
 *   value.
 *
 * Node-testable: no `@/lib` imports.
 */

/** Tables this helper is authorised to increment (whitelist). */
export const INCREMENT_TABLE = Object.freeze({
  MANUAL_HOUR_GRANTS: 'manual_hour_grants',
  SUBSCRIPTIONS: 'subscriptions',
});

const ALLOWED_TABLES = new Set(Object.values(INCREMENT_TABLE));

const DEFAULT_MAX_CAS_ATTEMPTS = 5;

/**
 * roundHours parity with settlement.js — round to 2 decimals.
 * @param {number} value
 */
function roundHours(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Atomically add `hours` to `table.hours_used` for the row identified by `id`,
 * using compare-and-swap. `hours` MUST be > 0 (the caller's `hours <= 0`
 * early-return guard is preserved in `deductHoursFromInventoryPlan`).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} table  must be one of INCREMENT_TABLE
 * @param {string|number} id
 * @param {number} hours   positive hours to add
 * @param {{ maxAttempts?: number }} [options]
 * @returns {Promise<{ attempts: number, finalHoursUsed: number }>}
 * @throws {Error} on DB error, disallowed table, or CAS exhaustion
 */
export async function incrementHoursUsedCas(supabaseAdmin, table, id, hours, options = {}) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`incrementHoursUsedCas: disallowed table '${table}'`);
  }
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_CAS_ATTEMPTS;

  let lastRead = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data: row, error: readError } = await supabaseAdmin
      .from(table)
      .select('hours_used')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(readError?.message ?? 'incrementHoursUsedCas: read failed');

    const current = Number(row?.hours_used ?? 0);
    lastRead = current;
    const next = roundHours(current + hours);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from(table)
      .update({ hours_used: next })
      .eq('id', id)
      .eq('hours_used', current) // CAS guard — fails (0 rows) if a concurrent writer changed hours_used
      .select('id, hours_used')
      .maybeSingle();
    if (updateError) throw new Error(updateError?.message ?? 'incrementHoursUsedCas: update failed');

    if (updated) {
      return { attempts: attempt, finalHoursUsed: Number(updated.hours_used ?? next) };
    }
    // 0 rows → concurrent writer changed hours_used. Re-read and retry.
  }

  throw new Error(
    `incrementHoursUsedCas: gave up after ${maxAttempts} attempts on ${table} id=${String(id)} (last read hours_used=${lastRead})`,
  );
}
