import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOpsAlertEmail,
  isOpsAlertEnabled,
  shouldSendAlert,
  opsAlert,
  _resetOpsAlertDedupForTests,
} from './alert-dispatcher.js';

describe('ops alert-dispatcher', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    _resetOpsAlertDedupForTests();
    process.env.OPS_ALERT_EMAIL = 'dieuhaukieuhanh@gmail.com';
    process.env.OPS_ALERT_ENABLED = 'true';
    process.env.OPS_ALERT_DEDUP_MS = '60000';
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
    _resetOpsAlertDedupForTests();
  });

  it('defaults ops email', () => {
    delete process.env.OPS_ALERT_EMAIL;
    delete process.env.ADMIN_NOTIFY_EMAIL;
    assert.equal(resolveOpsAlertEmail(), 'dieuhaukieuhanh@gmail.com');
  });

  it('respects enabled flag', () => {
    process.env.OPS_ALERT_ENABLED = 'false';
    assert.equal(isOpsAlertEnabled(), false);
  });

  it('dedupes by key within window', () => {
    const t0 = 1_000_000;
    assert.equal(shouldSendAlert('k1', t0), true);
    assert.equal(shouldSendAlert('k1', t0 + 1000), false);
    assert.equal(shouldSendAlert('k1', t0 + 61_000), true);
  });

  it('no-ops without RESEND_API_KEY', async () => {
    const r = await opsAlert({
      event: 'smoke',
      title: 'test',
      details: { ok: true },
    });
    assert.equal(r.sent, false);
    assert.equal(r.skipped, 'no_resend_key');
  });
});
