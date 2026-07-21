import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  HOST_FAILURE_CATEGORY,
  classifyHostFailure,
} from './host-reputation-classify.js';
import {
  applyHostFailure,
  applyHostSuccess,
  applyTimeRecovery,
  createNeutralHostRecord,
  isHostBlacklisted,
  resolveBlacklistDurationMs,
  resolveLatencyBonus,
} from './host-reputation-score.js';
import { HOST_REPUTATION } from './host-reputation-config.js';
import {
  applyHostReputationToOffers,
  rememberHostFailure,
  rememberHostSuccess,
  resetHostReputationStoreForTests,
  resetHostReputationMetrics,
  getHostReputationMetrics,
  resolveCloreHostKey,
  resolveVastHostKey,
  buildHostReputationKey,
} from './index.js';

describe('host-reputation classify', () => {
  it('maps known failure categories', () => {
    assert.equal(classifyHostFailure('currency-not-allowed code 6'), HOST_FAILURE_CATEGORY.CURRENCY);
    assert.equal(classifyHostFailure('429 rate limit'), HOST_FAILURE_CATEGORY.RATE_LIMIT);
    assert.equal(classifyHostFailure('failed to pull image'), HOST_FAILURE_CATEGORY.IMAGE_PULL_FAILURE);
    assert.equal(classifyHostFailure('ComfyUI never healthy'), HOST_FAILURE_CATEGORY.HEALTH_FAILURE);
    assert.equal(classifyHostFailure('no mapped port endpoint'), HOST_FAILURE_CATEGORY.ENDPOINT_FAILURE);
    assert.equal(classifyHostFailure('code 1 database error'), HOST_FAILURE_CATEGORY.PROVIDER_INTERNAL);
    assert.equal(classifyHostFailure('ETIMEDOUT'), HOST_FAILURE_CATEGORY.NETWORK);
  });
});

describe('host-reputation score', () => {
  it('starts neutral and rewards READY success with optional latency bonus', () => {
    const base = createNeutralHostRecord('clore-host:1|rtx4090_1x', {
      provider: 'clore',
      hostId: '1',
      gpuLine: 'rtx4090_1x',
    });
    assert.equal(base.reputationScore, HOST_REPUTATION.neutralScore);
    const ok = applyHostSuccess(base, { readyLatencyMs: 45_000 });
    assert.ok(ok.newScore > ok.oldScore);
    assert.equal(ok.latencyBonus, HOST_REPUTATION.latencyBonusFast);
    assert.equal(ok.record.consecutiveFailures, 0);
    assert.equal(ok.record.blacklistUntil, null);
    assert.equal(resolveLatencyBonus(6 * 60 * 1000), 0);
  });

  it('penalizes health failures more than currency', () => {
    const base = createNeutralHostRecord('vast-host:9|rtx4090_1x', {
      provider: 'vast',
      hostId: '9',
      gpuLine: 'rtx4090_1x',
    });
    const health = applyHostFailure(base, { category: 'HEALTH_FAILURE', reason: 'comfy' });
    const currency = applyHostFailure(base, { category: 'CURRENCY', reason: 'code 6' });
    assert.ok(health.newScore < currency.newScore);
    assert.equal(resolveBlacklistDurationMs('CURRENCY', 1), 0);
    assert.ok(resolveBlacklistDurationMs('HEALTH_FAILURE', 1) > 0);
    assert.ok(isHostBlacklisted(health.record, Date.now()));
    assert.equal(isHostBlacklisted(currency.record, Date.now()), false);
  });

  it('escalates blacklist on repeated failures', () => {
    let rec = createNeutralHostRecord('clore-host:2|rtx4090_1x', {
      provider: 'clore',
      hostId: '2',
      gpuLine: 'rtx4090_1x',
    });
    rec = applyHostFailure(rec, { category: 'NETWORK', reason: 'timeout' }).record;
    const firstMs = Number(rec.blacklistUntil) - Date.now();
    rec = applyHostFailure(rec, { category: 'NETWORK', reason: 'timeout' }).record;
    const secondMs = Number(rec.blacklistUntil) - Date.now();
    assert.ok(secondMs >= firstMs);
  });

  it('recovers exponentially toward neutral', () => {
    const base = createNeutralHostRecord('clore-host:3|rtx4090_1x', {
      provider: 'clore',
      hostId: '3',
      gpuLine: 'rtx4090_1x',
    });
    const failed = applyHostFailure(base, {
      category: 'HEALTH_FAILURE',
      reason: 'comfy',
      now: 1_000_000,
    }).record;
    assert.equal(failed.reputationScore, 25);
    const hour1 = applyTimeRecovery(failed, 1_000_000 + 60 * 60 * 1000);
    assert.ok(hour1.newScore > 25 && hour1.newScore < 40);
    const hour2 = applyTimeRecovery(
      { ...failed, reputationScore: hour1.newScore, lastSeen: failed.lastSeen },
      1_000_000 + 2 * 60 * 60 * 1000,
    );
    assert.ok(hour2.newScore > hour1.newScore);
    assert.ok(hour2.newScore < HOST_REPUTATION.neutralScore);
    // asymptotic: never overshoots neutral from below
    const hour20 = applyTimeRecovery(
      { ...failed, reputationScore: 49, lastSeen: failed.lastSeen },
      1_000_000 + 20 * 60 * 60 * 1000,
    );
    assert.ok(hour20.newScore <= HOST_REPUTATION.neutralScore);
    assert.ok(hour20.newScore >= 49);
  });
});

describe('host-reputation selection', () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'host-rep-'));
    process.env.HOST_REP_STORE_FILE = join(dir, 'rep.json');
    resetHostReputationStoreForTests();
    resetHostReputationMetrics();
  });

  afterEach(() => {
    resetHostReputationStoreForTests();
    resetHostReputationMetrics();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('scopes keys by provider + host + gpuLine', () => {
    assert.equal(
      resolveVastHostKey({ machine_id: 42 }, 'rtx4090_1x'),
      'vast-host:42|rtx4090_1x',
    );
    assert.equal(resolveCloreHostKey({ id: 77 }, null, 'rtx3090_1x'), 'clore-host:77|rtx3090_1x');
    assert.equal(resolveCloreHostKey(null, 88, 'rtx4090_1x'), 'clore-host:88|rtx4090_1x');
    assert.notEqual(
      buildHostReputationKey('clore', '123', 'rtx4090_1x'),
      buildHostReputationKey('clore', '123', 'rtx3090_1x'),
    );
  });

  it('skips blacklisted hosts and falls back to least-bad', () => {
    rememberHostFailure('clore-host:a|rtx4090_1x', {
      category: HOST_FAILURE_CATEGORY.HEALTH_FAILURE,
      reason: 'comfy',
      gpuLine: 'rtx4090_1x',
    });
    rememberHostFailure('clore-host:b|rtx4090_1x', {
      category: HOST_FAILURE_CATEGORY.HEALTH_FAILURE,
      reason: 'comfy',
      gpuLine: 'rtx4090_1x',
    });

    const offers = [
      { offerId: 'a', pingMs: 20, uptimePercent: 99, pricePerHour: 0.4, gpuType: 'RTX 4090' },
      { offerId: 'b', pingMs: 30, uptimePercent: 98, pricePerHour: 0.3, gpuType: 'RTX 4090' },
    ];
    const result = applyHostReputationToOffers(
      offers,
      (o) => 'clore-host:' + o.offerId + '|rtx4090_1x',
      { allowLeastBadFallback: true },
    );
    assert.equal(result.usedLeastBadFallback, true);
    assert.equal(result.offers.length > 0, true);
    assert.ok(result.droppedBlacklisted >= 2);
  });

  it('prefers higher reputation when not blacklisted', () => {
    rememberHostSuccess('clore-host:good|rtx4090_1x', {
      gpuLine: 'rtx4090_1x',
      readyLatencyMs: 30_000,
    });
    rememberHostFailure('clore-host:meh|rtx4090_1x', {
      category: HOST_FAILURE_CATEGORY.RATE_LIMIT,
      reason: '429',
      gpuLine: 'rtx4090_1x',
    });
    const offers = [
      { offerId: 'meh', pingMs: 10, uptimePercent: 99, pricePerHour: 0.2, gpuType: 'RTX 4090' },
      { offerId: 'good', pingMs: 40, uptimePercent: 90, pricePerHour: 0.5, gpuType: 'RTX 4090' },
    ];
    const result = applyHostReputationToOffers(
      offers,
      (o) => 'clore-host:' + o.offerId + '|rtx4090_1x',
    );
    assert.equal(result.usedLeastBadFallback, false);
    assert.equal(result.offers[0].offerId, 'good');
    const metrics = getHostReputationMetrics();
    assert.ok(metrics.hostSelectionCount >= 1);
  });

  it('keeps separate reputation across GPU lines', () => {
    rememberHostFailure('clore-host:1|rtx4090_1x', {
      category: HOST_FAILURE_CATEGORY.HEALTH_FAILURE,
      reason: 'comfy',
      gpuLine: 'rtx4090_1x',
    });
    const offers4090 = [
      { offerId: '1', pingMs: 20, uptimePercent: 99, pricePerHour: 0.4 },
    ];
    const offers3090 = [
      { offerId: '1', pingMs: 20, uptimePercent: 99, pricePerHour: 0.4 },
    ];
    const r4090 = applyHostReputationToOffers(
      offers4090,
      (o) => 'clore-host:' + o.offerId + '|rtx4090_1x',
      { allowLeastBadFallback: false },
    );
    const r3090 = applyHostReputationToOffers(
      offers3090,
      (o) => 'clore-host:' + o.offerId + '|rtx3090_1x',
      { allowLeastBadFallback: false },
    );
    assert.equal(r4090.offers.length, 0);
    assert.equal(r3090.offers.length, 1);
  });
});