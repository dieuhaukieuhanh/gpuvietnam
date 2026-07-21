/**
 * GPU sẵn sàng từ Vast.ai, Clore.ai.
 * Inventory dùng cùng thông số lọc với provision (PACKAGE_SPECS + OFFER_SELECTION +
 * currency/USD consistency Clore + Vast offer sanity), rồi nhóm theo
 * Provider + GPU + Uptime bucket + Ping bucket để hiển thị admin.
 * Vast.ai cần API key → mock nếu thiếu cả hai nguồn.
 * Clore.ai dùng endpoint marketplace công khai (không cần key) → luôn thử gọi thật.
 */

import {
  MIN_VRAM_GB,
  PING_THRESHOLD_MS,
  UPTIME_THRESHOLD,
  resolvePingBucket,
  resolveUptimeBucket,
} from '@/lib/infrastructure-metrics';
import {
  computeStockStatus,
  formatGpuLineLabel,
  isAsiaRegion,
} from '@/lib/infrastructure-shared';
import { usdHourlyToVnd } from '@/lib/currency';
import { OFFER_SELECTION, resolvePackageSpec } from '@/lib/gpu/gpu-config.js';
import {
  normalizeCloreOffer,
  normalizeVastOffer,
  passesOfferHardFilters,
} from '@/lib/gpu/offer-selection.js';
import {
  classifyCloreServerForLine,
  cloreServerAcceptsCurrency,
  isCloreUsdPriceConsistent,
  resolveClorePricePerHour,
} from '@/lib/gpu/providers/clore/clore-client.js';
import { filterCloreOffersByBadHostExclusion } from '@/lib/gpu/providers/clore/clore-bad-host-exclusion.js';
import { filterVastOffersBySanity } from '@/lib/gpu/providers/vast/vast-offer-sanity.js';
import { applyVastPercentilePriceBand } from '@/lib/gpu/providers/vast/vast-percentile-band.js';

/** Dòng GPU inventory = cùng map plan/gpuLine với provision. */
const INFRA_PROVISION_LINES = [
  {
    gpuLine: 'rtx3090',
    plan: 'starter',
    gpu: 'RTX 3090',
    vram: '24GB',
    vastSearch: {
      gpu_name: { eq: 'RTX 3090' },
      num_gpus: { eq: 1 },
      rentable: { eq: true },
      rented: { eq: false },
      type: 'on-demand',
      limit: 200,
    },
  },
  {
    gpuLine: 'rtx4090_1x',
    plan: 'pro',
    gpu: 'RTX 4090',
    vram: '1x 24GB',
    vastSearch: {
      gpu_name: { eq: 'RTX 4090' },
      num_gpus: { eq: 1 },
      rentable: { eq: true },
      rented: { eq: false },
      type: 'on-demand',
      limit: 200,
    },
  },
  {
    gpuLine: 'rtx5090_1x',
    plan: 'studio',
    gpu: 'RTX 5090',
    vram: '32GB',
    vastSearch: {
      gpu_name: { eq: 'RTX 5090' },
      num_gpus: { eq: 1 },
      rentable: { eq: true },
      rented: { eq: false },
      type: 'on-demand',
      limit: 200,
    },
  },
];

/**
 * @param {string} plan
 */
function hardFilterCriteriaForPlan(plan) {
  const packageSpec = resolvePackageSpec(plan);
  return {
    minHostDiskGb: packageSpec.minHostDiskGb,
    numGpus: packageSpec.numGpus,
    minVramGb: packageSpec.minVramGb ?? OFFER_SELECTION.minVramGb,
    minVramExclusive: Boolean(packageSpec.minVramExclusive),
    minCudaVersion: packageSpec.minCudaVersion ?? OFFER_SELECTION.minCudaVersion,
  };
}

/**
 * @param {import('@/lib/gpu/offer-selection.js').NormalizedOffer} offer
 * @param {{ provider: string; gpu: string; vram: string }} line
 * @returns {RawGpuOffer | null}
 */
function toInfraRawOffer(offer, line) {
  const uptime7d = offer.uptimePercent;
  if (!(uptime7d >= OFFER_SELECTION.minUptimePercent)) return null;
  const buckets = resolveOfferBuckets(uptime7d, offer.pingMs);
  if (!buckets) return null;
  return {
    provider: line.provider,
    gpu: line.gpu,
    vram: line.vram,
    region: offer.region || 'Unknown',
    price_per_hour: offer.pricePerHour,
    uptime_7d: uptime7d,
    ping_ms: offer.pingMs,
    uptime_bucket: buckets.uptime_bucket,
    ping_bucket: buckets.ping_bucket,
  };
}

export {
  UPTIME_THRESHOLD,
  PING_THRESHOLD_MS,
  MIN_VRAM_GB,
  formatGpuLineLabel,
  computeStockStatus,
  isAsiaRegion,
};

/** @typedef {'stable' | 'low' | 'scarce' | 'unavailable'} GpuStockStatus */
/** @typedef {'gt99' | 'btw_985_99' | 'btw_98_985'} UptimeBucket */
/** @typedef {'lt50' | 'btw_50_100' | 'btw_100_200' | 'btw_200_250'} PingBucket */

/**
 * @typedef {Object} InfrastructureGpuRow
 * @property {string} provider
 * @property {string} gpu
 * @property {string} vram
 * @property {UptimeBucket} uptime_bucket
 * @property {PingBucket} ping_bucket
 * @property {number} available
 * @property {number} uptime_7d
 * @property {number} ping_ms
 * @property {number} avg_price_10
 * @property {number} avg_price_10_vnd
 * @property {GpuStockStatus} status
 */

/**
 * @typedef {Object} RawGpuOffer
 * @property {string} provider
 * @property {string} gpu
 * @property {string} vram
 * @property {string} [region]
 * @property {number} price_per_hour
 * @property {number} uptime_7d
 * @property {number} ping_ms
 * @property {UptimeBucket} uptime_bucket
 * @property {PingBucket} ping_bucket
 */

export const ALLOWED_GPU_LINES = [
  { gpu: 'RTX 3090', vram: '24GB' },
  { gpu: 'RTX 4090', vram: '1x 24GB' },
  { gpu: 'RTX 5090', vram: '32GB' },
];

/**
 * Lấy trung bình giá của tối đa 10 GPU rẻ nhất (sắp xếp tăng dần).
 * @param {number[]} prices
 * @returns {number | null}
 */
export function computeAvgPrice10(prices) {
  const sorted = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const slice = sorted.slice(0, 10);
  return slice.reduce((sum, price) => sum + price, 0) / slice.length;
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Gom offer thô — GPU được phép, uptime ≥ ngưỡng, ping ≤ ngưỡng.
 * Nhóm theo Provider + GPU + Uptime bucket + Ping bucket.
 * @param {RawGpuOffer[]} offers
 * @returns {InfrastructureGpuRow[]}
 */
export function aggregateInfrastructureRows(offers) {
  /** @type {Map<string, { provider: string, gpu: string, vram: string, uptime_bucket: UptimeBucket, ping_bucket: PingBucket, prices: number[], uptimes: number[], pings: number[] }>} */
  const groups = new Map();

  for (const offer of offers) {
    const allowed = ALLOWED_GPU_LINES.some((line) => line.gpu === offer.gpu && line.vram === offer.vram);
    if (!allowed) continue;
    if (offer.uptime_7d < UPTIME_THRESHOLD) continue;
    if (!(offer.ping_ms >= 0) || offer.ping_ms > PING_THRESHOLD_MS) continue;

    const uptimeBucket = offer.uptime_bucket ?? resolveUptimeBucket(offer.uptime_7d);
    const pingBucket = offer.ping_bucket ?? resolvePingBucket(offer.ping_ms);
    if (!uptimeBucket || !pingBucket) continue;

    const key = `${offer.provider}::${offer.gpu}::${offer.vram}::${uptimeBucket}::${pingBucket}`;
    if (!groups.has(key)) {
      groups.set(key, {
        provider: offer.provider,
        gpu: offer.gpu,
        vram: offer.vram,
        uptime_bucket: uptimeBucket,
        ping_bucket: pingBucket,
        prices: [],
        uptimes: [],
        pings: [],
      });
    }
    const group = groups.get(key);
    group.prices.push(offer.price_per_hour);
    group.uptimes.push(offer.uptime_7d);
    group.pings.push(offer.ping_ms);
  }

  /** @type {InfrastructureGpuRow[]} */
  const rows = [];

  for (const group of groups.values()) {
    const available = group.prices.length;
    const avgPrice = computeAvgPrice10(group.prices);
    rows.push({
      provider: group.provider,
      gpu: group.gpu,
      vram: group.vram,
      uptime_bucket: group.uptime_bucket,
      ping_bucket: group.ping_bucket,
      available,
      uptime_7d: average(group.uptimes),
      ping_ms: average(group.pings),
      avg_price_10: avgPrice ?? 0,
      status: computeStockStatus(available),
    });
  }

  return sortInfrastructureRows(rows);
}

/**
 * @param {InfrastructureGpuRow} row
 */
function attachVndPrice(row) {
  const avg_price_10_vnd =
    row.avg_price_10_vnd ??
    (row.avg_price_10 > 0 ? usdHourlyToVnd(row.avg_price_10) : 0);
  return { ...row, avg_price_10_vnd };
}

/**
 * @param {InfrastructureGpuRow[]} rows
 */
export function enrichInfrastructureRows(rows) {
  return rows.map((row) =>
    attachVndPrice({
      ...row,
      status: row.available <= 0 ? 'unavailable' : computeStockStatus(row.available),
    }),
  );
}

/**
 * @param {InfrastructureGpuRow[]} rows
 */
export function sortInfrastructureRows(rows) {
  // Sắp xếp theo giá TB tăng dần; dòng không khả dụng (giá = 0) đẩy xuống cuối.
  return [...rows].sort((a, b) => {
    const aPrice = Number(a.avg_price_10 ?? 0);
    const bPrice = Number(b.avg_price_10 ?? 0);
    if (aPrice <= 0 && bPrice <= 0) return 0;
    if (aPrice <= 0) return 1;
    if (bPrice <= 0) return -1;
    return aPrice - bPrice;
  });
}

export function getMockInfrastructureData() {
  return enrichInfrastructureRows(
    sortInfrastructureRows([
      {
        provider: 'Vast.ai',
        gpu: 'RTX 3090',
        vram: '24GB',
        uptime_bucket: 'gt99',
        ping_bucket: 'lt50',
        available: 45,
        uptime_7d: 99.8,
        ping_ms: 42,
        avg_price_10: 0.32,
        avg_price_10_vnd: 8640,
      },
      {
        provider: 'Vast.ai',
        gpu: 'RTX 3090',
        vram: '24GB',
        uptime_bucket: 'btw_985_99',
        ping_bucket: 'btw_100_200',
        available: 22,
        uptime_7d: 98.8,
        ping_ms: 155,
        avg_price_10: 0.28,
        avg_price_10_vnd: 7560,
      },
      {
        provider: 'Vast.ai',
        gpu: 'RTX 4090',
        vram: '1x 24GB',
        uptime_bucket: 'gt99',
        ping_bucket: 'btw_50_100',
        available: 18,
        uptime_7d: 99.7,
        ping_ms: 72,
        avg_price_10: 0.44,
        avg_price_10_vnd: 11880,
      },
      {
        provider: 'Vast.ai',
        gpu: 'RTX 4090',
        vram: '1x 24GB',
        uptime_bucket: 'btw_98_985',
        ping_bucket: 'btw_50_100',
        available: 7,
        uptime_7d: 98.2,
        ping_ms: 68,
        avg_price_10: 0.46,
        avg_price_10_vnd: 12420,
      },
      {
        provider: 'Clore.ai',
        gpu: 'RTX 3090',
        vram: '24GB',
        uptime_bucket: 'gt99',
        ping_bucket: 'btw_50_100',
        available: 12,
        uptime_7d: 99.4,
        ping_ms: 78,
        avg_price_10: 0.3,
        avg_price_10_vnd: 8100,
      },
      {
        provider: 'Clore.ai',
        gpu: 'RTX 4090',
        vram: '1x 24GB',
        uptime_bucket: 'btw_985_99',
        ping_bucket: 'btw_100_200',
        available: 5,
        uptime_7d: 98.7,
        ping_ms: 140,
        avg_price_10: 0.41,
        avg_price_10_vnd: 11070,
      },
    ]),
  );
}

/**
 * @param {number} uptime7d
 * @param {number} pingMs
 * @returns {{ uptime_bucket: UptimeBucket, ping_bucket: PingBucket } | null}
 */
function resolveOfferBuckets(uptime7d, pingMs) {
  const uptimeBucket = resolveUptimeBucket(uptime7d);
  const pingBucket = resolvePingBucket(pingMs);
  if (!uptimeBucket || !pingBucket) return null;
  return { uptime_bucket: uptimeBucket, ping_bucket: pingBucket };
}

/**
 * Lấy offers thật từ Vast.ai POST /bundles/ — cùng sanity + hard filters với provision.
 * Trả về:
 *  - null  → không có key hoặc lỗi mạng/API → fallback mock.
 *  - []    → có key, API OK nhưng không có offer khớp (data thật rỗng).
 *  - RawGpuOffer[] → danh sách offers đã map sang format chung.
 * @returns {Promise<RawGpuOffer[] | null>}
 */
async function fetchVastAiOffers() {
  const apiKey = process.env.VAST_AI_KEY;
  if (!apiKey) return null;

  try {
    const responses = await Promise.all(
      INFRA_PROVISION_LINES.map(async (line) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const res = await fetch('https://console.vast.ai/api/v0/bundles/', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(line.vastSearch),
            signal: controller.signal,
          });
          if (!res.ok) {
            console.warn(`[vast.ai] bundles HTTP ${res.status}`, line.gpuLine);
            return { line, offers: [] };
          }
          const data = await res.json();
          return {
            line,
            offers: Array.isArray(data?.offers) ? data.offers : [],
          };
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    /** @type {RawGpuOffer[]} */
    const mapped = [];
    /** @type {Record<string, number>} */
    const lineCounts = {};

    for (const { line, offers } of responses) {
      /** @type {import('@/lib/gpu/offer-selection.js').NormalizedOffer[]} */
      const normalized = [];
      for (const raw of offers) {
        const offer = normalizeVastOffer(/** @type {Record<string, unknown>} */ (raw));
        if (offer) normalized.push(offer);
      }

      const { offers: saneOffers } = filterVastOffersBySanity(normalized, line.gpuLine, {
        plan: line.plan,
      });
      const criteria = hardFilterCriteriaForPlan(line.plan);
      let kept = 0;
      for (const offer of saneOffers) {
        if (!passesOfferHardFilters(offer, criteria)) continue;
        const row = toInfraRawOffer(offer, {
          provider: 'Vast.ai',
          gpu: line.gpu,
          vram: line.vram,
        });
        if (!row) continue;
        mapped.push(row);
        kept += 1;
      }
      lineCounts[line.gpuLine] = kept;
      console.info('[vast.ai] infra provision filter', {
        gpuLine: line.gpuLine,
        plan: line.plan,
        raw: offers.length,
        normalized: normalized.length,
        afterSanity: saneOffers.length,
        final: kept,
      });
    }

    console.info('[vast.ai] infra totals', {
      final: mapped.length,
      byLine: lineCounts,
      minUptimePercent: OFFER_SELECTION.minUptimePercent,
    });

    return mapped;
  } catch (err) {
    console.warn('[vast.ai] bundles fetch error:', err?.message ?? err);
    return null;
  }
}

/**
 * Lấy offers thật từ Clore.ai GET /v1/marketplace — cùng currency/hard filters với provision.
 * @returns {Promise<RawGpuOffer[] | null>}
 */
async function fetchCloreAiOffers() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let res;
    try {
      res = await fetch('https://api.clore.ai/v1/marketplace', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.warn(`[clore.ai] marketplace HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const servers = Array.isArray(data?.servers) ? data.servers : [];
    const currency = (process.env.CLORE_CURRENCY ?? 'USD-Blockchain').trim() || 'USD-Blockchain';
    const enforceUsdConsistency = currency === 'USD-Blockchain';

    /** @type {RawGpuOffer[]} */
    const mapped = [];
    /** @type {Record<string, number>} */
    const lineCounts = {};

    for (const line of INFRA_PROVISION_LINES) {
      /** @type {import('@/lib/gpu/offer-selection.js').NormalizedOffer[]} */
      const normalized = [];
      let matchedLine = 0;
      let droppedNoCurrency = 0;
      let droppedInconsistentPrice = 0;

      for (const server of servers) {
        if (!server || typeof server !== 'object') continue;
        const record = /** @type {Record<string, unknown>} */ (server);
        if (record.rented === true) continue;

        const classified = classifyCloreServerForLine(record, line.gpuLine);
        if (!classified) continue;
        matchedLine += 1;
        if (classified.hostGpuCount > 2 && record.partial_gpu_rental !== true) continue;

        if (!cloreServerAcceptsCurrency(record, currency)) {
          droppedNoCurrency += 1;
          continue;
        }
        if (enforceUsdConsistency && !isCloreUsdPriceConsistent(record)) {
          droppedInconsistentPrice += 1;
          continue;
        }

        const pricePerHour = resolveClorePricePerHour(record, classified);
        if (!(pricePerHour > 0)) continue;
        const offer = normalizeCloreOffer(record, {
          numGpus: classified.numGpus,
          gpuType: classified.gpuType,
          pricePerHour,
          hostGpuCount: classified.hostGpuCount,
        });
        if (offer) normalized.push(offer);
      }

      const band = applyVastPercentilePriceBand(normalized, {
        plan: line.plan,
        gpuLine: line.gpuLine,
      });
      const {
        offers: afterExclusion,
        droppedExcludedHost,
        droppedBlockedRegion = 0,
      } = filterCloreOffersByBadHostExclusion(band.offers, line.gpuLine);

      const criteria = hardFilterCriteriaForPlan(line.plan);
      let kept = 0;
      for (const offer of afterExclusion) {
        if (!passesOfferHardFilters(offer, criteria)) continue;
        const row = toInfraRawOffer(offer, {
          provider: 'Clore.ai',
          gpu: line.gpu,
          vram: line.vram,
        });
        if (!row) continue;
        mapped.push(row);
        kept += 1;
      }
      lineCounts[line.gpuLine] = kept;
      console.info('[clore.ai] infra provision filter', {
        currency,
        gpuLine: line.gpuLine,
        plan: line.plan,
        totalServers: servers.length,
        matchedLine,
        droppedNoCurrency,
        droppedInconsistentPrice,
        afterCurrency: normalized.length,
        percentileMode: band.mode,
        percentileDropped: band.dropped,
        droppedBlockedRegion,
        droppedExcludedHost,
        afterExclusion: afterExclusion.length,
        final: kept,
      });
    }

    console.info('[clore.ai] infra totals', {
      final: mapped.length,
      byLine: lineCounts,
      minUptimePercent: OFFER_SELECTION.minUptimePercent,
    });

    return mapped;
  } catch (err) {
    console.warn('[clore.ai] marketplace fetch error:', err?.message ?? err);
    return null;
  }
}

/**
 * @returns {Promise<InfrastructureGpuRow[]>}
 */
export async function fetchInfrastructureData() {
  const [vastOffers, cloreOffers] = await Promise.all([
    fetchVastAiOffers(),
    fetchCloreAiOffers(),
  ]);

  const liveSources = [vastOffers, cloreOffers];
  const hasLiveData = liveSources.some((source) => source !== null);

  if (hasLiveData) {
    const merged = liveSources.filter(Boolean).flat();
    return enrichInfrastructureRows(aggregateInfrastructureRows(merged));
  }

  return getMockInfrastructureData();
}
