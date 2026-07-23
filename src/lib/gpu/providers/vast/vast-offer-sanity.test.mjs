import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeVastOffer } from '../../offer-selection.js';
import {
  evaluateVastOfferSanity,
  filterVastOffersBySanity,
  formatVastBadHostError,
  isVastBadHostStatus,
  isVastDiskOnlyBilling,
  isVastInstanceProvisionProgress,
  vastGpuNameMatchesLine,
  unwrapVastInstanceRecord,
} from './vast-offer-sanity.js';
import { buildOfferSearchBody } from './vast-client.js';

function vastRaw(overrides = {}) {
  return {
    id: 1001,
    gpu_name: 'RTX 3090',
    num_gpus: 1,
    gpu_ram: 24576,
    disk_space: 200,
    dph_total: 0.25,
    reliability: 0.995,
    geolocation: 'Texas, US',
    rentable: true,
    rented: false,
    dlperf: 45,
    inet_down: 500,
    cuda_max_good: 12.0,
    ...overrides,
  };
}

describe('vast-offer-sanity prefilter', () => {
  it('matches gpu names for line', () => {
    assert.equal(vastGpuNameMatchesLine('rtx3090', 'RTX 3090'), true);
    assert.equal(vastGpuNameMatchesLine('rtx3090', 'NVIDIA GeForce RTX 3090'), true);
    assert.equal(vastGpuNameMatchesLine('rtx3090', 'RTX 4090'), false);
    assert.equal(vastGpuNameMatchesLine('rtx5090_1x', 'RTX 5090'), true);
    assert.equal(vastGpuNameMatchesLine('rtx5090_1x', 'GeForce RTX 5090'), true);
  });

  it('rejects Studio 5090 offers with VRAM <= 30GB', () => {
    const low = normalizeVastOffer(
      vastRaw({
        id: 50901,
        gpu_name: 'RTX 5090',
        gpu_ram: 24 * 1024,
        dph_total: 0.4,
        dlperf: 180,
      }),
    );
    assert.equal(evaluateVastOfferSanity(low, 'rtx5090_1x').ok, false);
    assert.equal(evaluateVastOfferSanity(low, 'rtx5090_1x').reason, 'vram_too_low');

    const ok = normalizeVastOffer(
      vastRaw({
        id: 50902,
        gpu_name: 'RTX 5090',
        gpu_ram: 32 * 1024,
        dph_total: 0.4,
        dlperf: 180,
      }),
    );
    assert.equal(evaluateVastOfferSanity(ok, 'rtx5090_1x').ok, true);
  });

  it('rejects dlperf <= 0 and below min dph', () => {
    const noDlperf = normalizeVastOffer(vastRaw({ dlperf: 0, dph_total: 0.25 }));
    assert.ok(noDlperf);
    assert.equal(evaluateVastOfferSanity(noDlperf, 'rtx3090').ok, false);
    assert.equal(evaluateVastOfferSanity(noDlperf, 'rtx3090').reason, 'dlperf_nonpositive');

    const cheap = normalizeVastOffer(vastRaw({ dph_total: 0.05, dlperf: 40 }));
    assert.ok(cheap);
    assert.equal(evaluateVastOfferSanity(cheap, 'rtx3090').reason, 'below_min_dph');
  });

  it('rejects gpu_name mismatch', () => {
    const wrong = normalizeVastOffer(vastRaw({ gpu_name: 'RTX 4090', dlperf: 50, dph_total: 0.3 }));
    assert.ok(wrong);
    assert.equal(evaluateVastOfferSanity(wrong, 'rtx3090').reason, 'gpu_name_mismatch');
  });

  it('rejects storage-only / no-GPU listings', () => {
    assert.equal(normalizeVastOffer(vastRaw({ num_gpus: 0, dlperf: 40 })), null);
    assert.equal(normalizeVastOffer(vastRaw({ gpu_ram: 0, dlperf: 40 })), null);
    assert.equal(normalizeVastOffer(vastRaw({ gpu_name: '', dlperf: 40 })), null);
    assert.equal(normalizeVastOffer(vastRaw({ gpu_frac: 0.25, dlperf: 40 })), null);

    const ok = normalizeVastOffer(vastRaw({ num_gpus: 1, gpu_frac: 1, dlperf: 40 }));
    assert.ok(ok);
    assert.equal(evaluateVastOfferSanity(ok, 'rtx3090').ok, true);

    const wrongCount = normalizeVastOffer(vastRaw({ num_gpus: 2, dlperf: 40 }));
    assert.ok(wrongCount);
    assert.equal(evaluateVastOfferSanity(wrongCount, 'rtx3090').reason, 'no_gpu');
  });

  it('search body requires full gpu_frac=1', () => {
    const body = buildOfferSearchBody('rtx4090_1x');
    assert.deepEqual(body.gpu_frac, { eq: 1 });
    assert.deepEqual(body.num_gpus, { eq: 1 });
    assert.equal(body.type, 'on-demand');
  });

  it('drops median price anomalies (storage-priced outliers)', () => {
    const offers = [
      normalizeVastOffer(vastRaw({ id: 1, dph_total: 0.12, dlperf: 30 })),
      normalizeVastOffer(vastRaw({ id: 2, dph_total: 0.28, dlperf: 40 })),
      normalizeVastOffer(vastRaw({ id: 3, dph_total: 0.3, dlperf: 42 })),
      normalizeVastOffer(vastRaw({ id: 4, dph_total: 0.32, dlperf: 44 })),
      normalizeVastOffer(vastRaw({ id: 5, dph_total: 0.34, dlperf: 46 })),
    ].filter(Boolean);

    const { offers: kept, stats } = filterVastOffersBySanity(offers, 'rtx3090');
    assert.ok(stats.droppedPriceAnomaly >= 1);
    assert.equal(
      kept.some((o) => o.offerId === 1),
      false,
    );
    assert.ok(kept.some((o) => o.offerId === 3));
  });
});

describe('vast-offer-sanity bad host', () => {
  it('detects No such container status_msg', () => {
    assert.equal(
      isVastBadHostStatus({
        actual_status: 'loading',
        status_msg: 'Error response from daemon: No such container: C.44434502',
      }),
      true,
    );
  });

  it('detects exited status as bad host', () => {
    assert.equal(isVastBadHostStatus({ actual_status: 'exited' }), true);
  });

  it('detects zero num_gpus on live instance as bad host', () => {
    assert.equal(
      isVastBadHostStatus({
        actual_status: 'running',
        num_gpus: 0,
        status_msg: 'ok',
      }),
      true,
    );
  });

  it('detects stopped (disk-only billing) as bad host', () => {
    assert.equal(isVastBadHostStatus({ actual_status: 'stopped' }), true);
    assert.equal(
      isVastBadHostStatus({ intended_status: 'running', actual_status: 'stopped' }),
      true,
    );
    assert.equal(isVastDiskOnlyBilling({ next_state: 'stopped', actual_status: 'running' }), true);
    assert.equal(isVastBadHostStatus({ next_state: 'stopped', actual_status: 'running' }), true);
  });

  it('detects console-style GPU struck-through billing as bad host', () => {
    const diskOnly = {
      actual_status: 'running',
      dph_base: 0.4,
      storage_total_cost: 0.023,
      instance: {
        gpuCostPerHour: 0.4,
        diskHour: 0.023,
        totalHour: 0.423,
        discountedTotalPerHour: 0.023,
      },
    };
    assert.equal(isVastDiskOnlyBilling(diskOnly), true);
    assert.equal(isVastBadHostStatus(diskOnly), true);

    // Live case 2026-07-23: gpuCostPerHour=0, billed=disk only, dph_base still advertised.
    const gpuCostZero = {
      actual_status: 'loading',
      dph_base: 0.333,
      storage_total_cost: 0.022,
      instance: {
        gpuCostPerHour: 0,
        diskHour: 0.022,
        totalHour: 0.022,
        discountedTotalPerHour: 0.022,
      },
    };
    assert.equal(isVastDiskOnlyBilling(gpuCostZero), true);
    assert.equal(isVastBadHostStatus(gpuCostZero), true);

    const fullGpu = {
      actual_status: 'running',
      dph_base: 0.4,
      storage_total_cost: 0.023,
      instance: {
        gpuCostPerHour: 0.4,
        diskHour: 0.023,
        totalHour: 0.423,
        discountedTotalPerHour: 0.423,
      },
    };
    assert.equal(isVastDiskOnlyBilling(fullGpu), false);
    assert.equal(isVastBadHostStatus(fullGpu), false);
  });

  it('rejects offers with explicit dph_base=0 (disk-only ask)', () => {
    assert.equal(
      evaluateVastOfferSanity(
        normalizeVastOffer(vastRaw({ dph_base: 0, dph_total: 0.25, dlperf: 40 })),
        'rtx3090',
      ).reason,
      'no_gpu',
    );
  });

  it('requires ports — running/loading with IP alone is not enough', () => {
    assert.equal(
      isVastInstanceProvisionProgress({
        actual_status: 'running',
        public_ipaddr: '1.2.3.4',
      }),
      false,
    );
    assert.equal(
      isVastInstanceProvisionProgress({
        actual_status: 'loading',
        public_ipaddr: '1.2.3.4',
      }),
      false,
    );
    assert.equal(
      isVastInstanceProvisionProgress({
        actual_status: 'running',
        public_ipaddr: '1.2.3.4',
        ports: { '8080/tcp': [{ HostPort: '12345' }] },
      }),
      true,
    );
  });

  it('treats running with ports as provision progress', () => {
    assert.equal(
      isVastInstanceProvisionProgress({
        actual_status: 'running',
        public_ipaddr: '1.2.3.4',
        ports: { '8080/tcp': [{ HostPort: '12345' }] },
      }),
      true,
    );
  });

  it('does not treat loading without IP/ports as ready', () => {
    assert.equal(
      isVastInstanceProvisionProgress({
        actual_status: 'loading',
      }),
      false,
    );
  });

  it('unwraps nested instances payload', () => {
    const flat = unwrapVastInstanceRecord({
      instances: [{ id: 9, actual_status: 'running', public_ipaddr: '10.0.0.1' }],
      success: true,
    });
    assert.equal(flat?.id, 9);
    assert.equal(flat?.actual_status, 'running');
  });

  it('formats retryable bad-host message', () => {
    const msg = formatVastBadHostError('44434502', 'No such container: C.44434502');
    assert.match(msg, /bad host/i);
    assert.match(msg, /44434502/);
    assert.match(msg, /trying next offer/i);
  });
});
