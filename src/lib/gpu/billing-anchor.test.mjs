import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveBillingAnchorFromRecords } from './billing-anchor-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MACHINE_ID = '33333333-3333-3333-3333-333333333333';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';

function runningMachine(overrides = {}) {
  return {
    id: MACHINE_ID,
    status: 'running',
    created_at: '2026-07-03T10:00:00.000Z',
    gpu_session_id: SESSION_ID,
    billing_started_at: null,
    ...overrides,
  };
}

function runningSession(overrides = {}) {
  return {
    id: SESSION_ID,
    machine_id: MACHINE_ID,
    status: 'running',
    started_at: '2026-07-03T10:00:05.000Z',
    ...overrides,
  };
}

describe('resolveBillingAnchorFromRecords', () => {
  it('uses machine billing_started_at when valid', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine({ billing_started_at: '2026-07-03T10:00:05.000Z' }),
      runningSession(),
    );
    assert.equal(anchor.startedAt, '2026-07-03T10:00:05.000Z');
    assert.equal(anchor.sessionId, SESSION_ID);
  });

  it('falls back to linked running session when billing_started_at is missing', () => {
    const anchor = resolveBillingAnchorFromRecords(runningMachine(), runningSession());
    assert.equal(anchor.startedAt, '2026-07-03T10:00:05.000Z');
    assert.equal(anchor.sessionId, SESSION_ID);
  });

  it('falls back when stale machine billing_started_at is rejected', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine({ billing_started_at: '2026-07-03T09:00:00.000Z' }),
      runningSession(),
    );
    assert.equal(anchor.startedAt, '2026-07-03T10:00:05.000Z');
    assert.equal(anchor.sessionId, SESSION_ID);
  });

  it('rejects epoch lifecycle sentinel on machine billing_started_at', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine({ billing_started_at: '1970-01-01T00:00:00.000Z' }),
      runningSession(),
    );
    assert.equal(anchor.startedAt, '2026-07-03T10:00:05.000Z');
  });

  it('returns null when only epoch lifecycle sentinel anchors exist', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine({ billing_started_at: '1970-01-01T00:00:00.000Z' }),
      runningSession({ started_at: '1970-01-01T00:00:00.000Z' }),
    );
    assert.equal(anchor.startedAt, null);
  });

  it('falls back to verified_running_at when started_at is corrupt', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine({ billing_started_at: '1970-01-01T00:00:00.000Z' }),
      runningSession({
        started_at: '1970-01-01T00:00:00.000Z',
        verified_running_at: '2026-07-03T10:00:05.000Z',
      }),
    );
    assert.equal(anchor.startedAt, '2026-07-03T10:00:05.000Z');
    assert.equal(anchor.sessionId, SESSION_ID);
  });

  it('accepts linked session via machine_id FK when timestamps would fail', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine({ created_at: '2026-07-03T12:00:00.000Z' }),
      runningSession({ started_at: '2026-07-03T10:00:05.000Z' }),
    );
    assert.equal(anchor.startedAt, '2026-07-03T10:00:05.000Z');
  });

  it('returns null when machine is not running', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine({ status: 'starting' }),
      runningSession(),
    );
    assert.equal(anchor.startedAt, null);
  });

  it('returns null when linked session is not running', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine(),
      runningSession({ status: 'pending' }),
    );
    assert.equal(anchor.startedAt, null);
  });

  it('F5 reload shape — running machine + running session resolves session started_at', () => {
    const anchor = resolveBillingAnchorFromRecords(
      runningMachine({ billing_started_at: null }),
      runningSession({ started_at: '2026-07-03T10:00:00.000Z' }),
    );
    assert.equal(anchor.startedAt, '2026-07-03T10:00:00.000Z');
  });
});

describe('FK fallback — read-path resilience for projection drift', () => {
  it('resolveBillingAnchor in billing.js queries gpu_sessions by machine_id FK when projection is missing', () => {
    const source = readFileSync(path.join(__dirname, 'billing.js'), 'utf8');
    assert.ok(
      source.includes(".eq('machine_id',"),
      'resolveBillingAnchor must query gpu_sessions by machine_id FK as fallback',
    );
    assert.ok(
      source.includes(".eq('status', 'running')"),
      'FK fallback must filter by status=running',
    );
  });

  it('loadActiveSessionRow in session-start.js supports machineId fallback parameter', () => {
    const source = readFileSync(path.join(__dirname, 'session-start.js'), 'utf8');
    assert.ok(
      source.includes('machineId = null') || source.includes('machineId=null'),
      'loadActiveSessionRow must accept optional machineId parameter',
    );
    assert.ok(
      source.includes(".eq('machine_id',"),
      'loadActiveSessionRow must query by machine_id FK when sessionId is missing',
    );
  });

  it('status projection passes machineId to loadActiveSessionRow for session-field fallback', () => {
    const source = readFileSync(
      path.join(__dirname, '..', 'machines-status-projection.js'),
      'utf8',
    );
    assert.ok(
      source.includes('activeMachine?.id ? String(activeMachine.id) : null'),
      'machines-status-projection must pass machine.id to loadActiveSessionRow for FK fallback',
    );
  });

  it('openBillableSession wraps linkMachineToBillingSession in non-fatal try/catch', () => {
    const source = readFileSync(path.join(__dirname, 'session-start.js'), 'utf8');
    assert.ok(
      source.includes('projection write failed (non-fatal, will self-heal on read)'),
      'openBillableSession must not fail session activation when projection write fails',
    );
  });

  it('openBillableSession W4 — writer-side FK reuse when machine.gpu_session_id is NULL', () => {
    const source = readFileSync(path.join(__dirname, 'session-start.js'), 'utf8');
    assert.ok(
      source.includes('reusedViaFkFallback'),
      'openBillableSession must reuse an existing running session via machine_id FK when projection is NULL',
    );
    assert.ok(
      source.includes("W4 writer-side FK reuse"),
      'openBillableSession must document the W4 FK fallback intent',
    );
  });

  it('openBillableSession skips activation until projection traffic-ready', () => {
    const source = readFileSync(path.join(__dirname, 'session-start.js'), 'utf8');
    assert.ok(
      source.includes('isProjectionTrafficReady'),
      'openBillableSession must gate on projection traffic-ready before verify',
    );
    assert.ok(
      source.includes("reason: 'traffic_not_ready'"),
      'openBillableSession must return traffic_not_ready skip reason',
    );
  });

  it('persistBillingAnchorIfDrifted self-heals both billing_started_at and gpu_session_id', () => {
    const source = readFileSync(path.join(__dirname, 'billing.js'), 'utf8');
    assert.ok(
      source.includes('async function persistBillingAnchorIfDrifted'),
      'persistBillingAnchorIfDrifted must exist for read-path self-heal',
    );
    assert.ok(
      source.includes('linkMachineToBillingSession'),
      'self-heal must use linkMachineToBillingSession to repair projection',
    );
  });
});
