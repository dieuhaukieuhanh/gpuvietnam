import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  incrementHoursUsedCas,
  INCREMENT_TABLE,
} from './entitlement-increment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Thenable-chain mock with a live `hours_used` value and an optional
 * `beforeUpdate(attempt, currentLive)` hook that can mutate the live value
 * just before an UPDATE is evaluated (simulating a concurrent writer).
 *
 * CAS success is decided server-side-style: the UPDATE returns a row iff the
 * `hours_used` filter sent by the caller equals the mock's current live value.
 * This faithfully models PostgREST applying `WHERE hours_used = <sent>`.
 *
 * Query shapes:
 *   from(table).select('hours_used').eq('id',id).maybeSingle()         -> {data:{hours_used}, error}
 *   from(table).update({hours_used}).eq('id',id).eq('hours_used',cur)
 *       .select('id, hours_used').maybeSingle()                        -> {data:{id,hours_used}|null, error}
 *
 * @param {{
 *   live?: number;
 *   beforeUpdate?: (attempt: number, currentLive: number) => void;
 * }} cfg
 */
function makeClient(cfg = {}) {
  let live = cfg.live ?? 0;
  const selects = [];
  const updates = [];
  const supabaseAdmin = {
    from(table) {
      let isUpdate = false;
      let patch = null;
      const filters = {};
      const chain = {
        update(p) { isUpdate = true; patch = p; return chain; },
        select(_cols) { return chain; },
        eq(col, val) { filters[col] = val; return chain; },
        maybeSingle() {
          if (isUpdate) {
            const id = String(filters.id);
            const sentCurrent = filters.hours_used;
            if (cfg.beforeUpdate) cfg.beforeUpdate(updates.length + 1, live);
            const casOk = sentCurrent === live; // server-side guard evaluation
            updates.push({
              table,
              patch: { ...patch },
              filters: { ...filters },
              sentCurrent,
              liveAtUpdate: live,
              casOk,
            });
            if (casOk) {
              live = patch.hours_used;
              return Promise.resolve({ data: { id, hours_used: patch.hours_used }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          selects.push({ table, filters: { ...filters }, returnedLive: live });
          return Promise.resolve({ data: { hours_used: live }, error: null });
        },
      };
      return chain;
    },
  };
  return { supabaseAdmin, selects, updates, getLive: () => live };
}

describe('incrementHoursUsedCas (SCB 3.3A — atomic entitlement increment)', () => {
  it('happy path: single read + single guarded write, no contention', async () => {
    const { supabaseAdmin, selects, updates, getLive } = makeClient({ live: 10 });
    const res = await incrementHoursUsedCas(
      supabaseAdmin,
      INCREMENT_TABLE.MANUAL_HOUR_GRANTS,
      'g1',
      2,
    );

    assert.equal(res.attempts, 1);
    assert.equal(res.finalHoursUsed, 12);
    assert.equal(getLive(), 12);
    assert.equal(selects.length, 1, 'one read on the happy path');
    assert.equal(updates.length, 1, 'one write on the happy path');

    // CAS guard present: WHERE id AND hours_used = <read value>.
    assert.equal(updates[0].filters.id, 'g1');
    assert.equal(updates[0].filters.hours_used, 10, 'CAS guard uses the read value');
    assert.equal(updates[0].patch.hours_used, 12);
    assert.equal(updates[0].casOk, true);
  });

  it('NO LOST UPDATE: concurrent writer bumps hours_used between read and write', async () => {
    // Simulate T2 (concurrent settlement) committing +2h between T1's read and
    // T1's first write. Old code would overwrite T2's +2 (lost update). CAS
    // detects the stale read, re-reads the new value, and applies T1's +3 on
    // top of T2's result -> final = 10 + 2 + 3 = 15.
    const mock = makeClientLive({
      initial: 10,
      beforeUpdate: (attempt, getLive, setLive) => {
        if (attempt === 1) setLive(12); // T2 commits +2 just before T1's first UPDATE
      },
    });

    const res = await incrementHoursUsedCas(
      mock.supabaseAdmin,
      INCREMENT_TABLE.MANUAL_HOUR_GRANTS,
      'g1',
      3, // T1's deduction
    );

    // Final live = 15 (10 + T2's 2 + T1's 3). Old lost-update code would be 13.
    assert.equal(mock.getLive(), 15, 'concurrent +2 preserved (no lost update)');
    assert.equal(res.attempts, 2, 'CAS retried once after detecting contention');
    assert.equal(res.finalHoursUsed, 15);

    // First UPDATE CAS-failed (sent 10, live had become 12); second succeeded.
    assert.equal(mock.updates[0].casOk, false, 'first write rejected by CAS guard');
    assert.equal(mock.updates[0].sentCurrent, 10);
    assert.equal(mock.updates[1].casOk, true, 'second write succeeded after re-read');
    assert.equal(mock.updates[1].sentCurrent, 12);
    assert.equal(mock.updates[1].patch.hours_used, 15);
    assert.equal(mock.selects.length, 2, 're-read after CAS failure');
  });

  it('roundHours semantics: result rounded to 2 decimals', async () => {
    const { supabaseAdmin, updates } = makeClient({ live: 1.125 });
    const res = await incrementHoursUsedCas(
      supabaseAdmin,
      INCREMENT_TABLE.SUBSCRIPTIONS,
      's1',
      0.005,
    );
    // roundHours(1.125 + 0.005) = roundHours(1.13) = 1.13
    assert.equal(res.finalHoursUsed, 1.13);
    assert.equal(updates[0].patch.hours_used, 1.13);
  });

  it('routes to the correct table per INCREMENT_TABLE', async () => {
    const grantMock = makeClient({ live: 5 });
    await incrementHoursUsedCas(grantMock.supabaseAdmin, INCREMENT_TABLE.MANUAL_HOUR_GRANTS, 'g1', 1);
    assert.equal(grantMock.updates[0].table, 'manual_hour_grants');

    const subMock = makeClient({ live: 5 });
    await incrementHoursUsedCas(subMock.supabaseAdmin, INCREMENT_TABLE.SUBSCRIPTIONS, 's1', 1);
    assert.equal(subMock.updates[0].table, 'subscriptions');
  });

  it('rejects disallowed tables (whitelist)', async () => {
    const { supabaseAdmin } = makeClient({ live: 5 });
    await assert.rejects(
      () => incrementHoursUsedCas(supabaseAdmin, 'users', 'u1', 1),
      /disallowed table 'users'/,
    );
  });

  it('CAS exhaustion after maxAttempts -> throws (no silent under-deduction)', async () => {
    // Persistent contention: a concurrent writer bumps live before EVERY write,
    // so the CAS guard never matches.
    const mock = makeClientLive({
      initial: 10,
      beforeUpdate: (attempt, getLive, setLive) => setLive(getLive() + 100), // always mutate
    });
    await assert.rejects(
      () => incrementHoursUsedCas(mock.supabaseAdmin, INCREMENT_TABLE.MANUAL_HOUR_GRANTS, 'g1', 2, { maxAttempts: 3 }),
      /gave up after 3 attempts/,
    );
    assert.equal(mock.updates.length, 3, 'exactly maxAttempts writes — no infinite loop');
  });

  it('DB read error propagates (not swallowed)', async () => {
    const supabaseAdmin = {
      from(table) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          maybeSingle() { return Promise.resolve({ data: null, error: { message: 'read boom' } }); },
        };
        return chain;
      },
    };
    await assert.rejects(
      () => incrementHoursUsedCas(supabaseAdmin, INCREMENT_TABLE.MANUAL_HOUR_GRANTS, 'g1', 1),
      /read boom/,
    );
  });
});

describe('settlement.js SCB 3.4 routing / CAS regression (source-string)', () => {
  // SCB 3.4 moves the W2–W7 write sequence (including the entitlement CAS)
  // into the server-side RPC `settle_session_transaction`. The JS-side CAS
  // helper `incrementHoursUsedCas` is retained (SCB 3.4 §4 "CAS remains")
  // but is no longer invoked from the settlement path; the CAS now happens
  // inside T, server-side, with the JS-read `expected_hours_used` as the
  // guard value. These regressions verify the SCB 3.4 architecture holds.
  const settleSource = readFileSync(join(__dirname, 'settlement.js'), 'utf8');
  const rpcSource = readFileSync(join(__dirname, 'settlement-transaction-rpc.js'), 'utf8');

  it('settlement.js invokes the server-side transaction RPC (SCB 3.4A §5)', () => {
    assert.ok(
      settleSource.includes('executeSettlementTransaction'),
      'settlement.js must call executeSettlementTransaction (the RPC wrapper)',
    );
    assert.ok(
      settleSource.includes("from './settlement-transaction-rpc.js'"),
      'settlement.js imports the RPC wrapper module',
    );
  });

  it('settlement.js no longer contains the old W2–W7 client-side write helpers', () => {
    // SCB 3.4 retires the non-atomic JS write sequence. These helpers were
    // the pre-3.4 W2–W7 implementation and must be gone from settlement.js.
    assert.ok(!settleSource.includes('function commitSettlementLines'), 'commitSettlementLines removed');
    assert.ok(!settleSource.includes('function chargeWalletForSession'), 'chargeWalletForSession removed');
    assert.ok(!settleSource.includes('function deductHoursFromInventoryPlan'), 'deductHoursFromInventoryPlan removed');
    assert.ok(!settleSource.includes('resolveSyncInventory'), 'resolveSyncInventory removed (projection sync is now server-side in T)');
  });

  it('OLD unguarded SELECT-hours_used + JS-add pattern is GONE for manual_hour_grants', () => {
    assert.ok(
      !/from\('manual_hour_grants'\)[\s\S]*?select\('hours_used'\)[\s\S]*?\.single\(\)/.test(settleSource),
      'no unguarded SELECT hours_used .single() on manual_hour_grants remains',
    );
    assert.ok(
      !/Number\(grant\?\.hours_used[\s\S]*?\+ hours\)/.test(settleSource),
      'no JS-side `Number(grant?.hours_used ...) + hours` compute-then-overwrite remains',
    );
  });

  it('OLD unguarded SELECT-hours_used + JS-add pattern is GONE for subscriptions', () => {
    assert.ok(
      !/from\('subscriptions'\)[\s\S]*?select\('hours_used'\)[\s\S]*?\.single\(\)/.test(settleSource),
      'no unguarded SELECT hours_used .single() on subscriptions remains',
    );
    assert.ok(
      !/Number\(subscription\?\.hours_used[\s\S]*?\+ hours\)/.test(settleSource),
      'no JS-side `Number(subscription?.hours_used ...) + hours` compute-then-overwrite remains',
    );
  });

  it('RPC wrapper routes grant_id → manual_hour_grants and subscription_id → subscriptions (SCB 3.4A §3)', () => {
    // The routing now lives in resolveEntitlementTarget (settlement-transaction-rpc.js).
    assert.ok(
      /grantId[\s\S]*?table:\s*'manual_hour_grants'/.test(rpcSource),
      'grant-backed lines route to manual_hour_grants',
    );
    assert.ok(
      /subscriptionId[\s\S]*?table:\s*'subscriptions'/.test(rpcSource),
      'subscription-backed lines route to subscriptions',
    );
  });

  it('RPC payload carries expected_hours_used as the CAS guard value (SCB 3.4A §3/§4)', () => {
    assert.ok(
      rpcSource.includes('expected_hours_used'),
      'entitlement lines carry expected_hours_used for the server-side CAS',
    );
    assert.ok(
      settleSource.includes('expectedPreSettlementStatus'),
      'settlement.js passes expected_pre_settlement_status to the RPC claim guard',
    );
  });

  it('wallet charge is clamped to balance (preserves legacy Math.min(balance, charge))', () => {
    assert.ok(
      rpcSource.includes('Math.min'),
      'RPC wrapper preserves the wallet-charge clamp (cannot drive balance negative)',
    );
  });
});

/**
 * Variant mock whose `beforeUpdate` can mutate the SAME live variable the
 * chain reads, via getLive/setLive accessors. Used for the contention test.
 *
 * @param {{
 *   initial: number;
 *   beforeUpdate?: (attempt: number, getLive: () => number, setLive: (n: number) => void) => void;
 * }} cfg
 */
function makeClientLive(cfg) {
  let live = cfg.initial;
  const selects = [];
  const updates = [];
  const getLive = () => live;
  const setLive = (n) => { live = n; };
  const supabaseAdmin = {
    from(table) {
      let isUpdate = false;
      let patch = null;
      const filters = {};
      const chain = {
        update(p) { isUpdate = true; patch = p; return chain; },
        select(_cols) { return chain; },
        eq(col, val) { filters[col] = val; return chain; },
        maybeSingle() {
          if (isUpdate) {
            const id = String(filters.id);
            const sentCurrent = filters.hours_used;
            if (cfg.beforeUpdate) cfg.beforeUpdate(updates.length + 1, getLive, setLive);
            const casOk = sentCurrent === live;
            updates.push({ table, patch: { ...patch }, filters: { ...filters }, sentCurrent, liveAtUpdate: live, casOk });
            if (casOk) {
              live = patch.hours_used;
              return Promise.resolve({ data: { id, hours_used: patch.hours_used }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          selects.push({ table, filters: { ...filters }, returnedLive: live });
          return Promise.resolve({ data: { hours_used: live }, error: null });
        },
      };
      return chain;
    },
  };
  return { supabaseAdmin, selects, updates, getLive };
}
