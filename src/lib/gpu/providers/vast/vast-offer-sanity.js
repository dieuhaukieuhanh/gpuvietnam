/**
 * Vast offer pre-rent sanity + post-rent bad-host detection.
 */

import { PACKAGE_SPECS, VAST_OFFER_SANITY } from '../../gpu-config.js';
import { median } from '../../offer-selection.js';
import { filterVastOffersByBadHostExclusion } from './vast-bad-host-exclusion.js';
import { applyVastPercentilePriceBand } from './vast-percentile-band.js';

/** @type {Record<string, string[]>} */
export const VAST_GPU_NAMES_BY_LINE = {
  rtx3090: ['RTX 3090'],
  rtx4090_1x: ['RTX 4090'],
  rtx4090_2x: ['RTX 4090'],
  rtx5090_1x: ['RTX 5090', '5090'],
};

/**
 * @param {string} gpuLine
 * @returns {{ minVramGb: number; exclusive: boolean }}
 */
export function resolveVastMinVramForLine(gpuLine) {
  if (gpuLine === 'rtx5090_1x') {
    return {
      minVramGb: PACKAGE_SPECS.studio.minVramGb ?? 30,
      exclusive: Boolean(PACKAGE_SPECS.studio.minVramExclusive),
    };
  }
  return { minVramGb: 20, exclusive: false };
}

/**
 * @param {string} gpuLine
 * @returns {number}
 */
export function resolveVastMinDphTotal(gpuLine) {
  const table = VAST_OFFER_SANITY.minDphTotalByLine;
  const value = table[/** @type {keyof typeof table} */ (gpuLine)];
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * @param {string} gpuLine
 * @param {string} gpuName
 */
export function vastGpuNameMatchesLine(gpuLine, gpuName) {
  const allowed = VAST_GPU_NAMES_BY_LINE[gpuLine];
  if (!allowed?.length) return true;
  const normalized = String(gpuName ?? '')
    .replace(/^nvidia\s+geforce\s+/i, '')
    .trim()
    .toLowerCase();
  return allowed.some((name) => normalized.includes(name.toLowerCase()));
}

/**
 * @param {Record<string, unknown>} raw
 */
export function readVastDlperf(raw) {
  const value = Number(raw?.dlperf ?? raw?.dlperf_total ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Prefer GPU compute component when Vast exposes it; else dph_total.
 * @param {Record<string, unknown>} raw
 * @param {number} [fallbackTotal]
 */
export function readVastGpuPricePerHour(raw, fallbackTotal = 0) {
  const base = Number(raw?.dph_base ?? raw?.gpu_cost ?? raw?.dph_gpu ?? 0);
  if (Number.isFinite(base) && base > 0) return base;
  const total =
    Number(raw?.price_per_hour ?? raw?.dph_total ?? raw?.dph ?? fallbackTotal) || fallbackTotal;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Single-offer hard sanity (before cohort median).
 * @param {import('../../offer-selection.js').NormalizedOffer} offer
 * @param {string} gpuLine
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
/**
 * Expected discrete GPU count for a line (1x / 2x).
 * @param {string} gpuLine
 */
export function expectedVastNumGpusForLine(gpuLine) {
  return gpuLine === 'rtx4090_2x' ? 2 : 1;
}

export function evaluateVastOfferSanity(offer, gpuLine) {
  const gpuType = String(offer.gpuType ?? '').trim();
  if (!gpuType) {
    return { ok: false, reason: 'no_gpu' };
  }
  if (!vastGpuNameMatchesLine(gpuLine, gpuType)) {
    return { ok: false, reason: 'gpu_name_mismatch' };
  }

  const expectedGpus = expectedVastNumGpusForLine(gpuLine);
  const numGpus = Number(offer.numGpus);
  if (!(numGpus > 0) || numGpus !== expectedGpus) {
    return { ok: false, reason: 'no_gpu' };
  }

  const vramRule = resolveVastMinVramForLine(gpuLine);
  const vramGb = Number(offer.vramGb);
  // Fail-closed for every line: missing/zero VRAM = storage-only or broken listing.
  if (!(Number.isFinite(vramGb) && vramGb > 0)) {
    return { ok: false, reason: 'no_gpu' };
  }
  const vramOk = vramRule.exclusive ? vramGb > vramRule.minVramGb : vramGb >= vramRule.minVramGb;
  if (!vramOk) return { ok: false, reason: 'vram_too_low' };

  const raw = offer.raw && typeof offer.raw === 'object' ? offer.raw : {};
  const gpuFrac = Number(raw.gpu_frac ?? raw.gpu_fraction);
  if (Number.isFinite(gpuFrac) && gpuFrac > 0 && gpuFrac < 0.99) {
    return { ok: false, reason: 'no_gpu' };
  }

  const dlperf = readVastDlperf(/** @type {Record<string, unknown>} */ (raw));
  if (VAST_OFFER_SANITY.requirePositiveDlperf && !(dlperf > 0)) {
    return { ok: false, reason: 'dlperf_nonpositive' };
  }

  const minDph = resolveVastMinDphTotal(gpuLine);
  const price = offer.pricePerHour;
  if (minDph > 0 && !(price >= minDph)) {
    return { ok: false, reason: 'below_min_dph' };
  }

  return { ok: true };
}

/**
 * Filter normalized Vast offers: per-offer sanity + median cohort floor + percentile band.
 * @param {import('../../offer-selection.js').NormalizedOffer[]} offers
 * @param {string} gpuLine
 * @param {{ plan?: string | null }} [context]
 */
export function filterVastOffersBySanity(offers, gpuLine, context = {}) {
  let droppedGpuName = 0;
  let droppedNoGpu = 0;
  let droppedNoDlperf = 0;
  let droppedMinDph = 0;
  let droppedVram = 0;
  let droppedPriceAnomaly = 0;

  /** @type {import('../../offer-selection.js').NormalizedOffer[]} */
  const passed = [];
  for (const offer of offers) {
    const result = evaluateVastOfferSanity(offer, gpuLine);
    if (result.ok) {
      passed.push(offer);
      continue;
    }
    if (result.reason === 'gpu_name_mismatch') droppedGpuName += 1;
    else if (result.reason === 'no_gpu') droppedNoGpu += 1;
    else if (result.reason === 'dlperf_nonpositive') droppedNoDlperf += 1;
    else if (result.reason === 'below_min_dph') droppedMinDph += 1;
    else if (result.reason === 'vram_too_low') droppedVram += 1;
  }

  const ratio = VAST_OFFER_SANITY.medianPriceFloorRatio;
  const cohortMedian = median(passed.map((o) => o.pricePerHour));
  const floor = cohortMedian > 0 && ratio > 0 ? cohortMedian * ratio : 0;

  /** @type {import('../../offer-selection.js').NormalizedOffer[]} */
  const kept = [];
  for (const offer of passed) {
    if (floor > 0 && offer.pricePerHour < floor) {
      droppedPriceAnomaly += 1;
      continue;
    }
    kept.push(offer);
  }

  const band = applyVastPercentilePriceBand(kept, {
    plan: context.plan,
    gpuLine,
  });

  const { offers: afterExclusion, droppedExcludedHost } = filterVastOffersByBadHostExclusion(
    band.offers,
  );

  console.info('[vast/offer-sanity] filter', {
    gpuLine,
    plan: context.plan ?? null,
    input: offers.length,
    afterHard: passed.length,
    afterMedianFloor: kept.length,
    afterPercentile: band.offers.length,
    kept: afterExclusion.length,
    percentileMode: band.mode,
    percentileDropped: band.dropped,
    cohortMedian,
    medianFloor: floor,
    droppedGpuName,
    droppedNoGpu,
    droppedNoDlperf,
    droppedMinDph,
    droppedVram,
    droppedPriceAnomaly,
    droppedExcludedHost,
  });

  return {
    offers: afterExclusion,
    stats: {
      droppedGpuName,
      droppedNoGpu,
      droppedNoDlperf,
      droppedMinDph,
      droppedVram,
      droppedPriceAnomaly,
      droppedExcludedHost,
      droppedPercentile: band.dropped,
      percentileMode: band.mode,
      cohortMedian,
      medianFloor: floor,
    },
  };
}

/**
 * Flatten Vast GET /instances/{id}/ payload (root + nested instances[0]).
 * @param {Record<string, unknown> | null | undefined} payload
 */
export function unwrapVastInstanceRecord(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const nested = Array.isArray(payload.instances)
    ? payload.instances[0]
    : payload.instances;
  if (nested && typeof nested === 'object') {
    return {
      ...payload,
      .../** @type {Record<string, unknown>} */ (nested),
    };
  }
  return payload;
}

/**
 * True when Vast instance status indicates a dead GPU/container host.
 * @param {Record<string, unknown> | null | undefined} record
 */
export function isVastBadHostStatus(record) {
  if (!record || typeof record !== 'object') return false;
  const statusMsg = String(record.status_msg ?? record.status_message ?? '').toLowerCase();
  const actual = String(record.actual_status ?? record.cur_state ?? record.status ?? '').toLowerCase();
  const intended = String(record.intended_status ?? '').toLowerCase();

  const numGpus = Number(record.num_gpus ?? record.gpu_count);
  const gpuRam = Number(record.gpu_ram ?? record.vram);
  // Live instance reporting zero GPUs / zero VRAM = storage-only billing shell.
  if (Number.isFinite(numGpus) && numGpus <= 0) return true;
  if (Number.isFinite(gpuRam) && gpuRam <= 0 && /stopped|exited|offline/.test(actual)) {
    return true;
  }
  if (/storage.?only|disk.?only|no gpu allocated|gpu unavailable/.test(statusMsg)) {
    return true;
  }

  if (
    /no such container|cannot find container|nvidia-smi|no nvidia|gpu not (found|available)|no gpu|cuda (error|init)|failed to (create|start) container|container.*not found/i.test(
      statusMsg,
    )
  ) {
    return true;
  }

  if (/exited|offline|error|failed|dead/.test(actual) && /gpu|nvidia|container|cuda/.test(statusMsg)) {
    return true;
  }

  // Disk-only billing state on Vast: container halted, storage still charged.
  // We always rent with target_state=running, so stopped is a failed provision.
  if (actual === 'stopped' || actual.includes('stopped')) {
    return true;
  }

  if (intended === 'running' && (actual === 'stopped' || actual === 'exited' || actual === 'offline')) {
    return true;
  }

  if (actual === 'exited' || actual === 'error' || actual === 'failed' || actual === 'dead') {
    return true;
  }

  return false;
}

/**
 * True when instance shows usable container/port progress (Comfy health not required).
 * Require mapped ports (or running with ports) — IP + loading alone is NOT enough
 * (that pattern let disk-only / GPU-inactive hosts through).
 * @param {Record<string, unknown> | null | undefined} record
 * @param {number} [internalPort]
 */
export function isVastInstanceProvisionProgress(record, internalPort = 8080) {
  if (!record || typeof record !== 'object') return false;
  if (isVastBadHostStatus(record)) return false;

  const actual = String(record.actual_status ?? record.cur_state ?? record.status ?? '').toLowerCase();
  const ports = record.ports ?? record.actual_ports;
  const hasPorts =
    ports && typeof ports === 'object' && Object.keys(/** @type {Record<string, unknown>} */ (ports)).length > 0;

  // Must have HostPort mapping — proves container actually exposed services.
  if (!hasPorts) return false;

  if (actual.includes('running') || actual.includes('loading') || actual.includes('starting')) {
    return true;
  }

  // Ports present with unknown status still counts as container progress.
  void internalPort;
  return true;
}

/**
 * User-facing / retryable message for bad Vast hosts.
 * @param {string} instanceId
 * @param {string} [detail]
 */
export function formatVastBadHostError(instanceId, detail) {
  const suffix = detail ? `: ${detail}` : '';
  return (
    'Vast bad host (GPU/container unavailable) for instance ' +
    instanceId +
    suffix +
    ' — trying next offer'
  );
}
