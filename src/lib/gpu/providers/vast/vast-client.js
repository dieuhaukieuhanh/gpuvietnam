import { GPUConfigurationError, GPUProviderError } from '../../gpu-errors.js';
import {
  DEFAULT_DISK_SIZE,
  DEFAULT_GPU_IMAGE,
  DEFAULT_GPU_PORT,
  GPU_FALLBACK_LEVELS,
  GPU_REGION_SCORES,
  GPU_SCORE_WEIGHTS,
  GPU_STRICT_FILTERS,
  MAX_OFFERS_PER_REGION,
  MAX_PRICE_PREMIUM,
} from '../../gpu-config.js';
import { profStart, profEnd } from '../../../prof.js';

const VAST_API_BASE = 'https://console.vast.ai/api/v0';
const VAST_V1_API_BASE = 'https://console.vast.ai/api/v1';

const NO_GPU_MESSAGE = 'Không tìm thấy GPU phù hợp. Vui lòng thử lại sau.';

/** @type {Record<string, Record<string, unknown>>} */
const GPU_SEARCH_FILTERS = {
  rtx3090: {
    gpu_name: { in: ['RTX 3090'] },
    num_gpus: { eq: 1 },
  },
  rtx4090_1x: {
    gpu_name: { in: ['RTX 4090'] },
    num_gpus: { eq: 1 },
  },
  rtx4090_2x: {
    gpu_name: { in: ['RTX 4090'] },
    num_gpus: { eq: 2 },
  },
};

const PREFERRED_ASIA_KEYWORDS = [
  'taiwan',
  'japan',
  'singapore',
  'hong kong',
  'hongkong',
  'korea',
  'thailand',
  'malaysia',
  'indonesia',
  'vietnam',
  'philippines',
  'china',
];

const FULL_ASIA_KEYWORDS = [
  ...PREFERRED_ASIA_KEYWORDS,
  'india',
  'asia',
  'apac',
  'sydney',
  'australia',
];

/**
 * @typedef {Object} GpuFilterCriteria
 * @property {number} minReliability
 * @property {number} minDiskGb
 * @property {number} minMaxDurationDays
 * @property {number} minInetDownMbps
 * @property {number} minOpenPorts
 * @property {number} minVramGb
 * @property {number} numGpus
 * @property {'preferred' | 'full' | 'global'} asiaMode
 */

/**
 * @typedef {Object} ScoredGpuOffer
 * @property {Record<string, unknown>} offer
 * @property {number} offerId
 * @property {number} score
 * @property {number} priceScore
 * @property {number} regionScore
 * @property {number} networkScore
 * @property {number} uptimeScore
 * @property {number} dlperfScore
 * @property {number} pricePerHour
 * @property {string} region
 * @property {number} reliability
 * @property {number} downloadSpeed
 * @property {string} gpuType
 * @property {number} vramGb
 * @property {number} dlperf
 * @property {string} reason
 */

/**
 * @param {import('../../domain/gpu-instance').GPULine} gpuLine
 * @returns {Record<string, unknown>}
 */
function buildOfferSearchBody(gpuLine) {
  const gpuFilters = GPU_SEARCH_FILTERS[gpuLine];
  if (!gpuFilters) {
    throw new GPUProviderError(`Unsupported GPU line: ${gpuLine}`, { retryable: false });
  }

  return {
    ...gpuFilters,
    verified: { eq: true },
    rentable: { eq: true },
    rented: { eq: false },
    type: 'on-demand',
    limit: 128,
  };
}

/**
 * @param {import('../../domain/gpu-instance').GPULine} gpuLine
 */
function getNumGpusForLine(gpuLine) {
  if (gpuLine === 'rtx4090_2x') return 2;
  return 1;
}

/**
 * @param {unknown} value
 * @param {boolean} [defaultWhenMissing]
 */
function isTruthyFlag(value, defaultWhenMissing = true) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return defaultWhenMissing;
}

/**
 * @param {unknown} value
 */
function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * @param {Record<string, unknown>} offer
 */
function getOfferPricePerHour(offer) {
  return (
    toNumber(offer.price_per_hour) ||
    toNumber(offer.dph_total) ||
    toNumber(offer.dph) ||
    toNumber(offer.search?.dph_total)
  );
}

/**
 * Vast.ai returns gpu_ram in MB (e.g. 24564 ≈ 24GB).
 * @param {Record<string, unknown>} offer
 */
function getOfferVramGb(offer) {
  const rawMb = toNumber(offer.gpu_ram ?? offer.vram);
  if (rawMb <= 0) return 0;
  return rawMb / 1024;
}

/**
 * Vast.ai returns disk_space in GB (e.g. 628.9).
 * @param {Record<string, unknown>} offer
 */
function getOfferDiskGb(offer) {
  const rawGb = toNumber(offer.disk_space ?? offer.disk_total ?? offer.dsize ?? offer.disk_size);
  if (rawGb <= 0) return 0;
  return rawGb;
}

/**
 * @param {Record<string, unknown>} offer
 */
function getOfferMaxDurationDays(offer) {
  const raw = toNumber(offer.max_duration ?? offer.duration);
  if (raw <= 0) return 0;
  if (raw > 365) return raw / 86400;
  return raw;
}

/**
 * @param {Record<string, unknown>} offer
 */
function getOfferOpenPortCount(offer) {
  return (
    toNumber(offer.open_port_count) ||
    toNumber(offer.direct_port_count) ||
    toNumber(offer.ports) ||
    0
  );
}

/**
 * @param {Record<string, unknown>} offer
 */
function getOfferReliability(offer) {
  const raw = toNumber(offer.reliability ?? offer.reliability2);
  if (raw <= 0) return 0;
  if (raw > 1.5) return raw / 100;
  return raw;
}

/**
 * @param {Record<string, unknown>} offer
 */
function getOfferInetDown(offer) {
  return toNumber(offer.inet_down ?? offer.inet_down_mbps ?? offer.download);
}

/**
 * @param {Record<string, unknown>} offer
 */
function getOfferDlperf(offer) {
  return toNumber(offer.dlperf ?? offer.dlperf_total);
}

/**
 * @param {Record<string, unknown>} offer
 */
function getOfferRegion(offer) {
  return String(offer.geolocation ?? offer.location ?? offer.region ?? 'Unknown').trim();
}

/**
 * @param {string} geo
 * @param {'preferred' | 'full'} mode
 */
function isAsianGeo(geo, mode) {
  const normalized = geo.toLowerCase();
  const keywords = mode === 'full' ? FULL_ASIA_KEYWORDS : PREFERRED_ASIA_KEYWORDS;
  return keywords.some((keyword) => normalized.includes(keyword));
}

/**
 * @param {string} geo
 */
function getRegionScore(geo) {
  const normalized = geo.toLowerCase();

  for (const [keyword, score] of Object.entries(GPU_REGION_SCORES)) {
    if (normalized.includes(keyword)) {
      return score;
    }
  }

  if (isAsianGeo(geo, 'full')) return 55;
  return 0;
}

/**
 * @param {Record<string, unknown>} offer
 * @param {GpuFilterCriteria} criteria
 */
function passesHardFilters(offer, criteria) {
  const rentable = offer.rentable ?? offer.search?.rentable;
  if (!isTruthyFlag(rentable, false)) return false;

  const numGpus = toNumber(offer.num_gpus);
  if (numGpus !== criteria.numGpus) return false;

  const gpuRamGb = getOfferVramGb(offer);
  if (gpuRamGb < criteria.minVramGb) return false;

  const openPorts = getOfferOpenPortCount(offer);
  if (criteria.minOpenPorts > 0 && openPorts < criteria.minOpenPorts) return false;

  const reliability = getOfferReliability(offer);
  if (reliability < criteria.minReliability) return false;

  const diskGb = getOfferDiskGb(offer);
  if (diskGb < criteria.minDiskGb) return false;

  const maxDurationDays = getOfferMaxDurationDays(offer);
  if (maxDurationDays > 0 && maxDurationDays < criteria.minMaxDurationDays) return false;

  const inetDown = getOfferInetDown(offer);
  if (inetDown < criteria.minInetDownMbps) return false;

  const region = getOfferRegion(offer);
  if (criteria.asiaMode !== 'global' && !isAsianGeo(region, criteria.asiaMode)) return false;

  return true;
}

/**
 * @param {Record<string, unknown>} offer
 * @param {{ minPrice: number; maxPrice: number; maxDlperf: number }} context
 */
function scoreOffer(offer, context) {
  const pricePerHour = getOfferPricePerHour(offer);
  const region = getOfferRegion(offer);
  const reliability = getOfferReliability(offer);
  const inetDown = getOfferInetDown(offer);
  const dlperf = getOfferDlperf(offer);

  let priceScore = 100;
  if (context.maxPrice > context.minPrice) {
    priceScore =
      100 - ((pricePerHour - context.minPrice) / (context.maxPrice - context.minPrice)) * 100;
  }

  const regionScore = getRegionScore(region);
  const networkScore = Math.min(100, inetDown / 10);
  const uptimeScore = reliability * 100;
  const dlperfScore =
    context.maxDlperf > 0 ? Math.min(100, (dlperf / context.maxDlperf) * 100) : 0;

  const score =
    priceScore * GPU_SCORE_WEIGHTS.price +
    regionScore * GPU_SCORE_WEIGHTS.region +
    networkScore * GPU_SCORE_WEIGHTS.network +
    uptimeScore * GPU_SCORE_WEIGHTS.uptime +
    dlperfScore * GPU_SCORE_WEIGHTS.dlperf;

  return {
    score: Math.round(score * 100) / 100,
    priceScore: Math.round(priceScore * 10) / 10,
    regionScore,
    networkScore: Math.round(networkScore * 10) / 10,
    uptimeScore: Math.round(uptimeScore * 10) / 10,
    dlperfScore: Math.round(dlperfScore * 10) / 10,
    pricePerHour,
    region,
    reliability,
    downloadSpeed: inetDown,
    gpuType: String(offer.gpu_name ?? offer.gpu_type ?? 'GPU'),
    vramGb: getOfferVramGb(offer),
    dlperf,
  };
}

/**
 * @param {ReturnType<typeof scoreOffer>} scored
 * @param {string} fallbackLabel
 */
function buildSelectionReason(scored, fallbackLabel) {
  const uptimePct = (scored.reliability * 100).toFixed(1);
  const priceLabel =
    scored.priceScore >= 90
      ? 'Giá rẻ nhất trong nhóm phù hợp'
      : scored.priceScore >= 70
        ? 'Giá tốt'
        : 'Cân bằng giá/hiệu năng';

  const parts = [
    `${priceLabel} khu vực ${scored.region}`,
    `uptime ${uptimePct}%`,
    `mạng ${Math.round(scored.downloadSpeed)} Mbps`,
    `điểm ${scored.score}`,
  ];

  if (fallbackLabel !== 'asia_preferred') {
    parts.push(`(${fallbackLabel})`);
  }

  return parts.join(', ');
}

/**
 * DEBUG: Log sample rejected offers when hard filters eliminate all candidates.
 * @param {Array<Record<string, unknown>>} candidates
 * @param {GpuFilterCriteria} criteria
 * @param {string} fallbackLabel
 */
function logHardFilterRejections(candidates, criteria, fallbackLabel) {
  if (candidates.length === 0) return;

  const sample = candidates.slice(0, 3);
  const requiredGpus = criteria.numGpus;
  const minReliability = criteria.minReliability;
  const minDisk = criteria.minDiskGb;
  const minMaxDurationDays = criteria.minMaxDurationDays;
  const minInetDown = criteria.minInetDownMbps;

  console.warn(
    `[vast/debug] ${fallbackLabel}: 0/${candidates.length} offers passed hard filters — sample rejections:`,
  );

  sample.forEach((offer, index) => {
    const rentable = offer.rentable ?? offer.search?.rentable;
    const region = getOfferRegion(offer);
    /** @type {string[]} */
    const reasons = [];

    if (!isTruthyFlag(rentable, false)) {
      reasons.push(`not rentable (rentable=${rentable})`);
    }
    if (toNumber(offer.num_gpus) !== requiredGpus) {
      reasons.push(`num_gpus=${offer.num_gpus} need=${requiredGpus}`);
    }
    const gpuRamGb = getOfferVramGb(offer);
    if (gpuRamGb < criteria.minVramGb) {
      reasons.push(`gpu_ram=${offer.gpu_ram}MB (~${gpuRamGb.toFixed(1)}GB < ${criteria.minVramGb}GB)`);
    }
    const ports = getOfferOpenPortCount(offer);
    if (ports < criteria.minOpenPorts) {
      reasons.push(
        `ports=${offer.open_port_count ?? offer.direct_port_count ?? ports} need>=${criteria.minOpenPorts}`,
      );
    }
    const reliability = getOfferReliability(offer);
    if (reliability < minReliability) {
      reasons.push(`reliability=${offer.reliability ?? reliability} (<${minReliability})`);
    }
    const diskGb = getOfferDiskGb(offer);
    if (diskGb < minDisk) {
      reasons.push(
        `disk=${offer.disk_space ?? offer.disk_total ?? offer.dsize ?? diskGb}GB (<${minDisk}GB)`,
      );
    }
    const maxDurationDays = getOfferMaxDurationDays(offer);
    if (maxDurationDays > 0 && maxDurationDays < minMaxDurationDays) {
      reasons.push(
        `max_duration=${offer.max_duration ?? offer.duration} (~${maxDurationDays}d < ${minMaxDurationDays}d)`,
      );
    }
    const inetDown = getOfferInetDown(offer);
    if (inetDown < minInetDown) {
      reasons.push(`inet_down=${offer.inet_down ?? inetDown}Mbps (<${minInetDown}Mbps)`);
    }
    if (criteria.asiaMode !== 'global' && !isAsianGeo(region, criteria.asiaMode)) {
      reasons.push(`region=${region} (asiaMode=${criteria.asiaMode})`);
    }

    console.log(`[vast/debug] Offer #${index + 1} REJECTED: ${reasons.join(', ') || 'unknown'}`);
    console.log(
      '[vast/debug] Raw fields:',
      JSON.stringify({
        rentable: offer.rentable ?? offer.search?.rentable,
        num_gpus: offer.num_gpus,
        gpu_ram_mb: offer.gpu_ram,
        gpu_ram_gb: gpuRamGb,
        open_port_count: offer.open_port_count,
        direct_port_count: offer.direct_port_count,
        reliability: offer.reliability,
        disk_space: offer.disk_space,
        disk_total: offer.disk_total,
        disk_free: offer.disk_free,
        dsize: offer.dsize,
        max_duration: offer.max_duration,
        duration: offer.duration,
        inet_down: offer.inet_down,
        geolocation: offer.geolocation,
      }),
    );
  });
}

/**
 * @param {Array<Record<string, unknown>>} offers
 * @param {GpuFilterCriteria} criteria
 * @param {string} fallbackLabel
 */
function rankOffers(offers, criteria, fallbackLabel) {
  const filtered = offers.filter((offer) => passesHardFilters(offer, criteria));

  if (filtered.length === 0) {
    logHardFilterRejections(offers, criteria, fallbackLabel);
    return [];
  }

  const prices = filtered.map(getOfferPricePerHour).filter((value) => value > 0);
  const dlperfs = filtered.map(getOfferDlperf).filter((value) => value > 0);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const maxDlperf = dlperfs.length > 0 ? Math.max(...dlperfs) : 0;

  /** @type {ScoredGpuOffer[]} */
  const scoredOffers = filtered.map((offer) => {
    const metrics = scoreOffer(offer, { minPrice, maxPrice, maxDlperf });
    const offerId = Number(offer.id ?? offer.ask_contract_id);
    const reason = buildSelectionReason(metrics, fallbackLabel);

    return {
      offer,
      offerId,
      reason,
      ...metrics,
    };
  });

  scoredOffers.sort((a, b) => b.score - a.score);

  console.info(
    `[vast/findBestGPU] ${fallbackLabel}: ${filtered.length}/${offers.length} offers passed filters. Top 3:`,
    scoredOffers.slice(0, 3).map((item) => ({
      offerId: item.offerId,
      score: item.score,
      region: item.region,
      price: item.pricePerHour,
      reliability: item.reliability,
      inet_down: item.downloadSpeed,
    })),
  );

  return scoredOffers;
}

/**
 * @param {ScoredGpuOffer} best
 * @param {string} filterLabel
 */
function toGpuOfferSelection(best, filterLabel) {
  const port = Number(best.offer.direct_port_start ?? best.offer.port ?? DEFAULT_GPU_PORT);
  const ipAddress =
    typeof best.offer.public_ipaddr === 'string'
      ? best.offer.public_ipaddr
      : typeof best.offer.public_ip === 'string'
        ? best.offer.public_ip
        : null;

  return {
    ...best,
    offer_id: best.offerId,
    ip_address: ipAddress,
    port,
    gpu_type: best.gpuType,
    vram: best.vramGb,
    price_per_hour: best.pricePerHour,
    download_speed: best.downloadSpeed,
    fallbackLevel: filterLabel,
  };
}

/**
 * @param {import('../../domain/gpu-instance').GPULine | string} gpuType
 * @param {string | null | undefined} [plan]
 * @param {Array<Record<string, unknown>>} [offers]
 * @param {number} [limit]
 */
export function findRankedGPUOffers(gpuType, plan, offers = [], limit = 10) {
  const gpuLine = /** @type {import('../../domain/gpu-instance').GPULine} */ (String(gpuType));
  const numGpus = getNumGpusForLine(gpuLine);

  console.info(
    `[vast/findRankedGPUOffers] Selecting GPU line=${gpuLine}, plan=${plan ?? 'n/a'}, candidates=${offers.length}, limit=${limit}`,
  );

  if (!offers.length) {
    throw new GPUProviderError(NO_GPU_MESSAGE, { retryable: true });
  }

  /** @type {ReturnType<typeof toGpuOfferSelection>[]} */
  const selections = [];

  for (const level of GPU_FALLBACK_LEVELS) {
    if (selections.length >= limit) break;

    const criteria = {
      ...GPU_STRICT_FILTERS,
      numGpus,
      asiaMode: level.asiaMode,
    };
    const ranked = rankOffers(offers, criteria, level.label);
    if (ranked.length === 0) continue;

    for (const item of ranked) {
      if (selections.some((entry) => entry.offer_id === item.offerId)) continue;
      selections.push(toGpuOfferSelection(item, level.label));
      if (selections.length >= limit) break;
    }
  }

  if (!selections.length) {
    throw new GPUProviderError(NO_GPU_MESSAGE, { retryable: true });
  }

  return selections;
}

/**
 * @param {unknown} error
 */
function isOfferRentError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /no_such_ask|not available|already rented|offer.*unavailable|404\/3603/i.test(message);
}

/**
 * Find the best Vast.ai offer using hard filters, price-first scoring, and geography fallback.
 * @param {import('../../domain/gpu-instance').GPULine | string} gpuType
 * @param {string | null | undefined} [plan]
 * @param {Array<Record<string, unknown>>} [offers]
 * @returns {ScoredGpuOffer & {
 *   offer_id: number;
 *   ip_address: string | null;
 *   port: number;
 *   gpu_type: string;
 *   vram: number;
 *   price_per_hour: number;
 *   download_speed: number;
 *   fallbackLevel: string;
 * }}
 */
export function findBestGPU(gpuType, plan, offers = []) {
  return findRankedGPUOffers(gpuType, plan, offers, 1)[0];
}

/**
 * Low-level HTTP client for Vast.ai REST API.
 * No business logic — transport only.
 */
export class VastClient {
  /**
   * @param {{ apiKey?: string; baseUrl?: string }} [options]
   */
  constructor(options = {}) {
    this.apiKey = (options.apiKey ?? process.env.VAST_AI_KEY ?? process.env.VAST_API_KEY ?? '').trim();
    this.baseUrl = options.baseUrl ?? VAST_API_BASE;
  }

  /**
   * @param {'GET'|'POST'|'PUT'|'DELETE'} method
   * @param {string} path
   * @param {Record<string, unknown> | undefined} [body]
   * @param {{ baseUrl?: string }} [options]
   */
  async request(method, path, body, options = {}) {
    if (!this.apiKey) {
      throw new GPUConfigurationError('VAST_AI_KEY is not configured');
    }

    const baseUrl = options.baseUrl ?? this.baseUrl;
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    /** @type {RequestInit} */
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    const __prof = profStart(`Vast ${method} ${path}`);
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new GPUProviderError(`Vast.ai network error: ${error.message}`, {
        cause: error,
        retryable: true,
      });
    } finally {
      profEnd(__prof);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const detail =
        typeof payload === 'object' && payload && 'msg' in payload
          ? String(payload.msg)
          : typeof payload === 'string'
            ? payload
            : response.statusText;
      throw new GPUProviderError(`Vast.ai ${response.status}: ${detail}`, {
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    return payload;
  }

  /**
   * @param {import('../../domain/gpu-instance').GPULine} gpuLine
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async searchOffers(gpuLine) {
    const searchBody = buildOfferSearchBody(gpuLine);
    const offersResponse = await this.request('POST', '/bundles/', searchBody);
    return Array.isArray(offersResponse?.offers)
      ? offersResponse.offers
      : Array.isArray(offersResponse)
        ? offersResponse
        : [];
  }

  /**
   * @param {{ gpuLine: import('../../domain/gpu-instance').GPULine; region?: string; plan?: string; image?: string; label?: string; env?: Record<string, string>; diskSize?: number; port?: number }} params
   */
  async createInstance(params) {
    const offerList = await this.searchOffers(params.gpuLine);

    console.info(
      `[vast/createInstance] Fetched ${offerList.length} raw offers for ${params.gpuLine}`,
    );

    let scopedOffers = offerList;
    if (params.region) {
      const regionNeedle = params.region.toLowerCase();
      const regionMatches = offerList.filter((offer) =>
        getOfferRegion(offer).toLowerCase().includes(regionNeedle),
      );
      if (regionMatches.length > 0) {
        scopedOffers = regionMatches;
        console.info(
          `[vast/createInstance] Region hint "${params.region}" narrowed to ${regionMatches.length} offers`,
        );
      }
    }

    const comfyPort = params.port ?? DEFAULT_GPU_PORT;
    const portMappingKey = `-p ${comfyPort}:${comfyPort}`;
    const rentBody = {
      label: params.label ?? 'gpuvietnam',
      image: params.image ?? DEFAULT_GPU_IMAGE,
      disk: params.diskSize ?? DEFAULT_DISK_SIZE,
      runtype: 'args',
      target_state: 'running',
      env: {
        ...(params.env ?? {}),
        [portMappingKey]: '1',
        COMFYUI_PORT: String(comfyPort),
      },
    };

    const triedOfferIds = new Set();
    /** @type {Error | null} */
    let lastRentError = null;

    /**
     * @param {ReturnType<typeof findRankedGPUOffers>} candidates
     * @param {string} sourceLabel
     */
    const rentFromCandidates = async (candidates, sourceLabel) => {
      const prices = candidates.map((c) => c.price_per_hour).filter((p) => p > 0);
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      const priceCap = minPrice > 0 ? minPrice * MAX_PRICE_PREMIUM : Infinity;

      const skippedRegions = new Set();
      /** @type {Map<string, number>} */
      const triesPerRegion = new Map();

      for (const best of candidates) {
        const offerId = best.offer_id;
        if (!offerId || triedOfferIds.has(offerId)) continue;

        const region = best.region ?? 'Unknown';
        if (skippedRegions.has(region)) continue;

        if (best.price_per_hour > priceCap) {
          skippedRegions.add(region);
          console.info(
            `[vast/createInstance] ${region}: price $${best.price_per_hour} > cap $${priceCap.toFixed(4)} (${sourceLabel}), skipping region`,
          );
          continue;
        }

        const tries = triesPerRegion.get(region) ?? 0;
        if (tries >= MAX_OFFERS_PER_REGION) continue;

        triedOfferIds.add(offerId);
        triesPerRegion.set(region, tries + 1);

        try {
          return await this.rentOffer(best, offerId, rentBody);
        } catch (error) {
          if (isOfferRentError(error)) {
            console.warn(
              `[vast/createInstance] Offer ${offerId} unavailable (${sourceLabel}), trying next...`,
              error instanceof Error ? error.message : error,
            );
            lastRentError = error instanceof Error ? error : new Error(String(error));
            continue;
          }
          throw error;
        }
      }
      return null;
    };

    let candidates = findRankedGPUOffers(params.gpuLine, params.plan, scopedOffers, 10);
    let rented = await rentFromCandidates(candidates, 'initial');

    if (!rented) {
      console.info('[vast/createInstance] All top offers unavailable, refetching offer list...');
      const freshResponse = await this.request('POST', '/bundles/', searchBody);
      const freshList = Array.isArray(freshResponse?.offers)
        ? freshResponse.offers
        : Array.isArray(freshResponse)
          ? freshResponse
          : [];
      let freshScoped = freshList;
      if (params.region) {
        const regionNeedle = params.region.toLowerCase();
        const regionMatches = freshList.filter((offer) =>
          getOfferRegion(offer).toLowerCase().includes(regionNeedle),
        );
        if (regionMatches.length > 0) {
          freshScoped = regionMatches;
        }
      }
      candidates = findRankedGPUOffers(params.gpuLine, params.plan, freshScoped, 10);
      rented = await rentFromCandidates(candidates, 'refetch');
    }

    if (!rented) {
      throw new GPUProviderError(lastRentError?.message ?? NO_GPU_MESSAGE, {
        retryable: true,
        cause: lastRentError ?? undefined,
      });
    }

    return rented;
  }

  /**
   * @param {ReturnType<typeof findRankedGPUOffers>[number]} best
   * @param {number} offerId
   * @param {Record<string, unknown>} rentBody
   */
  async rentOffer(best, offerId, rentBody) {
    const rented = await this.request('PUT', `/asks/${offerId}/`, rentBody);
    const instanceId = String(
      rented?.new_contract ?? rented?.id ?? rented?.instance_id ?? '',
    );

    const selectionMeta = {
      offer_id: best.offer_id,
      score: best.score,
      reason: best.reason,
      region: best.region,
      price_per_hour: best.price_per_hour,
      reliability: best.reliability,
      download_speed: best.download_speed,
      fallback_level: best.fallbackLevel,
    };

    console.info('[vast/createInstance] Rented offer', {
      offerId,
      instanceId: instanceId || '(pending)',
      image: rentBody.image,
    });

    if (instanceId) {
      try {
        const live = await this.getInstance(instanceId);
        return {
          ...rented,
          ...live,
          new_contract: instanceId,
          id: instanceId,
          gpuvietnam_selection: selectionMeta,
        };
      } catch (error) {
        console.warn('[vast/createInstance] Could not fetch instance after rent:', error);
      }
    }

    if (rented && typeof rented === 'object') {
      rented.gpuvietnam_selection = selectionMeta;
    }

    return rented;
  }

  /** @param {string} instanceId */
  async destroyInstance(instanceId) {
    return this.request('DELETE', `/instances/${instanceId}/`);
  }

  /**
   * v1 instances list filtered to a single contract id (HostPort discovery).
   * @param {string | number} instanceId
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async listInstanceV1(instanceId) {
    const numericId = Number(instanceId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new GPUProviderError(`Invalid Vast instance id: ${instanceId}`, { retryable: false });
    }

    const selectFilters = JSON.stringify({ id: { eq: numericId } });
    const selectCols = JSON.stringify(['id', 'public_ipaddr', 'ports', 'actual_status', 'cur_state']);
    const query = new URLSearchParams({
      select_filters: selectFilters,
      select_cols: selectCols,
      limit: '1',
    });

    const payload = await this.request('GET', `/instances/?${query.toString()}`, undefined, {
      baseUrl: VAST_V1_API_BASE,
    });

    const instances = payload?.instances;
    if (Array.isArray(instances) && instances.length > 0) {
      const first = instances[0];
      return first && typeof first === 'object' ? /** @type {Record<string, unknown>} */ (first) : null;
    }

    return null;
  }

  /** @param {string} instanceId */
  async getInstance(instanceId) {
    const payload = await this.request('GET', `/instances/${instanceId}/`);

    console.info('====================================');
    console.info('[vast/getInstance] GET /instances/{id}/ response');
    console.info('instanceId:', instanceId);
    console.info('full response:', JSON.stringify(payload, null, 2));

    const nestedInstance = Array.isArray(payload?.instances)
      ? payload.instances[0]
      : payload?.instances;
    const fieldSources = [
      { label: 'root', record: payload },
      { label: 'instances', record: nestedInstance },
    ];
    const connectivityFields = [
      'ssh_host',
      'ssh_port',
      'machine_dir_ssh_port',
      'public_ipaddr',
      'ports',
      'actual_ports',
    ];

    for (const { label, record } of fieldSources) {
      if (!record || typeof record !== 'object') {
        console.info(`[vast/getInstance] connectivity fields (${label}): (not an object)`);
        continue;
      }
      console.info(`[vast/getInstance] connectivity fields (${label}):`);
      for (const field of connectivityFields) {
        const value = record[field];
        console.info(`  ${field}:`, value === undefined ? '(missing)' : value);
      }
    }

    console.info('====================================');

    return payload;
  }
}

/**
 * @param {Array<Record<string, unknown>>} offers
 * @param {string | undefined} region
 */
function filterOffersByRegion(offers, region) {
  if (!region) return offers;
  const needle = region.toLowerCase();
  const matched = offers.filter((offer) => {
    const geo = getOfferRegion(offer).toLowerCase();
    return geo.includes(needle);
  });
  return matched.length > 0 ? matched : offers;
}

export { filterOffersByRegion, buildOfferSearchBody, NO_GPU_MESSAGE };
