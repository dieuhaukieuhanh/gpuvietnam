/**
 * Level 2 — Offer selection workflow (provider-agnostic).
 *
 * Step 1 Filter → Step 2 Uptime groups → Step 3 Top-3 cheapest per group
 * → Step 4 Preferred group (median ±10%) → Step 5 Sequential create (caller).
 */

import {
  OFFER_SELECTION,
  resolvePackageSpec,
} from './gpu-config.js';
import {
  normalizeUptimePercent,
  resolveEffectivePingMs,
  resolveMarketplaceRegionLabel,
} from '../infrastructure-metrics.js';
import { resolveAsiaRegionLabel } from './geo-asia.js';

/**
 * @typedef {Object} NormalizedOffer
 * @property {string|number} offerId
 * @property {string} providerId
 * @property {number} pricePerHour
 * @property {number} uptimePercent
 * @property {number} pingMs
 * @property {number} vramGb
 * @property {number} diskGb
 * @property {number} numGpus
 * @property {string} gpuType
 * @property {string} [region]
 * @property {number} [ramGb]
 * @property {number} [cudaVersion]
 * @property {number} [inetDownMbps]
 * @property {number} [maxDurationDays]
 * @property {number} [openPorts]
 * @property {boolean} [rentable]
 * @property {number} [dlperf]
 * @property {number} [dphBase]
 * @property {Record<string, unknown>} [raw]
 */

/**
 * @typedef {Object} RankedOffer
 * @property {NormalizedOffer} offer
 * @property {string|number} offerId
 * @property {number} pricePerHour
 * @property {number} uptimePercent
 * @property {number} pingMs
 * @property {string} region
 * @property {string} gpuType
 * @property {number} vramGb
 * @property {string} uptimeGroup
 * @property {string} reason
 * @property {Record<string, unknown>} [raw]
 */

/**
 * @param {unknown} value
 */
export function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Median of a numeric list. Empty → 0.
 * @param {number[]} values
 */
export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Parse host disk GB from common marketplace shapes (Vast number / Clore disk strings).
 * Clore often sends model + capacity, e.g. "KINGSTON SNV2S1000G 829.49GB" — must not
 * treat the "2" inside the model SKU as 2GB.
 * @param {unknown} raw
 */
export function parseHostDiskGb(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0;
  const text = String(raw);

  /** @type {number[]} */
  const withUnit = [];
  const unitRe = /(\d+(?:\.\d+)?)\s*(tb|t|gb|g)\b/gi;
  let m;
  while ((m = unitRe.exec(text)) != null) {
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = m[2].toLowerCase();
    withUnit.push(unit === 'tb' || unit === 't' ? value * 1024 : value);
  }
  if (withUnit.length > 0) {
    // Prefer the largest explicit capacity (usable free space is usually the last GB figure).
    return Math.max(...withUnit);
  }

  // Bare number only when the whole string is numeric (Vast-style).
  const bare = Number(text.trim());
  return Number.isFinite(bare) && bare > 0 ? bare : 0;
}

/**
 * @param {unknown} raw
 */
export function parseCudaVersion(raw) {
  if (raw == null || raw === '') return null;
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Resolve marketplace region label for ping estimation (not used as a hard filter).
 * @param {unknown} geo
 */
export function resolveOfferRegionLabel(geo) {
  return (
    resolveMarketplaceRegionLabel(geo, resolveAsiaRegionLabel) ??
    (geo != null && String(geo).trim() ? String(geo).trim() : 'Unknown')
  );
}

/**
 * Measured ping when available; otherwise estimated ping from region.
 * @param {Record<string, unknown>} source
 * @param {string} [region]
 */
export function resolveOfferPingMs(source, region) {
  const ping = resolveEffectivePingMs(source, region ?? resolveOfferRegionLabel(source.geolocation ?? source.region));
  return ping == null ? Number.POSITIVE_INFINITY : ping;
}

/**
 * @param {NormalizedOffer} offer
 * @param {{ minHostDiskGb: number; numGpus: number; minVramGb?: number; minVramExclusive?: boolean; maxPingMs?: number; minRamGb?: number; minCudaVersion?: number; minMaxDurationDays?: number; minInetDownMbps?: number; minOpenPorts?: number }} criteria
 */
export function passesOfferHardFilters(offer, criteria) {
  const cfg = OFFER_SELECTION;
  const minVram = criteria.minVramGb ?? cfg.minVramGb;
  const maxPing = criteria.maxPingMs ?? cfg.maxPingMs;
  const minRam = criteria.minRamGb ?? cfg.minRamGb;
  const minCuda = criteria.minCudaVersion ?? cfg.minCudaVersion;
  const minDuration = criteria.minMaxDurationDays ?? cfg.minMaxDurationDays;
  const minInet = criteria.minInetDownMbps ?? cfg.minInetDownMbps;
  const minPorts = criteria.minOpenPorts ?? cfg.minOpenPorts;

  if (offer.rentable === false) return false;
  if (offer.numGpus !== criteria.numGpus) return false;
  if (criteria.minVramExclusive) {
    if (!(offer.vramGb > minVram)) return false;
  } else if (!(offer.vramGb >= minVram)) {
    return false;
  }
  if (!(offer.diskGb >= criteria.minHostDiskGb)) return false;
  if (!(offer.pingMs >= 0) || offer.pingMs > maxPing) return false;

  // Soft RAM floor: allow ~16GB hosts that report 15.9x due to reserved memory.
  if (offer.ramGb != null && offer.ramGb > 0 && offer.ramGb + 0.25 < minRam) return false;
  if (offer.cudaVersion != null && offer.cudaVersion > 0 && offer.cudaVersion < minCuda) return false;
  if (
    offer.maxDurationDays != null &&
    offer.maxDurationDays > 0 &&
    offer.maxDurationDays < minDuration
  ) {
    return false;
  }
  if (offer.inetDownMbps != null && offer.inetDownMbps > 0 && offer.inetDownMbps < minInet) {
    return false;
  }
  if (minPorts > 0 && (offer.openPorts ?? 0) < minPorts) return false;

  return true;
}

/**
 * @param {NormalizedOffer} offer
 * @param {number} [minUptimePercent]
 * @returns {'A'|'B'|'C'|null}
 */
export function resolveUptimeGroup(offer, minUptimePercent = OFFER_SELECTION.minUptimePercent) {
  const uptime = offer.uptimePercent;
  if (!Number.isFinite(uptime) || uptime < minUptimePercent) return null;
  const { A, B, C } = OFFER_SELECTION.groups;
  if (uptime >= A.minInclusive) return 'A';
  if (uptime >= B.minInclusive && uptime < B.maxExclusive) return 'B';
  if (uptime >= C.minInclusive && uptime < C.maxExclusive) return 'C';
  return null;
}

/**
 * @param {NormalizedOffer[]} offers
 * @param {number} [limit]
 */
export function takeCheapest(offers, limit = OFFER_SELECTION.candidatesPerGroup) {
  return offers
    .slice()
    .sort((a, b) => a.pricePerHour - b.pricePerHour)
    .slice(0, limit);
}

/**
 * Rank offers without A/B/C uptime bands (Clore code-1 escape hatch).
 * Keeps hard package filters + ping; only requires a lower uptime floor.
 * @param {NormalizedOffer[]} offers
 * @param {{ plan?: string | null; gpuLine?: string | null; maxCandidates?: number; minUptimePercent?: number }} [context]
 * @returns {RankedOffer[]}
 */
export function selectRelaxedWorkstationOffers(offers, context = {}) {
  const packageSpec = resolvePackageSpec(context.plan, context.gpuLine);
  const criteria = {
    minHostDiskGb: packageSpec.minHostDiskGb,
    numGpus: packageSpec.numGpus,
    minVramGb: packageSpec.minVramGb ?? OFFER_SELECTION.minVramGb,
    minVramExclusive: Boolean(packageSpec.minVramExclusive),
    minCudaVersion: packageSpec.minCudaVersion ?? OFFER_SELECTION.minCudaVersion,
  };
  const minUptime =
    Number(context.minUptimePercent) > 0
      ? Number(context.minUptimePercent)
      : 80;
  const candidateLimit =
    Number(context.maxCandidates) > 0
      ? Math.floor(Number(context.maxCandidates))
      : Math.max(OFFER_SELECTION.maxCandidates, 10);

  /** @type {NormalizedOffer[]} */
  const filtered = [];
  for (const offer of offers) {
    if (!passesOfferHardFilters(offer, criteria)) continue;
    if (!Number.isFinite(offer.uptimePercent) || offer.uptimePercent < minUptime) continue;
    filtered.push(offer);
  }

  const selected = takeCheapest(filtered, candidateLimit);
  console.info(
    `[offer-selection] RELAXED plan=${packageSpec.planKey} gpu=${packageSpec.gpuLine} ` +
      `minUptime=${minUptime} filtered=${filtered.length}/${offers.length} candidates=${selected.length}`,
  );

  return selected.map((offer, index) => ({
    offer,
    offerId: offer.offerId,
    pricePerHour: offer.pricePerHour,
    uptimePercent: offer.uptimePercent,
    pingMs: offer.pingMs,
    region: offer.region ?? 'Unknown',
    gpuType: offer.gpuType,
    vramGb: offer.vramGb,
    uptimeGroup: 'relaxed',
    reason: `Offer #${index + 1}: relaxed_uptime>=${minUptime}, $${offer.pricePerHour.toFixed(4)}/h, uptime ${offer.uptimePercent.toFixed(1)}%, ping ${Math.round(offer.pingMs)}ms`,
    raw: offer.raw,
  }));
}

/**
 * Step 4 — preferred uptime group selection using median price ±10%.
 * @param {{ A: NormalizedOffer[]; B: NormalizedOffer[]; C: NormalizedOffer[] }} groups
 * @param {number} [limit]
 * @returns {{ selected: NormalizedOffer[]; label: string }}
 */
export function selectPreferredUptimeGroup(groups, limit = OFFER_SELECTION.maxCandidates) {
  const premium = OFFER_SELECTION.uptimePricePremium;
  const hasA = groups.A.length > 0;
  const hasB = groups.B.length > 0;
  const hasC = groups.C.length > 0;

  // Case 1: A and B both exist
  if (hasA && hasB) {
    const medianA = median(groups.A.map((o) => o.pricePerHour));
    const medianB = median(groups.B.map((o) => o.pricePerHour));
    if (medianA <= medianB * premium) {
      return { selected: takeCheapest(groups.A, limit), label: 'group_A' };
    }
    return {
      selected: takeCheapest([...groups.A, ...groups.B], limit),
      label: 'merge_A_B',
    };
  }

  // Case 2: A missing; B and C both exist
  if (!hasA && hasB && hasC) {
    const medianB = median(groups.B.map((o) => o.pricePerHour));
    const medianC = median(groups.C.map((o) => o.pricePerHour));
    if (medianB <= medianC * premium) {
      return { selected: takeCheapest(groups.B, limit), label: 'group_B' };
    }
    return {
      selected: takeCheapest([...groups.B, ...groups.C], limit),
      label: 'merge_B_C',
    };
  }

  // Case 3: only one group (or A-only / C-only / B-only / A+C without B)
  if (hasA) {
    return { selected: takeCheapest(groups.A, limit), label: 'group_A_only' };
  }
  if (hasB) {
    return { selected: takeCheapest(groups.B, limit), label: 'group_B_only' };
  }
  if (hasC) {
    return { selected: takeCheapest(groups.C, limit), label: 'group_C_only' };
  }

  return { selected: [], label: 'none' };
}

/**
 * Full Level-2 selection for a package.
 * @param {NormalizedOffer[]} offers
 * @param {{ plan?: string | null; gpuLine?: string | null; maxCandidates?: number; minUptimePercent?: number }} [context]
 * @returns {RankedOffer[]}
 */
export function selectWorkstationOffers(offers, context = {}) {
  const packageSpec = resolvePackageSpec(context.plan, context.gpuLine);
  const criteria = {
    minHostDiskGb: packageSpec.minHostDiskGb,
    numGpus: packageSpec.numGpus,
    minVramGb: packageSpec.minVramGb ?? OFFER_SELECTION.minVramGb,
    minVramExclusive: Boolean(packageSpec.minVramExclusive),
    minCudaVersion: packageSpec.minCudaVersion ?? OFFER_SELECTION.minCudaVersion,
  };
  const candidateLimit =
    Number(context.maxCandidates) > 0
      ? Math.floor(Number(context.maxCandidates))
      : OFFER_SELECTION.maxCandidates;
  const minUptime =
    Number(context.minUptimePercent) > 0
      ? Number(context.minUptimePercent)
      : OFFER_SELECTION.minUptimePercent;

  /** @type {NormalizedOffer[]} */
  const filtered = [];
  for (const offer of offers) {
    if (!passesOfferHardFilters(offer, criteria)) continue;
    const group = resolveUptimeGroup(offer, minUptime);
    if (!group) continue;
    filtered.push(offer);
  }

  /** @type {{ A: NormalizedOffer[]; B: NormalizedOffer[]; C: NormalizedOffer[] }} */
  const groups = { A: [], B: [], C: [] };
  for (const offer of filtered) {
    const group = resolveUptimeGroup(offer, minUptime);
    if (group) groups[group].push(offer);
  }

  // Step 3 — keep cheapest inside each group before preferred selection
  const perGroup = Math.max(candidateLimit, OFFER_SELECTION.candidatesPerGroup);
  groups.A = takeCheapest(groups.A, perGroup);
  groups.B = takeCheapest(groups.B, perGroup);
  groups.C = takeCheapest(groups.C, perGroup);

  const { selected, label } = selectPreferredUptimeGroup(groups, candidateLimit);

  console.info(
    `[offer-selection] plan=${packageSpec.planKey} gpu=${packageSpec.gpuLine} ` +
      `minUptime=${minUptime} filtered=${filtered.length}/${offers.length} ` +
      `A=${groups.A.length} B=${groups.B.length} C=${groups.C.length} ` +
      `choice=${label} candidates=${selected.length}`,
  );

  return selected.map((offer, index) => {
    const uptimeGroup = resolveUptimeGroup(offer, minUptime) ?? '?';
    return {
      offer,
      offerId: offer.offerId,
      pricePerHour: offer.pricePerHour,
      uptimePercent: offer.uptimePercent,
      pingMs: offer.pingMs,
      region: offer.region ?? 'Unknown',
      gpuType: offer.gpuType,
      vramGb: offer.vramGb,
      uptimeGroup,
      reason: `Offer #${index + 1}: ${label}, uptime group ${uptimeGroup}, $${offer.pricePerHour.toFixed(4)}/h, ping ${Math.round(offer.pingMs)}ms`,
      raw: offer.raw,
    };
  });
}

/**
 * Normalize a Vast.ai raw offer into the shared shape.
 * @param {Record<string, unknown>} raw
 * @returns {NormalizedOffer | null}
 */
export function normalizeVastOffer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const offerId = raw.id ?? raw.ask_contract_id;
  if (offerId == null) return null;

  const pricePerHour =
    toFiniteNumber(raw.price_per_hour) ||
    toFiniteNumber(raw.dph_total) ||
    toFiniteNumber(raw.dph) ||
    toFiniteNumber(/** @type {{ dph_total?: unknown }} */ (raw.search)?.dph_total);
  if (!(pricePerHour > 0)) return null;

  const vramRaw = toFiniteNumber(raw.gpu_ram ?? raw.vram);
  const vramGb = vramRaw > 64 ? vramRaw / 1024 : vramRaw;
  // Fail-closed: disk/storage listings often omit or zero GPU fields.
  // Never coerce num_gpus=0 → 1 (that previously let storage-only asks through).
  const numGpusRaw = toFiniteNumber(raw.num_gpus);
  if (!(numGpusRaw > 0)) return null;
  if (!(vramGb > 0)) return null;
  const gpuType = String(raw.gpu_name ?? raw.gpu_type ?? '').trim();
  if (!gpuType) return null;

  const gpuFrac = toFiniteNumber(raw.gpu_frac ?? raw.gpu_fraction);
  // Partial/shared GPU fractions are not full workstation GPUs for us.
  if (gpuFrac != null && gpuFrac > 0 && gpuFrac < 0.99) return null;

  const diskGb = parseHostDiskGb(raw.disk_space ?? raw.disk_total ?? raw.dsize ?? raw.disk_size);
  const region = resolveOfferRegionLabel(raw.geolocation ?? raw.location ?? raw.region);
  const uptimePercent = normalizeUptimePercent(raw.reliability ?? raw.reliability2);
  const pingMs = resolveOfferPingMs(
    /** @type {Record<string, unknown>} */ (raw),
    region,
  );

  let maxDurationDays = toFiniteNumber(raw.max_duration ?? raw.duration);
  if (maxDurationDays > 365) maxDurationDays = maxDurationDays / 86400;

  const cudaVersion =
    parseCudaVersion(raw.cuda_max_good ?? raw.cuda_vers ?? raw.cuda) ?? undefined;
  const ramGb =
    toFiniteNumber(raw.cpu_ram ?? raw.ram ?? raw.system_ram) || undefined;
  // Vast cpu_ram is often MB
  const normalizedRam =
    ramGb != null && ramGb > 512 ? ramGb / 1024 : ramGb;

  const dlperf = toFiniteNumber(raw.dlperf ?? raw.dlperf_total) || undefined;
  const dphBase =
    toFiniteNumber(raw.dph_base ?? raw.gpu_cost ?? raw.dph_gpu) || undefined;

  return {
    offerId,
    providerId: 'vast',
    pricePerHour,
    uptimePercent,
    pingMs,
    vramGb,
    diskGb,
    numGpus: numGpusRaw,
    gpuType,
    region,
    ramGb: normalizedRam || undefined,
    cudaVersion,
    inetDownMbps: toFiniteNumber(raw.inet_down ?? raw.inet_down_mbps ?? raw.download) || undefined,
    maxDurationDays: maxDurationDays || undefined,
    openPorts:
      toFiniteNumber(raw.open_port_count) ||
      toFiniteNumber(raw.direct_port_count) ||
      toFiniteNumber(raw.ports) ||
      undefined,
    rentable: raw.rentable !== false && raw.rented !== true,
    dlperf,
    dphBase,
    raw,
  };
}

/**
 * Normalize a Clore.ai marketplace server into the shared shape.
 * @param {Record<string, unknown>} server
 * @param {{ numGpus: number; gpuType: string; pricePerHour: number; hostGpuCount?: number }} classified
 * @returns {NormalizedOffer | null}
 */
export function normalizeCloreOffer(server, classified) {
  if (!server || typeof server !== 'object') return null;
  const offerId = server.id;
  if (offerId == null) return null;
  if (!(classified.pricePerHour > 0)) return null;

  const specs =
    server.specs && typeof server.specs === 'object'
      ? /** @type {Record<string, unknown>} */ (server.specs)
      : {};
  const net =
    specs.net && typeof specs.net === 'object'
      ? /** @type {Record<string, unknown>} */ (specs.net)
      : {};

  const region = resolveOfferRegionLabel(net.cc ?? specs.cc ?? server.geolocation);
  const uptimePercent = normalizeUptimePercent(server.reliability);
  const pingMs = resolveOfferPingMs(
    { ...server, net, ping: net.ping ?? server.ping, latency: net.latency ?? server.latency },
    region,
  );

  const vramGb = toFiniteNumber(specs.gpuram ?? server.gpuram);
  const diskGb = parseHostDiskGb(specs.disk ?? server.disk);
  const ramGb = toFiniteNumber(specs.ram ?? server.ram) || undefined;
  const cudaVersion = parseCudaVersion(specs.cuda ?? server.cuda) ?? undefined;

  return {
    offerId,
    providerId: 'clore',
    pricePerHour: classified.pricePerHour,
    uptimePercent,
    pingMs,
    vramGb,
    diskGb,
    numGpus: classified.numGpus,
    gpuType: classified.gpuType,
    region,
    ramGb,
    cudaVersion,
    rentable: server.rented !== true,
    raw: server,
  };
}

export { normalizeUptimePercent };
