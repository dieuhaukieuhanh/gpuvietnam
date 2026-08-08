import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  median,
  selectPreferredUptimeGroup,
  selectRelaxedWorkstationOffers,
  selectWorkstationOffers,
  takeCheapest,
  resolveUptimeGroup,
  parseHostDiskGb,
} from './offer-selection.js';
import {
  nextProviderInRotation,
  resolveProviderAttemptOrder,
  provisionWithProviderFailover,
  resetProviderRoutingCursor,
  failoverProvider,
} from './provider-routing.js';
import { NO_AVAILABLE_WORKSTATION_MESSAGE } from './gpu-config.js';

function offer(partial) {
  return {
    offerId: partial.offerId ?? Math.random(),
    providerId: partial.providerId ?? 'vast',
    pricePerHour: partial.pricePerHour,
    uptimePercent: partial.uptimePercent,
    pingMs: partial.pingMs ?? 100,
    vramGb: partial.vramGb ?? 24,
    diskGb: partial.diskGb ?? 100,
    numGpus: partial.numGpus ?? 1,
    gpuType: partial.gpuType ?? 'RTX 4090',
    region: partial.region ?? 'Taiwan',
    rentable: partial.rentable ?? true,
    ...partial,
  };
}

describe('offer-selection', () => {
  it('computes median', () => {
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), 0);
  });

  it('parses host disk strings', () => {
    assert.equal(parseHostDiskGb('SAMSUNG SSD 2000GB'), 2000);
    assert.equal(parseHostDiskGb('2TB'), 2048);
    assert.equal(parseHostDiskGb(120), 120);
    // Clore model SKU must not be read as 2GB (SNV2S…); prefer explicit GB/TB tokens.
    assert.ok(parseHostDiskGb('KINGSTON SNV2S1000G 829.4912GB') >= 829);
    assert.equal(parseHostDiskGb('Netac NVMe SSD 1TB 830.1521GB'), 1024);
  });

  it('relaxed selection includes hosts below A/B/C uptime bands', () => {
    const offers = [
      offer({ offerId: 'hi', pricePerHour: 0.5, uptimePercent: 99.5, pingMs: 100 }),
      offer({ offerId: 'mid', pricePerHour: 0.2, uptimePercent: 82, pingMs: 120 }),
      offer({ offerId: 'low', pricePerHour: 0.1, uptimePercent: 70, pingMs: 90 }),
    ];
    const ranked = selectRelaxedWorkstationOffers(offers, {
      plan: 'starter',
      gpuLine: 'rtx3090',
      minUptimePercent: 80,
      maxCandidates: 5,
    });
    const ids = ranked.map((o) => String(o.offerId));
    assert.ok(ids.includes('mid'));
    assert.ok(ids.includes('hi'));
    assert.equal(ids.includes('low'), false);
    // cheapest first among eligible
    assert.equal(String(ranked[0].offerId), 'mid');
  });

  it('groups uptime correctly', () => {
    assert.equal(resolveUptimeGroup(offer({ uptimePercent: 99.2 })), 'A');
    assert.equal(resolveUptimeGroup(offer({ uptimePercent: 98.7 })), 'B');
    assert.equal(resolveUptimeGroup(offer({ uptimePercent: 98.2 })), 'C');
    assert.equal(resolveUptimeGroup(offer({ uptimePercent: 97.9 })), null);
  });

  it('minUptimePercent 99 keeps only group A', () => {
    const offers = [
      offer({ offerId: 'a', pricePerHour: 0.4, uptimePercent: 99.5, diskGb: 100 }),
      offer({ offerId: 'b', pricePerHour: 0.3, uptimePercent: 98.7, diskGb: 100 }),
      offer({ offerId: 'c', pricePerHour: 0.2, uptimePercent: 98.2, diskGb: 100 }),
    ];
    const ranked = selectWorkstationOffers(offers, {
      plan: 'starter',
      gpuLine: 'rtx3090',
      minUptimePercent: 99,
    });
    assert.ok(ranked.length >= 1);
    assert.ok(ranked.every((o) => o.uptimePercent >= 99));
    assert.equal(ranked.some((o) => String(o.offerId) === 'b'), false);
  });

  it('prefers group A when median within 10%', () => {
    const groups = {
      A: takeCheapest([
        offer({ offerId: 1, pricePerHour: 0.40, uptimePercent: 99.5 }),
        offer({ offerId: 2, pricePerHour: 0.42, uptimePercent: 99.1 }),
        offer({ offerId: 3, pricePerHour: 0.44, uptimePercent: 99.0 }),
      ]),
      B: takeCheapest([
        offer({ offerId: 4, pricePerHour: 0.38, uptimePercent: 98.8 }),
        offer({ offerId: 5, pricePerHour: 0.39, uptimePercent: 98.6 }),
        offer({ offerId: 6, pricePerHour: 0.40, uptimePercent: 98.5 }),
      ]),
      C: [],
    };
    // median A=0.42, median B=0.39, 0.42 <= 0.39*1.1=0.429 -> A
    const result = selectPreferredUptimeGroup(groups);
    assert.equal(result.label, 'group_A');
    assert.equal(result.selected.length, 3);
    assert.ok(result.selected.every((o) => o.uptimePercent >= 99));
  });

  it('merges A+B when A premium exceeds 10%', () => {
    const groups = {
      A: takeCheapest([
        offer({ offerId: 1, pricePerHour: 0.60, uptimePercent: 99.5 }),
        offer({ offerId: 2, pricePerHour: 0.62, uptimePercent: 99.2 }),
        offer({ offerId: 3, pricePerHour: 0.64, uptimePercent: 99.0 }),
      ]),
      B: takeCheapest([
        offer({ offerId: 4, pricePerHour: 0.40, uptimePercent: 98.8 }),
        offer({ offerId: 5, pricePerHour: 0.41, uptimePercent: 98.7 }),
        offer({ offerId: 6, pricePerHour: 0.42, uptimePercent: 98.6 }),
      ]),
      C: [],
    };
    const result = selectPreferredUptimeGroup(groups);
    assert.equal(result.label, 'merge_A_B');
    assert.equal(result.selected.length, 6);
    assert.deepEqual(
      result.selected.map((o) => o.offerId),
      [4, 5, 6, 1, 2, 3],
    );
  });

  it('selects workstation offers for Pro with host disk >= 50', () => {
    const offers = [
      offer({ offerId: 1, pricePerHour: 0.5, uptimePercent: 99.5, diskGb: 40, numGpus: 1 }),
      offer({ offerId: 2, pricePerHour: 0.45, uptimePercent: 99.2, diskGb: 80, numGpus: 1 }),
      offer({ offerId: 3, pricePerHour: 0.48, uptimePercent: 98.8, diskGb: 100, numGpus: 1 }),
      offer({ offerId: 4, pricePerHour: 0.30, uptimePercent: 99.9, diskGb: 200, numGpus: 1, pingMs: 300 }),
    ];
    const selected = selectWorkstationOffers(offers, { plan: 'pro', gpuLine: 'rtx4090_1x' });
    assert.ok(selected.length >= 1);
    assert.ok(selected.every((s) => s.offer.diskGb >= 50));
    assert.ok(selected.every((s) => s.pingMs <= 250));
    assert.ok(!selected.some((s) => s.offerId === 1)); // disk too small
    assert.ok(!selected.some((s) => s.offerId === 4)); // ping too high
  });

  it('Studio 5090 requires VRAM > 30GB and disk >= 100', () => {
    const offers = [
      offer({
        offerId: 1,
        pricePerHour: 0.5,
        uptimePercent: 99.5,
        diskGb: 120,
        vramGb: 24,
        numGpus: 1,
        gpuType: 'RTX 5090',
      }),
      offer({
        offerId: 2,
        pricePerHour: 0.55,
        uptimePercent: 99.2,
        diskGb: 120,
        vramGb: 30,
        numGpus: 1,
        gpuType: 'RTX 5090',
      }),
      offer({
        offerId: 3,
        pricePerHour: 0.6,
        uptimePercent: 99.1,
        diskGb: 150,
        vramGb: 32,
        numGpus: 1,
        gpuType: 'RTX 5090',
      }),
      offer({
        offerId: 4,
        pricePerHour: 0.48,
        uptimePercent: 99.4,
        diskGb: 80,
        vramGb: 32,
        numGpus: 1,
        gpuType: 'RTX 5090',
      }),
    ];
    const selected = selectWorkstationOffers(offers, { plan: 'studio', gpuLine: 'rtx5090_1x' });
    assert.ok(selected.some((s) => s.offerId === 3));
    assert.ok(!selected.some((s) => s.offerId === 1)); // vram <= 30
    assert.ok(!selected.some((s) => s.offerId === 2)); // vram == 30 not > 30
    assert.ok(!selected.some((s) => s.offerId === 4)); // disk < 100
  });
});

describe('provider-routing', () => {
  beforeEach(() => {
    resetProviderRoutingCursor(0);
  });

  it('cycles PROVIDER_ROUTING.sequence (legacy cursor; Start uses Admin policy)', () => {
    const seq = Array.from({ length: 5 }, () => nextProviderInRotation());
    assert.deepEqual(seq, ['vast', 'clore', 'salad', 'vast', 'clore']);
  });

  it('failsover to the other provider', () => {
    assert.equal(failoverProvider('clore'), 'vast');
    assert.equal(failoverProvider('vast'), 'clore');
  });

  it('Admin policy + emergency env; Clore includes 5090 when enabled', () => {
    const prev = process.env.GPU_CLORE_ONLY;
    const prevWorker = process.env.GPUVIETNAM_LIFECYCLE_WORKER;
    const prevAllowVast = process.env.GPU_ALLOW_VAST;
    const prevVastOnly = process.env.GPU_VAST_ONLY;
    const prevSalad = process.env.GPU_SALAD_ONLY;
    try {
      delete process.env.GPU_CLORE_ONLY;
      delete process.env.GPU_VAST_ONLY;
      delete process.env.GPU_SALAD_ONLY;
      delete process.env.GPUVIETNAM_LIFECYCLE_WORKER;
      delete process.env.GPU_ALLOW_VAST;

      const both = {
        providers: { vast: true, clore: true, salad: false },
        priority: ['vast', 'clore', 'salad'],
      };
      assert.deepEqual(
        resolveProviderAttemptOrder({ gpuLine: 'rtx5090_1x', policy: both }),
        ['vast', 'clore'],
      );
      assert.deepEqual(
        resolveProviderAttemptOrder({ gpuLine: 'rtx4090_1x', policy: both }),
        ['vast', 'clore'],
      );

      // Default file/cache policy is Vast-only when no inject — use explicit policy.
      const vastOnly = {
        providers: { vast: true, clore: false, salad: false },
        priority: ['vast', 'clore', 'salad'],
      };
      assert.deepEqual(
        resolveProviderAttemptOrder({ gpuLine: 'rtx3090', policy: vastOnly }),
        ['vast'],
      );

      process.env.GPU_CLORE_ONLY = 'true';
      assert.deepEqual(
        resolveProviderAttemptOrder({ gpuLine: 'rtx5090_1x', policy: both }),
        ['clore'],
      );
      process.env.GPU_CLORE_ONLY = 'true\r';
      assert.deepEqual(
        resolveProviderAttemptOrder({ gpuLine: 'rtx4090_1x', policy: both }),
        ['clore'],
      );
      // Lifecycle worker alone no longer forces Clore (Admin policy is SoT).
      delete process.env.GPU_CLORE_ONLY;
      process.env.GPUVIETNAM_LIFECYCLE_WORKER = '1';
      assert.deepEqual(
        resolveProviderAttemptOrder({ gpuLine: 'rtx4090_1x', policy: both }),
        ['vast', 'clore'],
      );
      process.env.GPU_CLORE_ONLY = 'true';
      process.env.GPU_VAST_ONLY = 'true';
      assert.deepEqual(
        resolveProviderAttemptOrder({ gpuLine: 'rtx4090_1x', policy: both }),
        ['vast'],
      );
    } finally {
      if (prev === undefined) delete process.env.GPU_CLORE_ONLY;
      else process.env.GPU_CLORE_ONLY = prev;
      if (prevWorker === undefined) delete process.env.GPUVIETNAM_LIFECYCLE_WORKER;
      else process.env.GPUVIETNAM_LIFECYCLE_WORKER = prevWorker;
      if (prevAllowVast === undefined) delete process.env.GPU_ALLOW_VAST;
      else process.env.GPU_ALLOW_VAST = prevAllowVast;
      if (prevVastOnly === undefined) delete process.env.GPU_VAST_ONLY;
      else process.env.GPU_VAST_ONLY = prevVastOnly;
      if (prevSalad === undefined) delete process.env.GPU_SALAD_ONLY;
      else process.env.GPU_SALAD_ONLY = prevSalad;
    }
  });

  it('returns No Available Workstation when both fail', async () => {
    await assert.rejects(
      () =>
        provisionWithProviderFailover({
          attemptOrder: ['vast', 'clore'],
          async createWithProvider() {
            throw new Error('no matching offer');
          },
        }),
      (err) => err.message === NO_AVAILABLE_WORKSTATION_MESSAGE,
    );
  });

  it('uses secondary provider on primary failure', async () => {
    const tried = [];
    const result = await provisionWithProviderFailover({
      attemptOrder: ['vast', 'clore'],
      async createWithProvider(providerId) {
        tried.push(providerId);
        if (providerId === 'vast') throw new Error('timeout');
        return { id: 'clore-1', providerId };
      },
    });
    assert.deepEqual(tried, ['vast', 'clore']);
    assert.equal(result.providerId, 'clore');
  });
});
