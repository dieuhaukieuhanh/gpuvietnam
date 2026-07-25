import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  createPendingSession,
  activateRunningSession,
  SESSION_ERROR_CODE,
  SESSION_STATUS,
} from './session-lifecycle.js';
import {
  RC6_SES1_LOG_TAG,
  countRunningSessionsForUser,
  noteIfSes1Blocked,
  withOtherRunningSessionCount,
} from './session-ses1-count.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-07-25T12:00:00.000Z';

/**
 * Mock that serves LIMIT-2 running lookups and records query shapes.
 * @param {{ runningIds?: string[], throwError?: { message: string } | null }} cfg
 */
function makeRunningCountClient(cfg = {}) {
  const queries = [];
  const runningIds = cfg.runningIds ?? [];
  const supabaseAdmin = {
    from(table) {
      const state = { table, filters: {}, limit: null };
      const chain = {
        select() {
          return chain;
        },
        eq(col, val) {
          state.filters[col] = val;
          return chain;
        },
        limit(n) {
          state.limit = n;
          return chain;
        },
        then(resolve, reject) {
          queries.push({
            table: state.table,
            filters: { ...state.filters },
            limit: state.limit,
          });
          if (cfg.throwError) {
            resolve({ data: null, error: cfg.throwError });
            return;
          }
          if (state.table === 'gpu_sessions' && state.filters.status === 'running') {
            const rows = runningIds.slice(0, state.limit ?? runningIds.length).map((id) => ({ id }));
            resolve({ data: rows, error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      // Make thenable for await
      chain[Symbol.toStringTag] = 'Promise';
      return chain;
    },
  };
  return { supabaseAdmin, queries };
}

describe('RC6 SES-1 adapter count (session-ses1-count)', () => {
  it('LIMIT 2 lookup returns 0 / 1 / 2 (not full COUNT)', async () => {
    const empty = makeRunningCountClient({ runningIds: [] });
    assert.equal(await countRunningSessionsForUser(empty.supabaseAdmin, 'u1'), 0);
    assert.equal(empty.queries[0].limit, 2);

    const one = makeRunningCountClient({ runningIds: ['s1'] });
    assert.equal(await countRunningSessionsForUser(one.supabaseAdmin, 'u1'), 1);

    const many = makeRunningCountClient({ runningIds: ['s1', 's2', 's3'] });
    assert.equal(await countRunningSessionsForUser(many.supabaseAdmin, 'u1'), 2);
    assert.equal(many.queries[0].limit, 2);
  });

  it('fails closed when DB lookup errors (never defaults to 0)', async () => {
    const { supabaseAdmin } = makeRunningCountClient({
      throwError: { message: 'db down' },
    });
    await assert.rejects(
      () => countRunningSessionsForUser(supabaseAdmin, 'u1'),
      (err) => err?.message === 'db down',
    );
  });

  it('behavioral: count=1 → CREATE_PENDING SES-1 ERROR (no second session)', async () => {
    const { supabaseAdmin, queries } = makeRunningCountClient({ runningIds: ['ghost-641'] });
    const { context, otherRunningSessionCount } = await withOtherRunningSessionCount(
      supabaseAdmin,
      'u1',
      { subscriptionActive: true, now: NOW },
    );
    assert.equal(otherRunningSessionCount, 1);
    assert.equal(queries.length, 1);

    const result = createPendingSession(
      { id: 'new-d390', userId: 'u1', machineId: 'm-new', created_at: NOW },
      context,
    );
    assert.equal(result.state, 'ERROR');
    assert.equal(result.code, SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS);
    assert.match(String(result.message), /SES-1/);
  });

  it('behavioral: load once — same context reused for create + activate (no second query)', async () => {
    const { supabaseAdmin, queries } = makeRunningCountClient({ runningIds: [] });
    const { context } = await withOtherRunningSessionCount(supabaseAdmin, 'u1', {
      subscriptionActive: true,
      providerRunningVerified: true,
      machineExists: true,
      now: NOW,
    });
    assert.equal(queries.length, 1);

    const pending = createPendingSession(
      { id: 'sess-ok', userId: 'u1', machineId: 'm1', created_at: NOW },
      context,
    );
    assert.equal(pending.state, 'OK');

    const activated = activateRunningSession(pending.session, context, {
      started_at: NOW,
      verified_running_at: NOW,
    });
    assert.equal(activated.state, 'OK');
    assert.equal(activated.session.status, SESSION_STATUS.RUNNING);
    assert.equal(queries.length, 1, 'activate must reuse context; no second LIMIT 2 query');
  });

  it('behavioral: count=1 → ACTIVATE_RUNNING SES-1 ERROR for pending', async () => {
    const pending = createPendingSession(
      { id: 'pend-1', userId: 'u1', machineId: 'm1', created_at: NOW },
      {
        subscriptionActive: true,
        otherRunningSessionCount: 0,
        providerRunningVerified: true,
        machineExists: true,
        now: NOW,
      },
    );
    assert.equal(pending.state, 'OK');

    const blocked = activateRunningSession(
      pending.session,
      {
        subscriptionActive: true,
        otherRunningSessionCount: 1,
        providerRunningVerified: true,
        machineExists: true,
        now: NOW,
      },
      { started_at: NOW, verified_running_at: NOW },
    );
    assert.equal(blocked.state, 'ERROR');
    assert.equal(blocked.code, SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS);
  });

  it('temporary INFO instrumentation fires on SES-1 block', () => {
    const lines = [];
    const original = console.info;
    console.info = (...args) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      noteIfSes1Blocked(
        'CREATE_PENDING',
        {
          state: 'ERROR',
          code: SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS,
          message: 'SES-1: user already has a running session',
        },
        { path: 'test', userId: 'u1', otherRunningSessionCount: 1 },
      );
    } finally {
      console.info = original;
    }
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(RC6_SES1_LOG_TAG));
    assert.ok(lines[0].includes('blocked second running session'));
    assert.ok(lines[0].includes('CREATE_PENDING'));
  });
});

describe('RC6 source invariant (session-start.js)', () => {
  const source = readFileSync(join(__dirname, 'session-start.js'), 'utf8');

  it('must not hardcode otherRunningSessionCount: 0', () => {
    assert.equal(
      source.includes('otherRunningSessionCount: 0'),
      false,
      'RC6 regression: adapter must not hardcode otherRunningSessionCount: 0',
    );
  });

  it('must wire withOtherRunningSessionCount after reuse / before Domain create-activate', () => {
    assert.ok(source.includes('withOtherRunningSessionCount'));
    assert.ok(source.includes('noteIfSes1Blocked'));
    assert.ok(
      source.includes("from './session-ses1-count.js'"),
      'openBillableSession / createProvisioningPendingSession must use SES-1 count helper',
    );
  });
});
