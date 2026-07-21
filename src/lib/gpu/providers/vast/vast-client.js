import { GPUConfigurationError, GPUProviderError } from '../../gpu-errors.js';
import {
  DEFAULT_GPU_PORT,
  NO_AVAILABLE_WORKSTATION_MESSAGE,
  resolveGpuImage,
  resolvePackageDiskSize,
  resolvePackageSpec,
} from '../../gpu-config.js';
import {
  normalizeVastOffer,
  selectWorkstationOffers,
} from '../../offer-selection.js';
import {
  filterVastOffersBySanity,
  formatVastBadHostError,
  readVastDlperf,
  readVastGpuPricePerHour,
} from './vast-offer-sanity.js';
import { rememberVastBadHost, resolveVastHostKey, isVastHostExcluded } from './vast-bad-host-exclusion.js';
import { hostKeyIsExcluded } from '../../exclude-host-keys.js';
import { runVastProvisionGate, classifyVastGateFailReason } from './vast-provision-gate.js';
import {
  appendProvisionJournal,
  buildProvisionJournalEntry,
} from '../../provision-journal.js';
import {
  applyHostReputationToOffers,
  rememberHostFailure,
} from '../../host-reputation/index.js';
import {
  applyRetryDecision,
  decideRetryPolicy,
  shouldRetryAnotherHost,
} from '../../../provider-retry-policy/index.js';
import { walkRentCandidates } from '../../rent-candidate-walk.js';
import { profStart, profEnd } from '../../../prof.js';
import { logger } from '../../../logging/index.js';
import { providerDiag } from '../../../logging/provider-fields.js';

const VAST_API_BASE = 'https://console.vast.ai/api/v0';
const VAST_V1_API_BASE = 'https://console.vast.ai/api/v1';
const providerLog = () => logger('provider');

const NO_GPU_MESSAGE = NO_AVAILABLE_WORKSTATION_MESSAGE;

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
  rtx5090_1x: {
    gpu_name: { in: ['RTX 5090'] },
    num_gpus: { eq: 1 },
    // Marketplace reports VRAM in MB — require > 30GB.
    gpu_ram: { gt: 30 * 1024 },
  },
};

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

export function findRankedGPUOffers(gpuType, plan, offers = [], limit = 10) {
  const gpuLine = /** @type {import('../../domain/gpu-instance').GPULine} */ (String(gpuType));

  console.info(
    `[vast/findRankedGPUOffers] Selecting GPU line=${gpuLine}, plan=${plan ?? 'n/a'}, candidates=${offers.length}, limit=${limit}`,
  );

  if (!offers.length) {
    throw new GPUProviderError(NO_GPU_MESSAGE, { retryable: true });
  }

  /** @type {import('../../offer-selection.js').NormalizedOffer[]} */
  const normalized = [];
  for (const raw of offers) {
    const offer = normalizeVastOffer(/** @type {Record<string, unknown>} */ (raw));
    if (offer) normalized.push(offer);
  }

  const { offers: saneOffers } = filterVastOffersBySanity(normalized, gpuLine, { plan });
  if (!saneOffers.length) {
    throw new GPUProviderError(NO_GPU_MESSAGE, { retryable: true });
  }

  const selected = selectWorkstationOffers(saneOffers, { plan, gpuLine });
  if (!selected.length) {
    throw new GPUProviderError(NO_GPU_MESSAGE, { retryable: true });
  }

  const { offers: reputationRanked } = applyHostReputationToOffers(
    selected,
    (offer) =>
      resolveVastHostKey(
        offer.raw && typeof offer.raw === 'object'
          ? /** @type {Record<string, unknown>} */ (offer.raw)
          : null,
        gpuLine,
      ),
  );
  if (!reputationRanked.length) {
    throw new GPUProviderError(NO_GPU_MESSAGE, { retryable: true });
  }

  return reputationRanked.slice(0, limit).map((item) => {
    const raw = item.raw ?? {};
    const port = Number(raw.direct_port_start ?? raw.port ?? DEFAULT_GPU_PORT);
    const ipAddress =
      typeof raw.public_ipaddr === 'string'
        ? raw.public_ipaddr
        : typeof raw.public_ip === 'string'
          ? raw.public_ip
          : null;
    const dlperf = item.dlperf ?? readVastDlperf(/** @type {Record<string, unknown>} */ (raw));
    const dphBase = item.dphBase ?? readVastGpuPricePerHour(/** @type {Record<string, unknown>} */ (raw), item.pricePerHour);

    return {
      offer: raw,
      offerId: item.offerId,
      offer_id: item.offerId,
      score: item.uptimePercent,
      priceScore: 0,
      regionScore: 0,
      networkScore: 0,
      uptimeScore: item.uptimePercent,
      dlperfScore: dlperf,
      pricePerHour: item.pricePerHour,
      price_per_hour: item.pricePerHour,
      dph_total: item.pricePerHour,
      dph_base: dphBase,
      region: item.region,
      reliability: item.uptimePercent / 100,
      downloadSpeed: 0,
      download_speed: 0,
      gpuType: item.gpuType,
      gpu_type: item.gpuType,
      gpu_name: item.gpuType,
      vramGb: item.vramGb,
      vram: item.vramGb,
      dlperf,
      reason: item.reason,
      ip_address: ipAddress,
      port,
      fallbackLevel: item.uptimeGroup,
      uptimeGroup: item.uptimeGroup,
      pingMs: item.pingMs,
    };
  });
}

export function findBestGPU(gpuType, plan, offers = []) {
  return findRankedGPUOffers(gpuType, plan, offers, 1)[0];
}

/**
 * @param {unknown} error
 * @param {{ retryCount?: number; hostId?: string|null; requestId?: string|null }} [options]
 */
function isOfferRentError(error, options = {}) {
  const decision = decideRetryPolicy({
    provider: 'vast',
    operation: 'rent',
    error,
    retryCount: options.retryCount ?? 0,
    hostId: options.hostId ?? null,
    requestId: options.requestId ?? null,
  });
  return (
    !decision.failImmediately &&
    (shouldRetryAnotherHost(decision) || Boolean(decision.refreshMarketplace))
  );
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
   * @param {{
   *   gpuLine: import('../../domain/gpu-instance').GPULine;
   *   region?: string;
   *   plan?: string;
   *   image?: string;
   *   label?: string;
   *   env?: Record<string, string>;
   *   diskSize?: number;
   *   port?: number;
   *   excludeHostKeys?: string[];
   * }} params
   */
  async createInstance(params) {
    const offerList = await this.searchOffers(params.gpuLine);

    console.info(
      `[vast/createInstance] Fetched ${offerList.length} raw offers for ${params.gpuLine}`,
    );

    const packageSpec = resolvePackageSpec(params.plan, params.gpuLine);
    const comfyPort = params.port ?? DEFAULT_GPU_PORT;
    const portMappingKey = `-p ${comfyPort}:${comfyPort}`;
    const rentBody = {
      label: params.label ?? 'gpuvietnam',
      image: params.image ?? resolveGpuImage(params.gpuLine),
      disk: params.diskSize ?? resolvePackageDiskSize(params.plan, params.gpuLine),
      runtype: 'args',
      target_state: 'running',
      env: {
        ...(params.env ?? {}),
        [portMappingKey]: '1',
        COMFYUI_PORT: String(comfyPort),
        GPUVIETNAM_PACKAGE: packageSpec.planKey,
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
      const walked = await walkRentCandidates({
        providerId: 'vast',
        sourceLabel,
        candidates,
        getOfferId: (best) =>
          best && typeof best === 'object' && 'offer_id' in best
            ? /** @type {{ offer_id?: string|number|null }} */ (best).offer_id
            : null,
        shouldSkip: (best, offerId) => {
          const hostKey = resolveVastHostKey(
            best && typeof best === 'object' && 'offer' in best && best.offer && typeof best.offer === 'object'
              ? /** @type {Record<string, unknown>} */ (best.offer)
              : null,
            params.gpuLine,
          );
          if (hostKey && isVastHostExcluded(hostKey.split('|')[0])) {
            console.warn(
              `[vast/createInstance] Skipping excluded bad host ${hostKey} (offer ${offerId})`,
            );
            return true;
          }
          if (hostKey && hostKeyIsExcluded(hostKey, params.excludeHostKeys)) {
            console.warn(
              `[vast/createInstance] Skipping dual-run excluded host ${hostKey} (offer ${offerId})`,
            );
            return true;
          }
          return false;
        },
        rentOne: async (best, offerId) => {
          triedOfferIds.add(offerId);
          return this.rentOffer(best, offerId, rentBody, params.gpuLine);
        },
        cancelOrphan: async (_best, offerId) => {
          // rentOffer already destroys on post-rent gate failure; this catches
          // lost-response / partial-create cases before walking to the next host.
          const label = String(rentBody.label ?? '').trim();
          if (!label) return;
          const rows = await this.listInstancesByLabel(label);
          for (const row of rows) {
            const id = row?.id ?? row?.new_contract;
            if (id == null) continue;
            const ask = row?.ask_contract_id ?? row?.ask_id ?? row?.offer_id;
            if (ask != null && String(ask) !== String(offerId)) continue;
            console.warn(
              `[vast/createInstance] Cancel orphan instance ${id} for offer ${offerId} before next candidate`,
            );
            await this.destroyInstance(String(id));
          }
        },
        afterFailure: async ({ candidate: best, offerId, error, triedCount }) => {
          const hostKey = resolveVastHostKey(
            best && typeof best === 'object' && 'offer' in best && best.offer && typeof best.offer === 'object'
              ? /** @type {Record<string, unknown>} */ (best.offer)
              : null,
            params.gpuLine,
          );
          if (hostKey) {
            rememberHostFailure(hostKey, {
              error,
              phase: 'rent',
              region:
                best && typeof best === 'object' && 'region' in best && best.region != null
                  ? String(best.region)
                  : null,
              gpuType:
                best && typeof best === 'object' && 'gpuType' in best && best.gpuType != null
                  ? String(best.gpuType)
                  : null,
              gpuLine: params.gpuLine != null ? String(params.gpuLine) : null,
            });
          }
          const decision = decideRetryPolicy({
            provider: 'vast',
            operation: 'rent',
            error,
            retryCount: Math.max(0, triedCount - 1),
            hostId: offerId,
          });
          await applyRetryDecision(decision, {
            provider: 'vast',
            operation: 'rent',
            hostId: offerId,
            retryCount: Math.max(0, triedCount - 1),
          });
          if (
            !decision.failImmediately &&
            (shouldRetryAnotherHost(decision) || decision.refreshMarketplace)
          ) {
            lastRentError = error instanceof Error ? error : new Error(String(error));
            return 'continue';
          }
          return 'throw';
        },
      });
      if (walked.lastError) lastRentError = walked.lastError;
      return walked.result;
    };

    let candidates = findRankedGPUOffers(params.gpuLine, params.plan, offerList, 3);
    let rented = await rentFromCandidates(candidates, 'initial');

    if (!rented) {
      console.info('[vast/createInstance] All top offers unavailable, refetching offer list...');
      const freshList = await this.searchOffers(params.gpuLine);
      candidates = findRankedGPUOffers(params.gpuLine, params.plan, freshList, 3);
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

  async rentOffer(best, offerId, rentBody, gpuLine) {
    const rented = await this.request('PUT', `/asks/${offerId}/`, rentBody);
    const instanceId = String(
      rented?.new_contract ?? rented?.id ?? rented?.instance_id ?? '',
    );

    const hostKeyForMeta = resolveVastHostKey(
      best?.offer && typeof best.offer === 'object'
        ? /** @type {Record<string, unknown>} */ (best.offer)
        : null,
      gpuLine,
    );
    const selectionMeta = {
      offer_id: best.offer_id,
      host_key: hostKeyForMeta,
      gpu_line: gpuLine != null ? String(gpuLine) : null,
      score: best.score,
      reason: best.reason,
      region: best.region,
      price_per_hour: best.price_per_hour,
      dph_total: best.dph_total ?? best.price_per_hour,
      dph_base: best.dph_base ?? null,
      dlperf: best.dlperf ?? null,
      gpu_name: best.gpu_name ?? best.gpuType ?? null,
      reliability: best.reliability,
      download_speed: best.download_speed,
      fallback_level: best.fallbackLevel,
    };

    providerLog().info(
      providerDiag({
        operation: 'vast.createInstance',
        phase: 'SUCCESS',
        provider: 'vast',
        offerId,
        instanceId: instanceId || null,
        machineId: instanceId || null,
        gpuType: selectionMeta.gpu_name != null ? String(selectionMeta.gpu_name) : null,
        gpuCount: Number(best.num_gpus ?? best.numGpus ?? 1) || 1,
        region: best.geolocation != null ? String(best.geolocation) : best.region != null ? String(best.region) : null,
        retryCount: Number(selectionMeta.fallback_level ?? 0) || 0,
        image: rentBody.image,
        dph_total: selectionMeta.dph_total,
        dlperf: selectionMeta.dlperf,
      }),
      'vast createInstance rented offer',
    );

    if (!instanceId) {
      if (rented && typeof rented === 'object') {
        rented.gpuvietnam_selection = selectionMeta;
      }
      return rented;
    }

    const internalPort = Number(rentBody?.env?.COMFYUI_PORT) || DEFAULT_GPU_PORT;
    const rentedAtMs = Date.now();
    const hostKeyForJournal =
      resolveVastHostKey(
        best?.offer && typeof best.offer === 'object'
          ? /** @type {Record<string, unknown>} */ (best.offer)
          : null,
        gpuLine,
      ) || null;
    const gate = await runVastProvisionGate(this, {
      instanceId,
      internalPort,
      gpuLine: gpuLine != null ? String(gpuLine) : null,
    });
    const ready = gate.ok
      ? { ok: true, live: gate.live ?? null, ops: gate.ops ?? null }
      : {
          ok: false,
          detail: `${gate.step}: ${gate.detail || 'failed'}`,
          live: gate.live ?? null,
          reasonCategory: classifyVastGateFailReason(`${gate.step} ${gate.detail || ''}`),
          ops: gate.ops ?? null,
        };
    const journalBase = {
      provider: 'vast',
      hostId: hostKeyForJournal
        ? String(hostKeyForJournal).replace(/^vast-host:/, '')
        : null,
      offerId,
      instanceId,
      gpuLine: gpuLine != null ? String(gpuLine) : null,
      region: best.region != null ? String(best.region) : null,
      rentOk: true,
      httpPub: null,
      gateSteps: gate.steps ?? null,
      ops: gate.ops ?? null,
      rentedAtMs,
      finishedAtMs: Date.now(),
      source: 'vast.rentOffer',
    };
    if (!ready.ok) {
      appendProvisionJournal(
        buildProvisionJournalEntry({
          ...journalBase,
          gateOk: false,
          gateStep: gate.step,
          gateDetail: gate.detail || ready.detail,
          failCategory: ready.reasonCategory || null,
        }),
      );
      const hostKey =
        hostKeyForJournal || resolveVastHostKey(ready.live, gpuLine) || null;
      if (hostKey) {
        rememberVastBadHost(hostKey.split('|')[0], {
          reason: ready.detail || 'post_rent_gate_failed',
          reasonCategory: ready.reasonCategory || null,
          offerId: String(offerId),
          instanceId,
          gpuLine: gpuLine != null ? String(gpuLine) : null,
        });
      }
      try {
        await this.destroyInstance(instanceId);
      } catch (destroyError) {
        console.warn(
          '[vast/createInstance] destroy bad host failed:',
          destroyError instanceof Error ? destroyError.message : destroyError,
        );
      }
      throw new GPUProviderError(formatVastBadHostError(instanceId, ready.detail), {
        retryable: true,
      });
    }

    appendProvisionJournal(
      buildProvisionJournalEntry({
        ...journalBase,
        gateOk: true,
        gateStep: gate.step,
        gateDetail: gate.detail,
      }),
    );

    return {
      ...rented,
      ...(ready.live && typeof ready.live === 'object' ? ready.live : {}),
      new_contract: instanceId,
      id: instanceId,
      gpuvietnam_selection: selectionMeta,
      gpuvietnam_ops: ready.ops ?? null,
    };
  }

  /**
   * Multi-step L2 gate: HTTP customer-path hard, SSH soft (ops_degraded).
   * @param {string} instanceId
   * @param {number} internalPort
   * @param {{ gpuLine?: string | null }} [options]
   * @returns {Promise<{ ok: true; live: Record<string, unknown> | null; ops?: Record<string, unknown> | null } | { ok: false; detail: string; live?: Record<string, unknown> | null; reasonCategory?: string; ops?: Record<string, unknown> | null }>}
   */
  async waitForInstanceProvisionGate(instanceId, internalPort, options = {}) {
    const gate = await runVastProvisionGate(this, {
      instanceId,
      internalPort,
      gpuLine: options.gpuLine ?? null,
    });

    if (gate.ok) {
      return { ok: true, live: gate.live ?? null, ops: gate.ops ?? null };
    }

    const detail = `${gate.step}: ${gate.detail || 'failed'}`;
    return {
      ok: false,
      detail,
      live: gate.live ?? null,
      reasonCategory: classifyVastGateFailReason(`${gate.step} ${gate.detail || ''}`),
      ops: gate.ops ?? null,
    };
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

  /**
   * List instances matching a rent label (orphan recovery after lost rent response).
   * @param {string} label
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async listInstancesByLabel(label) {
    const trimmed = String(label ?? '').trim();
    if (!trimmed) return [];

    const selectFilters = JSON.stringify({ label: { eq: trimmed } });
    const selectCols = JSON.stringify(['id', 'label', 'actual_status', 'cur_state', 'public_ipaddr']);
    const query = new URLSearchParams({
      select_filters: selectFilters,
      select_cols: selectCols,
      limit: '20',
    });

    try {
      const payload = await this.request('GET', `/instances/?${query.toString()}`, undefined, {
        baseUrl: VAST_V1_API_BASE,
      });
      const instances = payload?.instances;
      if (!Array.isArray(instances)) return [];
      return instances.filter((row) => row && typeof row === 'object');
    } catch (error) {
      console.warn('[vast/listInstancesByLabel] failed:', error instanceof Error ? error.message : error);
      return [];
    }
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
