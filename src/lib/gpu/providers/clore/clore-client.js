import { GPUConfigurationError, GPUProviderError } from '../../gpu-errors.js';
import {
  DEFAULT_GPU_IMAGE,
  DEFAULT_GPU_PORT,
  NO_AVAILABLE_WORKSTATION_MESSAGE,
  OFFER_SELECTION,
  isCloreGpuLineSupported,
  resolveGpuImage,
  resolvePackageDiskSize,
  resolvePackageSpec,
} from '../../gpu-config.js';
import {
  normalizeCloreOffer,
  selectRelaxedWorkstationOffers,
  selectWorkstationOffers,
} from '../../offer-selection.js';
import {
  applyHostReputationToOffers,
  mergeKnownGoodOffersIntoCandidates,
  rememberHostFailure,
  resolveCloreHostKey,
} from '../../host-reputation/index.js';
import { applyVastPercentilePriceBand } from '../vast/vast-percentile-band.js';
import {
  filterCloreOffersByBadHostExclusion,
  isCloreHostExcluded,
  rememberCloreBadHost,
} from './clore-bad-host-exclusion.js';
import { applyCloreRankedPriceGuard } from './clore-price-guard.js';
import { hostKeyIsExcluded } from '../../exclude-host-keys.js';
import {
  runCloreProvisionGate,
  classifyCloreGateFailReason,
} from './clore-provision-gate.js';
import {
  appendProvisionJournal,
  buildProvisionJournalEntry,
} from '../../provision-journal.js';
import {
  getCloreCurrenciesCached,
  seedCurrenciesFromWallets,
} from '../../../provider-capability-cache/index.js';
import { getCapabilityCacheEntry } from '../../../provider-capability-cache/capability-cache-store.js';
import {
  CAPABILITY_CACHE,
  CACHE_TYPE,
  capabilityCacheKey,
  ttlForCacheType,
} from '../../../provider-capability-cache/capability-cache-config.js';
import {
  applyRetryDecision,
  decideRetryPolicy,
  shouldRetryAnotherHost,
  shouldRetrySameHost,
} from '../../../provider-retry-policy/index.js';
import { walkRentCandidates } from '../../rent-candidate-walk.js';
import { profStart, profEnd } from '../../../prof.js';
import { logger } from '../../../logging/index.js';
import { providerDiag } from '../../../logging/provider-fields.js';

const CLORE_API_BASE = 'https://api.clore.ai/v1';
const providerLog = () => logger('provider');

/** Clore create_order docs: ~1 request / 5 seconds. */
export const CLORE_CREATE_ORDER_MIN_INTERVAL_MS = 5500;

/** Clore global API: ~1 request / second across ALL endpoints. */
export const CLORE_API_MIN_INTERVAL_MS = Number(process.env.CLORE_API_MIN_INTERVAL_MS ?? 1200);

/** Max relative gap between on_demand_usd and CLORE/BTC USD-equiv before dropping a host. */
export const CLORE_USD_PRICE_MAX_REL_DIFF = 0.30;

/**
 * Process-wide Clore gate. Must live on globalThis so Next.js instrumentation
 * and API route bundles share one limiter (separate module copies otherwise).
 * @returns {{ lastAt: number; chain: Promise<void>; provisionInFlight: boolean }}
 */
function cloreApiState() {
  const g = /** @type {any} */ (globalThis);
  if (!g.__gpuvietnamCloreApiState) {
    g.__gpuvietnamCloreApiState = {
      lastAt: 0,
      chain: Promise.resolve(),
      provisionInFlight: false,
    };
  }
  return g.__gpuvietnamCloreApiState;
}

/**
 * True while createInstance is in-flight — orphan reconciler should yield.
 * Live across Next module copies via globalThis.
 */
export function getCloreProvisionInFlight() {
  return Boolean(cloreApiState().provisionInFlight);
}

export function setCloreProvisionInFlight(value) {
  cloreApiState().provisionInFlight = Boolean(value);
}

/** @deprecated prefer getCloreProvisionInFlight — kept for older imports */
export let cloreProvisionInFlight = false;

/**
 * Serialize all Clore HTTP calls to respect the 1 req/s platform limit.
 * create_order still applies its own longer spacing on top.
 */
function gateCloreApi(minIntervalMs = CLORE_API_MIN_INTERVAL_MS) {
  const state = cloreApiState();
  const run = async () => {
    const wait = Math.max(0, minIntervalMs - (Date.now() - state.lastAt));
    if (wait > 0) await sleep(wait);
    state.lastAt = Date.now();
  };
  const next = state.chain.then(run, run);
  state.chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * @param {Record<string, unknown>} server
 */
function cloreGpuArrayOf(server) {
  if (Array.isArray(server.gpu_array)) return /** @type {string[]} */ (server.gpu_array);
  const specs = server.specs && typeof server.specs === 'object' ? server.specs : {};
  const raw = /** @type {Record<string, unknown>} */ (specs).gpu ?? '';
  return String(raw)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * @param {Record<string, unknown>} server
 */
function parseCloreGpuCountFromSpecs(server) {
  const specs = server.specs && typeof server.specs === 'object' ? server.specs : {};
  const raw = String(/** @type {Record<string, unknown>} */ (specs).gpu ?? '');
  const match = raw.match(/(\d+)\s*x/i);
  if (match) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} server
 * @param {string} gpuLine
 */
export function classifyCloreServerForLine(server, gpuLine) {
  const arr = cloreGpuArrayOf(server);
  const specs = server.specs && typeof server.specs === 'object' ? server.specs : {};
  const joined = (arr.join(' ') + ' ' + String(/** @type {Record<string, unknown>} */ (specs).gpu ?? '')).toLowerCase();
  if (/mixed/.test(joined)) return null;
  const fromArray = arr.length || 0;
  const fromSpecs = parseCloreGpuCountFromSpecs(server) || 0;
  const hostGpuCount = Math.max(fromArray, fromSpecs, 1);

  if (gpuLine === 'rtx3090') {
    if (!/3090/.test(joined)) return null;
    // Starter = 1x 3090 only (allow partial rental on multi-GPU hosts).
    if (hostGpuCount !== 1 && server.partial_gpu_rental !== true) return null;
    return { numGpus: 1, gpuType: 'RTX 3090', hostGpuCount };
  }
  if (gpuLine === 'rtx4090_1x') {
    if (!/4090/.test(joined)) return null;
    if (hostGpuCount !== 1 && server.partial_gpu_rental !== true) return null;
    return { numGpus: 1, gpuType: 'RTX 4090', hostGpuCount };
  }
  if (gpuLine === 'rtx5090_1x') {
    if (!/5090/.test(joined)) return null;
    if (hostGpuCount !== 1 && server.partial_gpu_rental !== true) return null;
    const vramGb = Number(/** @type {Record<string, unknown>} */ (specs).gpuram ?? server.gpuram);
    // Studio 5090: VRAM must be strictly above 30GB when host reports it.
    if (Number.isFinite(vramGb) && vramGb > 0 && !(vramGb > 30)) return null;
    return { numGpus: 1, gpuType: 'RTX 5090', hostGpuCount };
  }
  return null;
}

/**
 * True when the host actually accepts the pay currency.
 * Prefer `allowed_coins` (authoritative). Fall back to positive on_demand price
 * only when allowed_coins is missing from the marketplace payload.
 * @param {Record<string, unknown>} server
 * @param {string} currency
 */
export function cloreServerAcceptsCurrency(server, currency) {
  const allowed = server.allowed_coins;
  if (Array.isArray(allowed) && allowed.length > 0) {
    if (!allowed.map(String).includes(currency)) return false;
  }

  const price = server.price && typeof server.price === 'object' ? server.price : {};
  const onDemand = /** @type {Record<string, unknown>} */ (price).on_demand;
  if (!onDemand || typeof onDemand !== 'object') return false;
  const amount = Number(/** @type {Record<string, unknown>} */ (onDemand)[currency]);
  return Number.isFinite(amount) && amount > 0;
}

/**
 * Drop hosts whose USD quote is badly inconsistent with CLORE/BTC USD-equiv
 * (common precursor to create_order currency-not-allowed on "cheap" USD listings).
 * @param {Record<string, unknown>} server
 * @param {number} [maxRelDiff]
 */
export function isCloreUsdPriceConsistent(server, maxRelDiff = CLORE_USD_PRICE_MAX_REL_DIFF) {
  const price = server.price && typeof server.price === 'object' ? server.price : {};
  const usdBlock =
    price.usd && typeof price.usd === 'object'
      ? /** @type {Record<string, unknown>} */ (price.usd)
      : {};
  const onDemand =
    price.on_demand && typeof price.on_demand === 'object'
      ? /** @type {Record<string, unknown>} */ (price.on_demand)
      : {};

  const usd = Number(usdBlock.on_demand_usd ?? 0);
  const cloreEq = Number(usdBlock.on_demand_clore ?? 0);
  const btcEq = Number(usdBlock.on_demand_btc ?? 0);
  const chainUsd = Number(onDemand['USD-Blockchain'] ?? 0);

  const primary = usd > 0 ? usd : chainUsd;
  if (!(primary > 0)) return false;

  const refs = [cloreEq, btcEq].filter((v) => v > 0);
  if (refs.length === 0) {
    if (usd > 0 && chainUsd > 0) {
      return Math.abs(usd - chainUsd) / Math.max(usd, chainUsd) <= maxRelDiff;
    }
    return true;
  }

  const ref = cloreEq > 0 ? cloreEq : btcEq;
  return Math.abs(primary - ref) / Math.max(primary, ref) <= maxRelDiff;
}

/**
 * @param {Record<string, unknown>} server
 */
function resolveCloreHostPriceUsdPerDay(server) {
  const price = server.price && typeof server.price === 'object' ? server.price : {};
  const onDemand = /** @type {Record<string, unknown>} */ (price).on_demand;
  if (onDemand && typeof onDemand === 'object') {
    const usdBlockchain = Number(/** @type {Record<string, unknown>} */ (onDemand)['USD-Blockchain']);
    if (Number.isFinite(usdBlockchain) && usdBlockchain > 0) return usdBlockchain;
  }
  const usd = /** @type {Record<string, unknown>} */ (price).usd;
  if (usd && typeof usd === 'object') {
    const primary = Number(/** @type {Record<string, unknown>} */ (usd).on_demand_usd);
    if (Number.isFinite(primary) && primary > 0) return primary;
  }
  return 0;
}

/**
 * @param {Record<string, unknown>} server
 * @param {{ numGpus: number; hostGpuCount: number }} classified
 */
export function resolveClorePricePerHour(server, classified) {
  const dailyHost = resolveCloreHostPriceUsdPerDay(server);
  if (!(dailyHost > 0)) return 0;
  const hostGpuCount = Math.max(Number(classified.hostGpuCount) || 1, 1);
  const lineGpus = Math.max(Number(classified.numGpus) || 1, 1);
  return (dailyHost / 24 / hostGpuCount) * lineGpus;
}

/**
 * @param {import('../../offer-selection.js').RankedOffer} best
 * @param {string} currency
 */
export function resolveCloreRequiredPriceDaily(best, currency) {
  const raw = best.raw && typeof best.raw === 'object' ? best.raw : null;
  if (raw) {
    const price = raw.price && typeof raw.price === 'object' ? /** @type {Record<string, unknown>} */ (raw.price) : {};
    const onDemand =
      price.on_demand && typeof price.on_demand === 'object'
        ? /** @type {Record<string, unknown>} */ (price.on_demand)
        : {};
    const listed = Number(onDemand[currency]);
    if (Number.isFinite(listed) && listed > 0) return listed;
  }
  return best.pricePerHour > 0 ? best.pricePerHour * 24 : undefined;
}

/**
 * Clore create_order sometimes returns only `{ code: 0 }` without order_id.
 * @param {unknown} payload
 * @returns {string}
 */
export function extractCloreOrderId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const rec = /** @type {Record<string, unknown>} */ (payload);
  const nested =
    rec.order && typeof rec.order === 'object'
      ? /** @type {Record<string, unknown>} */ (rec.order)
      : null;
  const id = rec.order_id ?? rec.id ?? nested?.order_id ?? nested?.id ?? '';
  return id != null && String(id).trim() ? String(id).trim() : '';
}

/**
 * Marketplace server id on a Clore order (`si` / `renting_server` / `server_id`).
 * @param {unknown} payload
 * @returns {string}
 */
export function extractCloreServerId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const rec = /** @type {Record<string, unknown>} */ (payload);
  const sid = rec.renting_server ?? rec.si ?? rec.server_id ?? rec.offer_id ?? '';
  return sid != null && String(sid).trim() ? String(sid).trim() : '';
}

/**
 * Whether a my_orders row still represents a billable/live rental.
 * @param {unknown} order
 */
export function isCloreOrderActive(order) {
  if (!order || typeof order !== 'object') return false;
  const rec = /** @type {Record<string, unknown>} */ (order);
  const status = String(rec.status ?? '').toLowerCase();
  if (/cancel|expired|fail|error|deleted|closed/.test(status)) return false;
  if (rec.online === true || rec.online === 1 || rec.online === '1') return true;
  if (rec.http_pub || rec.pub_cluster || rec.tcp_ports) return true;
  // my_orders typically only lists live rentals; keep when id present and not cancelled
  return Boolean(extractCloreOrderId(rec));
}

/**
 * Only manage orders that look like GPUVietnam ComfyUI rentals.
 * @param {unknown} order
 * @param {string} [imageHint]
 */
export function isGpuVietnamCloreOrder(order, imageHint = DEFAULT_GPU_IMAGE) {
  if (!order || typeof order !== 'object') return false;
  const image = String(/** @type {Record<string, unknown>} */ (order).image ?? '');
  if (!image) return false;
  if (imageHint && image === imageHint) return true;
  return /gpuvietnam/i.test(image);
}

/** Propagation-tolerant waits for create_order → my_orders visibility (ms). */
export const CLORE_ORDER_ID_RECOVERY_WAITS_MS = [2000, 3500, 5000, 8000, 12000, 20000];

/** Backoff between cancel_order attempts when Clore returns 429 / code 5 (ms). */
export const CLORE_CANCEL_ORDER_RETRY_WAITS_MS = [2000, 4000, 8000, 12000];

/**
 * Per-offer rent failures that should continue the candidate loop (not abort Clore).
 * Decisions flow through the Retry Policy Engine.
 * @param {unknown} error
 * @param {{ retryCount?: number; hostId?: string|null; requestId?: string|null }} [options]
 */
export function isOfferRentError(error, options = {}) {
  const decision = decideRetryPolicy({
    provider: 'clore',
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
 * @param {unknown} payload
 * @param {string} currency
 */
export function readCloreWalletBalance(payload, currency) {
  if (!payload || typeof payload !== 'object') return null;
  const root = /** @type {Record<string, unknown>} */ (payload);
  const wallets = root.wallets ?? root.data ?? payload;

  if (Array.isArray(wallets)) {
    for (const row of wallets) {
      if (!row || typeof row !== 'object') continue;
      const rec = /** @type {Record<string, unknown>} */ (row);
      const name = String(rec.currency ?? rec.name ?? rec.ticker ?? '');
      if (name === currency) {
        const bal = Number(rec.balance ?? rec.amount ?? 0);
        return Number.isFinite(bal) ? bal : null;
      }
    }
    return null;
  }

  if (wallets && typeof wallets === 'object') {
    const entry = /** @type {Record<string, unknown>} */ (wallets)[currency];
    if (entry == null) return null;
    if (typeof entry === 'number') return Number.isFinite(entry) ? entry : null;
    if (typeof entry === 'object') {
      const bal = Number(
        /** @type {Record<string, unknown>} */ (entry).balance ??
          /** @type {Record<string, unknown>} */ (entry).amount ??
          0,
      );
      return Number.isFinite(bal) ? bal : null;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clore create_order rejects some env payloads with opaque code 1.
 * Keep only ASCII-safe key/values; drop decorative fields (emoji icons).
 * @param {Record<string, unknown> | null | undefined} env
 * @returns {Record<string, string>}
 */
export function sanitizeCloreContainerEnv(env) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!env || typeof env !== 'object') return out;
  for (const [rawKey, rawVal] of Object.entries(env)) {
    const key = String(rawKey || '').trim();
    if (!key || !/^[_A-Za-z][_A-Za-z0-9]*$/.test(key)) continue;
    if (/ICON|EMOJI/i.test(key)) continue;
    let val = String(rawVal ?? '')
      .replace(/[\u2010-\u2015\u2212]/g, '-') // dashes
      .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
      // Clore create_order returns opaque HTTP 500 / code 1 when env values
      // contain '&' (reproduced: "Commerce & Product" fails, "and" succeeds).
      .replace(/&/g, ' and ')
      .replace(/[<>|;`\\]/g, ' ')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!val) continue;
    if (val.length > 240) val = val.slice(0, 240);
    out[key] = val;
  }
  return out;
}

/**
 * Kill-switch for Clore autossh + onstart command (create_order only; Vast untouched).
 * Default ON — set CLORE_AUTOSSH_ENTRYPOINT=false to restore legacy image-CMD-only rent.
 */
export function isCloreAutosshEnabled() {
  const v = String(process.env.CLORE_AUTOSSH_ENTRYPOINT ?? 'true').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

/**
 * Clore-only create_order `command` (no Docker image change).
 * Starts Comfy on 0.0.0.0 immediately; setup/models/backup run in background
 * so http_pub can bind without waiting for full start.sh.
 * @param {number} [comfyPort]
 */
export function buildCloreOnstartCommand(comfyPort = DEFAULT_GPU_PORT) {
  const port = Number(comfyPort) || 8080;
  return [
    '#!/bin/bash',
    'set -uo pipefail',
    `export COMFYUI_PORT="${port}"`,
    'PORT="${COMFYUI_PORT}"',
    'LOG=/tmp/gpuvietnam-clore-onstart.log',
    'echo "[GPUVietnam] Clore onstart begin $(date -Is 2>/dev/null || date)" >>"$LOG"',
    'if [ -x /app/setup-workstation.sh ]; then',
    '  nohup /app/setup-workstation.sh >>/tmp/setup-workstation.log 2>&1 &',
    'fi',
    'if [ "${GPUVIETNAM_SKIP_MODEL_DOWNLOAD:-0}" != "1" ] && [ -x /app/download-models.sh ]; then',
    '  nohup /app/download-models.sh >>/tmp/download-models.log 2>&1 &',
    'fi',
    'if [ "${GPUVIETNAM_PERIODIC_BACKUP:-1}" = "1" ] && [ -x /app/periodic-backup.sh ]; then',
    '  nohup /app/periodic-backup.sh >>/tmp/periodic-backup.log 2>&1 &',
    'fi',
    'if [ ! -f /app/ComfyUI/main.py ]; then',
    '  echo "[GPUVietnam] missing /app/ComfyUI/main.py" >>"$LOG"',
    '  exit 1',
    'fi',
    'cd /app/ComfyUI',
    'echo "[GPUVietnam] starting ComfyUI on 0.0.0.0:${PORT}" >>"$LOG"',
    'nohup python main.py --listen 0.0.0.0 --port "${PORT}" --enable-cors-header "*" >>/tmp/comfy.log 2>&1 &',
    'echo "[GPUVietnam] comfy_pid=$!" >>"$LOG"',
    'exit 0',
  ].join('\n');
}

/**
 * @param {unknown} payload
 * @param {number} status
 * @param {string} statusText
 */
function formatCloreErrorMessage(payload, status, statusText) {
  let detail = statusText || 'request failed';
  let code = null;
  if (payload && typeof payload === 'object') {
    const rec = /** @type {Record<string, unknown>} */ (payload);
    if (rec.error != null) detail = String(rec.error);
    else if (rec.message != null) detail = String(rec.message);
    const n = Number(rec.code);
    if (Number.isFinite(n)) code = n;
  } else if (typeof payload === 'string' && payload.trim()) {
    detail = payload.trim().slice(0, 300);
  }
  const codePart = code != null ? ' (code ' + code + ')' : '';
  return {
    message: 'Clore.ai ' + status + codePart + ': ' + detail,
    code,
    detail,
  };
}

export class CloreClient {
  /**
   * @param {{ apiKey?: string; baseUrl?: string; currency?: string }} [options]
   */
  constructor(options = {}) {
    this.apiKey = (options.apiKey ?? process.env.CLORE_API_KEY ?? process.env.CLORE_AI_KEY ?? '').trim();
    this.baseUrl = options.baseUrl ?? CLORE_API_BASE;
    this.currency =
      options.currency ??
      process.env.CLORE_CURRENCY ??
      'USD-Blockchain';
    /** @type {number} */
    this._lastCreateOrderAt = 0;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  /**
   * @param {'GET'|'POST'} method
   * @param {string} path
   * @param {Record<string, unknown> | undefined} [body]
   */
  async request(method, path, body) {
    if (!this.apiKey) {
      throw new GPUConfigurationError('CLORE_API_KEY is not configured');
    }

    await gateCloreApi(CLORE_API_MIN_INTERVAL_MS);

    const url = this.baseUrl + (path.startsWith('/') ? path : '/' + path);
    const headers = {
      Accept: 'application/json',
      auth: this.apiKey,
    };

    /** @type {RequestInit} */
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    const __prof = profStart('Clore ' + method + ' ' + path);
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new GPUProviderError('Clore.ai network error: ' + (error instanceof Error ? error.message : String(error)), {
        cause: error,
        retryable: true,
      });
    } finally {
      profEnd(__prof);
      cloreApiState().lastAt = Date.now();
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
      const formatted = formatCloreErrorMessage(payload, response.status, response.statusText);
      const code = formatted.code;
      throw new GPUProviderError(formatted.message, {
        retryable:
          response.status >= 500 ||
          response.status === 429 ||
          code === 1 ||
          code === 5 ||
          code === 6,
      });
    }

    if (payload && typeof payload === 'object' && 'code' in payload) {
      const code = Number(/** @type {Record<string, unknown>} */ (payload).code);
      if (Number.isFinite(code) && code !== 0) {
        const errField = /** @type {Record<string, unknown>} */ (payload).error;
        throw new GPUProviderError(
          'Clore.ai code ' + code + ': ' + (errField != null ? String(errField) : 'request failed'),
          { retryable: code === 1 || code === 5 || code === 6 },
        );
      }
    }

    return payload;
  }

  /**
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async searchOffers() {
    const payload = await this.request('GET', '/marketplace');
    return Array.isArray(payload?.servers) ? payload.servers : [];
  }

  /**
   * Fail fast when the configured pay currency has no balance.
   * Seeds the Provider Capability Cache with supported currencies (balances are never cached).
   */
  async assertPayCurrencyBalance() {
    const currency = this.currency;
    try {
      const cacheKey = capabilityCacheKey('clore', CACHE_TYPE.CURRENCIES);
      const cached = getCapabilityCacheEntry(cacheKey);
      const now = Date.now();
      const ageMs = cached?.fetchedAt != null ? now - Number(cached.fetchedAt) : null;
      const ttlMs = ttlForCacheType(CACHE_TYPE.CURRENCIES);
      if (
        cached?.data &&
        ageMs != null &&
        ageMs < ttlMs + CAPABILITY_CACHE.staleGraceMs
      ) {
        const list = Array.isArray(/** @type {any} */ (cached.data).supportedCurrencies)
          ? /** @type {any} */ (cached.data).supportedCurrencies.map(String)
          : [];
        if (list.length > 0 && !list.includes(currency)) {
          throw new GPUProviderError(
            'Clore.ai currency-not-allowed: ' +
              currency +
              ' not in account currencies [' +
              list.join(', ') +
              ']',
            { retryable: false },
          );
        }
      }

      const payload = await this.request('GET', '/wallets');
      seedCurrenciesFromWallets('clore', payload);

      const balance = readCloreWalletBalance(payload, currency);
      if (balance == null) {
        console.warn('[clore] wallet preflight: could not read balance for ' + currency);
        return;
      }
      if (!(balance > 0)) {
        throw new GPUProviderError(
          'Clore.ai wallet empty for ' + currency + ' (balance=0). Top up USD-Blockchain before starting.',
          { retryable: false },
        );
      }
      console.info('[clore] wallet preflight ok', { currency, balancePositive: true });
    } catch (error) {
      if (
        error instanceof GPUProviderError &&
        /wallet empty|currency-not-allowed/i.test(error.message)
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/429|code 5|rate.?limit/i.test(message)) {
        console.warn('[clore] wallet preflight skipped due to rate limit:', message);
        return;
      }
      console.warn('[clore] wallet preflight skipped:', message);
    }
  }

  /**
   * Cached account currencies (SWR). Does not return balances.
   * @param {{ forceRefresh?: boolean; requestId?: string|null }} [options]
   */
  async getSupportedCurrencies(options = {}) {
    const result = await getCloreCurrenciesCached(this, options);
    return {
      currencies: Array.isArray(result.data?.supportedCurrencies)
        ? result.data.supportedCurrencies.map(String)
        : [],
      source: result.source,
      ageMs: result.ageMs,
      ttlMs: result.ttlMs,
    };
  }

  /**
   * @param {import('../../domain/gpu-instance').GPULine} gpuLine
   * @param {string | null | undefined} [plan]
   * @param {{ relaxedUptime?: boolean; minUptimePercent?: number; maxCandidates?: number }} [options]
   */
  async findRankedOffers(gpuLine, plan, options = {}) {
    const servers = await this.searchOffers();
    const currency = this.currency;
    const enforceUsdConsistency = currency === 'USD-Blockchain';

    let matchedLine = 0;
    let droppedNoCurrency = 0;
    let droppedInconsistentPrice = 0;
    /** @type {import('../../offer-selection.js').NormalizedOffer[]} */
    const normalized = [];

    for (const server of servers) {
      if (!server || typeof server !== 'object') continue;
      const record = /** @type {Record<string, unknown>} */ (server);
      if (record.rented === true) continue;
      const classified = classifyCloreServerForLine(record, gpuLine);
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

    const band = applyVastPercentilePriceBand(normalized, { plan, gpuLine });
    const {
      offers: afterExclusion,
      droppedExcludedHost,
      droppedBlockedRegion = 0,
    } = filterCloreOffersByBadHostExclusion(band.offers, gpuLine);

    const cloreOnly =
      String(process.env.GPU_CLORE_ONLY ?? '')
        .replace(/\r/g, '')
        .trim()
        .toLowerCase() === 'true';
    const maxCandidates =
      Number(options.maxCandidates) > 0
        ? Math.floor(Number(options.maxCandidates))
        : cloreOnly
          ? Math.max(OFFER_SELECTION.maxCandidates, 10)
          : OFFER_SELECTION.maxCandidates;

    // Clore-only: same floor as OFFER_SELECTION (98% — groups A+B+C).
    const minUptimePercent =
      Number(options.minUptimePercent) > 0
        ? Number(options.minUptimePercent)
        : cloreOnly
          ? OFFER_SELECTION.minUptimePercent
          : undefined;

    const ranked = options.relaxedUptime
      ? selectRelaxedWorkstationOffers(afterExclusion, {
          plan,
          gpuLine,
          maxCandidates,
          minUptimePercent: minUptimePercent ?? 80,
        })
      : selectWorkstationOffers(afterExclusion, {
          plan,
          gpuLine,
          maxCandidates,
          ...(minUptimePercent != null ? { minUptimePercent } : {}),
        });
    const resolveKey = (offer) =>
      resolveCloreHostKey(
        offer.raw && typeof offer.raw === 'object'
          ? /** @type {Record<string, unknown>} */ (offer.raw)
          : null,
        offer.offerId,
        gpuLine,
      );
    const { offers: withKnownGood, pinned: knownGoodPinned } =
      mergeKnownGoodOffersIntoCandidates(ranked, afterExclusion, resolveKey);
    const { offers: reputationRanked, droppedBlacklisted, usedLeastBadFallback } =
      applyHostReputationToOffers(withKnownGood, resolveKey);
    const priceGuard = applyCloreRankedPriceGuard(reputationRanked);
    if (priceGuard.dropped > 0 || priceGuard.hardEmpty) {
      console.info('[clore/findRankedOffers] price guard', {
        dropped: priceGuard.dropped,
        kept: priceGuard.offers.length,
        cheapestDaily: priceGuard.cheapestDaily,
        capDaily: priceGuard.capDaily,
        hardEmpty: priceGuard.hardEmpty,
      });
    }
    console.info('[clore/findRankedOffers] currency filter', {
      currency,
      gpuLine,
      plan: plan ?? null,
      relaxedUptime: Boolean(options.relaxedUptime),
      minUptimePercent: minUptimePercent ?? OFFER_SELECTION.minUptimePercent,
      totalServers: servers.length,
      matchedLine,
      droppedNoCurrency,
      droppedInconsistentPrice,
      afterCurrencyFilters: normalized.length,
      percentileMode: band.mode,
      percentileDropped: band.dropped,
      droppedBlockedRegion,
      droppedExcludedHost,
      afterPercentileExclusion: afterExclusion.length,
      ranked: ranked.length,
      knownGoodPinned,
      afterHostReputation: reputationRanked.length,
      droppedBlacklisted,
      usedLeastBadFallback,
      priceGuardDropped: priceGuard.dropped,
      afterPriceGuard: priceGuard.offers.length,
      priceGuardCapDaily: priceGuard.capDaily,
      priceGuardHardEmpty: priceGuard.hardEmpty,
    });
    return priceGuard.offers;
  }

  /**
   * @param {{
   *   gpuLine: import('../../domain/gpu-instance').GPULine;
   *   plan?: string;
   *   image?: string;
   *   label?: string;
   *   env?: Record<string, string>;
   *   diskSize?: number;
   *   port?: number;
   *   onProgress?: (step: string) => void | Promise<void>;
   *   excludeHostKeys?: string[];
   * }} params
   */
  async createInstance(params) {
    setCloreProvisionInFlight(true);
    cloreProvisionInFlight = true;
    try {
      return await this._createInstanceInner(params);
    } finally {
      setCloreProvisionInFlight(false);
      cloreProvisionInFlight = false;
    }
  }

  /**
   * @param {{
   *   gpuLine: import('../../domain/gpu-instance').GPULine;
   *   plan?: string;
   *   image?: string;
   *   label?: string;
   *   env?: Record<string, string>;
   *   diskSize?: number;
   *   port?: number;
   *   onProgress?: (step: string) => void | Promise<void>;
   *   excludeHostKeys?: string[];
   * }} params
   */
  async _createInstanceInner(params) {
    if (!isCloreGpuLineSupported(params.gpuLine)) {
      throw new GPUProviderError(
        `Clore does not support gpuLine ${params.gpuLine} (3090/4090 only)`,
        { retryable: true },
      );
    }
    const packageSpec = resolvePackageSpec(params.plan, params.gpuLine);
    const diskSize = params.diskSize ?? resolvePackageDiskSize(params.plan, params.gpuLine);
    const comfyPort = params.port ?? DEFAULT_GPU_PORT;
    const image = params.image ?? resolveGpuImage(params.gpuLine);
    const onProgress = typeof params.onProgress === 'function' ? params.onProgress : null;
    const tick = async (step) => {
      if (!onProgress) return;
      try {
        await onProgress(step);
      } catch {
        /* lease loss handled by caller */
      }
    };

    await tick('wallet_check');
    await this.assertPayCurrencyBalance();

    const sshPassword =
      String(process.env.CLORE_SSH_PASSWORD ?? '').trim() ||
      'Gv' +
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 8) +
        'A1';

    /** @type {Record<string, unknown>} */
    const rentBodyBase = {
      type: 'on-demand',
      currency: this.currency,
      image,
      ports: {
        '22': 'tcp',
        [String(comfyPort)]: 'http',
      },
      env: sanitizeCloreContainerEnv({
        ...(params.env ?? {}),
        COMFYUI_PORT: String(comfyPort),
        GPUVIETNAM_DISK_GB: String(diskSize),
        GPUVIETNAM_PACKAGE: packageSpec.planKey,
        ...(params.label ? { GPUVIETNAM_LABEL: String(params.label).slice(0, 64) } : {}),
      }),
      ssh_password: sshPassword,
    };
    // Clore-only: autossh wrapper + onstart that binds Comfy immediately (image unchanged).
    // Kill-switch: CLORE_AUTOSSH_ENTRYPOINT=false
    if (isCloreAutosshEnabled()) {
      rentBodyBase.autossh_entrypoint = true;
      rentBodyBase.command = buildCloreOnstartCommand(comfyPort);
      console.info('[clore/createInstance] using autossh_entrypoint + onstart Comfy bind', {
        comfyPort,
      });
    }

    /** @type {Error | null} */
    let lastError = null;
    let providerInternalFailures = 0;

    /**
     * @param {ReturnType<typeof selectWorkstationOffers>} candidates
     * @param {string} sourceLabel
     */
    const rentFromCandidates = async (candidates, sourceLabel) => {
      const walked = await walkRentCandidates({
        providerId: 'clore',
        sourceLabel,
        candidates,
        getOfferId: (best) =>
          best && typeof best === 'object' && 'offerId' in best
            ? /** @type {{ offerId?: string|number|null }} */ (best).offerId
            : null,
        shouldSkip: (best, offerId) => {
          const hostKey =
            resolveCloreHostKey(
              best?.raw && typeof best.raw === 'object'
                ? /** @type {Record<string, unknown>} */ (best.raw)
                : null,
              offerId,
              params.gpuLine,
            ) || null;
          if (hostKey && isCloreHostExcluded(hostKey)) {
            console.info(
              `[clore/createInstance] Skipping excluded bad host ${hostKey} (offer ${offerId})`,
            );
            return true;
          }
          if (hostKey && hostKeyIsExcluded(hostKey, params.excludeHostKeys)) {
            console.info(
              `[clore/createInstance] Skipping dual-run excluded host ${hostKey} (offer ${offerId})`,
            );
            return true;
          }
          return false;
        },
        onBeforeRent: async () => {
          await tick('create_order');
        },
        rentOne: async (best, offerId) =>
          this.rentOffer(
            /** @type {import('../../offer-selection.js').RankedOffer} */ (best),
            Number(offerId),
            rentBodyBase,
            tick,
            params.gpuLine,
          ),
        cancelOrphan: async (_best, offerId, error) => {
          const knownId =
            error &&
            typeof error === 'object' &&
            'providerInstanceId' in error &&
            error.providerInstanceId != null
              ? String(error.providerInstanceId).trim()
              : '';
          const orphan = knownId ? null : await this.findLatestOrderForServer(offerId);
          const orphanId = knownId || (orphan ? extractCloreOrderId(orphan) : '');
          if (!orphanId) return;
          console.warn(
            '[clore/createInstance] Cancel orphan order ' +
              orphanId +
              ' on host ' +
              offerId +
              ' before trying next candidate',
          );
          await this.destroyInstance(orphanId);
        },
        afterFailure: async ({ candidate: best, offerId, error, triedCount }) => {
          const hostKey = resolveCloreHostKey(
            best && typeof best === 'object' && 'raw' in best && best.raw && typeof best.raw === 'object'
              ? /** @type {Record<string, unknown>} */ (best.raw)
              : null,
            offerId,
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
            provider: 'clore',
            operation: 'rent',
            error,
            retryCount: 0,
            provisionRetryCount: Math.max(0, triedCount - 1),
            hostId: offerId,
          });
          await applyRetryDecision(decision, {
            provider: 'clore',
            operation: 'rent',
            hostId: offerId,
            retryCount: Math.max(0, triedCount - 1),
            onProgress: tick,
          });
          const hardAbort =
            decision.failImmediately &&
            (decision.category === 'AUTH' || decision.category === 'VALIDATION');
          if (hardAbort) return 'throw';

          lastError = error instanceof Error ? error : new Error(String(error));
          if (
            decision.category === 'PROVIDER_INTERNAL' ||
            /code.?1|internal server error/i.test(
              error instanceof Error ? error.message : String(error),
            )
          ) {
            providerInternalFailures += 1;
            if (providerInternalFailures >= 2 && sourceLabel === 'initial') {
              console.info(
                '[clore/createInstance] Multiple PROVIDER_INTERNAL failures — early marketplace refetch',
              );
              return 'break';
            }
          }
          return 'continue';
        },
      });
      if (walked.lastError) lastError = walked.lastError;
      return walked.result;
    };

    await tick('marketplace_fetch');
    // Clore-only: uptime ≥ 98% (same as shared OFFER_SELECTION), more try-list depth.
    const cloreOnly =
      String(process.env.GPU_CLORE_ONLY ?? '')
        .replace(/\r/g, '')
        .trim()
        .toLowerCase() === 'true';
    const cloreOnlyOpts = cloreOnly
      ? { minUptimePercent: OFFER_SELECTION.minUptimePercent, maxCandidates: 12 }
      : {};
    let candidates = await this.findRankedOffers(params.gpuLine, params.plan, cloreOnlyOpts);
    await tick('offer_selection');
    let rented = await rentFromCandidates(candidates, 'initial');

    if (!rented) {
      console.info('[clore/createInstance] All top offers unavailable, refetching marketplace...');
      await tick('marketplace_refetch');
      const elapsed = Date.now() - this._lastCreateOrderAt;
      if (this._lastCreateOrderAt > 0 && elapsed < CLORE_CREATE_ORDER_MIN_INTERVAL_MS) {
        await sleep(CLORE_CREATE_ORDER_MIN_INTERVAL_MS - elapsed);
      }
      candidates = await this.findRankedOffers(params.gpuLine, params.plan, cloreOnlyOpts);
      await tick('offer_selection');
      rented = await rentFromCandidates(candidates, 'refetch');
    }

    if (!rented) {
      throw new GPUProviderError(lastError?.message ?? NO_AVAILABLE_WORKSTATION_MESSAGE, {
        retryable: true,
        cause: lastError ?? undefined,
      });
    }

    return rented;
  }

  /**
   * @param {import('../../offer-selection.js').RankedOffer} best
   * @param {number} serverId
   * @param {Record<string, unknown>} rentBodyBase
   * @param {(step: string) => void | Promise<void>} [tick]
   * @param {string | null | undefined} [gpuLine]
   */
  async rentOffer(best, serverId, rentBodyBase, tick, gpuLine) {
    /** @type {Error | null} */
    let lastError = null;
    let retryCount = 0;

    for (;;) {
      try {
        return await this.rentOfferOnce(best, serverId, rentBodyBase, tick, gpuLine);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const decision = decideRetryPolicy({
          provider: 'clore',
          operation: 'create_order',
          error: lastError,
          retryCount,
          hostId: String(serverId),
        });
        await applyRetryDecision(decision, {
          provider: 'clore',
          operation: 'create_order',
          hostId: String(serverId),
          retryCount,
          onProgress: tick,
        });
        if (!shouldRetrySameHost(decision)) {
          throw lastError;
        }
        console.warn(
          '[clore/createInstance] create_order retry ' +
            (retryCount + 1) +
            ' in ' +
            decision.waitDurationMs +
            'ms (' +
            decision.category +
            ')',
          lastError.message,
        );
        retryCount += 1;
        if (tick) await tick('create_order_retry');
      }
    }
  }

  /**
   * @param {import('../../offer-selection.js').RankedOffer} best
   * @param {number} serverId
   * @param {Record<string, unknown>} rentBodyBase
   * @param {(step: string) => void | Promise<void>} [tick]
   * @param {string | null | undefined} [gpuLine]
   */
  async rentOfferOnce(best, serverId, rentBodyBase, tick, gpuLine) {
    const elapsed = Date.now() - this._lastCreateOrderAt;
    if (this._lastCreateOrderAt > 0 && elapsed < CLORE_CREATE_ORDER_MIN_INTERVAL_MS) {
      const waitMs = CLORE_CREATE_ORDER_MIN_INTERVAL_MS - elapsed;
      console.info('[clore/createInstance] create_order rate-limit wait ' + waitMs + 'ms');
      if (tick) await tick('rate_limit_wait');
      await sleep(waitMs);
    }

    const requiredPrice = resolveCloreRequiredPriceDaily(best, this.currency);
    // Prefer omit required_price: Clore often returns opaque code 1 when the
    // quoted required_price disagrees with their internal bookkeeping, while
    // the same host accepts a minimal body (marketplace on_demand price applies).
    // Keep required_price only when explicitly forced via env.
    const forceRequiredPrice =
      String(process.env.CLORE_FORCE_REQUIRED_PRICE || '').trim().toLowerCase() === 'true';
    const body = {
      ...rentBodyBase,
      renting_server: serverId,
      ...(forceRequiredPrice && requiredPrice != null ? { required_price: requiredPrice } : {}),
    };
    this._lastCreateOrderAt = Date.now();
    let rented;
    try {
      rented = await this.request('POST', '/create_order', body);
    } catch (createErr) {
      // Opaque code-1 / HTTP 500 sometimes still creates the order.
      const msg = createErr instanceof Error ? createErr.message : String(createErr);
      if (/code.?1|internal server error/i.test(msg)) {
        if (tick) await tick('order_id_recovery');
        const recoveredId = await this.recoverOrderIdAfterCreate(serverId, null, {
          label:
            rentBodyBase.env && typeof rentBodyBase.env === 'object'
              ? /** @type {Record<string, unknown>} */ (rentBodyBase.env).GPUVIETNAM_LABEL
              : undefined,
          onProgress: tick ?? undefined,
        });
        if (recoveredId) {
          console.warn(
            '[clore/createInstance] create_order errored but order recovered: ' + recoveredId,
          );
          rented = { code: 0, order_id: recoveredId, id: recoveredId };
        } else {
          throw createErr;
        }
      } else {
        throw createErr;
      }
    }
    let orderId = extractCloreOrderId(rented);

    // Clore frequently returns `{ code: 0 }` without order_id even when the order exists.
    if (!orderId) {
      if (tick) await tick('order_id_recovery');
      orderId = await this.recoverOrderIdAfterCreate(serverId, rented, {
        label: rentBodyBase.env && typeof rentBodyBase.env === 'object'
          ? /** @type {Record<string, unknown>} */ (rentBodyBase.env).GPUVIETNAM_LABEL
          : undefined,
        onProgress: tick ?? undefined,
      });
    }

    if (!orderId) {
      throw new GPUProviderError(
        'Clore.ai create_order succeeded without order id (server ' + serverId + ')',
        { retryable: true },
      );
    }

    const hostKey = resolveCloreHostKey(
      best.raw && typeof best.raw === 'object'
        ? /** @type {Record<string, unknown>} */ (best.raw)
        : null,
      serverId,
      gpuLine,
    );
    const selectionMeta = {
      offer_id: best.offerId,
      host_key: hostKey,
      gpu_line: gpuLine != null ? String(gpuLine) : null,
      reason: best.reason,
      region: best.region,
      price_per_hour: best.pricePerHour,
      uptime_percent: best.uptimePercent,
      ping_ms: best.pingMs,
      uptime_group: best.uptimeGroup,
      currency: this.currency,
      required_price: requiredPrice,
    };

    providerLog().info(
      providerDiag({
        operation: 'clore.createInstance',
        phase: 'SUCCESS',
        provider: 'clore',
        offerId: serverId,
        instanceId: orderId,
        machineId: orderId,
        gpuType: best.gpuType != null ? String(best.gpuType) : null,
        gpuCount: Number(best.gpuCount ?? 1) || 1,
        region: best.region != null ? String(best.region) : null,
        retryCount: Number(best.fallbackLevel ?? 0) || 0,
        image: rentBodyBase.image,
        currency: this.currency,
        requiredPrice,
      }),
      'clore createInstance created order',
    );

    const rentedRec = rented && typeof rented === 'object' ? /** @type {Record<string, unknown>} */ (rented) : {};
    const sshPasswordFromBody =
      rentBodyBase.ssh_password != null ? String(rentBodyBase.ssh_password) : '';
    let orderPayload = { ...rentedRec };
    const alreadyRich = Boolean(rentedRec.http_pub || rentedRec.pub_cluster || rentedRec.tcp_ports);
    if (!alreadyRich) {
      try {
        await sleep(800);
        const live = await this.getOrder(orderId);
        orderPayload = { ...rentedRec, ...live };
      } catch (error) {
        providerLog().warn(
          {
            operation: 'clore.createInstance',
            phase: 'FAILURE',
            machineId: orderId,
            err: {
              message: error instanceof Error ? error.message : String(error),
            },
          },
          'Could not fetch order after create',
        );
      }
    }

    const internalPort =
      Number(
        rentBodyBase.env && typeof rentBodyBase.env === 'object'
          ? /** @type {Record<string, unknown>} */ (rentBodyBase.env).COMFYUI_PORT
          : DEFAULT_GPU_PORT,
      ) || DEFAULT_GPU_PORT;

    if (tick) await tick('provision_gate');
    const rentedAtMs = Date.now();
    const gate = await runCloreProvisionGate(this, {
      orderId,
      sshPassword: sshPasswordFromBody,
      internalPort,
      gpuLine: gpuLine != null ? String(gpuLine) : null,
    });
    const httpPubPresent = Boolean(
      (gate.order && typeof gate.order === 'object' && gate.order.http_pub) ||
        orderPayload.http_pub,
    );
    const journalBase = {
      provider: 'clore',
      hostId: hostKey ? String(hostKey).replace(/^clore-host:/, '') : String(serverId),
      offerId: serverId,
      instanceId: orderId,
      gpuLine: gpuLine != null ? String(gpuLine) : null,
      region: best.region != null ? String(best.region) : null,
      rentOk: true,
      httpPub: httpPubPresent,
      gateSteps: gate.steps ?? null,
      ops: gate.ops ?? null,
      rentedAtMs,
      finishedAtMs: Date.now(),
      source: 'clore.rentOfferOnce',
    };
    if (!gate.ok) {
      const failCategory = classifyCloreGateFailReason(`${gate.step} ${gate.detail || ''}`);
      appendProvisionJournal(
        buildProvisionJournalEntry({
          ...journalBase,
          gateOk: false,
          gateStep: gate.step,
          gateDetail: gate.detail,
          failCategory,
        }),
      );
      const failHostKey =
        hostKey ||
        resolveCloreHostKey(gate.order, serverId, gpuLine) ||
        null;
      if (failHostKey) {
        rememberCloreBadHost(failHostKey.split('|')[0], {
          reason: `${gate.step}: ${gate.detail || 'failed'}`,
          reasonCategory: failCategory,
          offerId: String(serverId),
          instanceId: orderId,
          gpuLine: gpuLine != null ? String(gpuLine) : null,
        });
      }
      let destroyFailed = false;
      try {
        await this.destroyInstance(orderId);
      } catch (destroyError) {
        destroyFailed = true;
        console.warn(
          '[clore/createInstance] destroy after gate fail:',
          destroyError instanceof Error ? destroyError.message : destroyError,
        );
      }
      // Always tag the order id so the walk can cancel by id (not only server lookup).
      // If destroy already failed, walk must abort when cancel also fails — never rent #2.
      const gateError = new GPUProviderError(
        destroyFailed
          ? `Clore bad host (gate ${gate.step}) for order ${orderId}: ${gate.detail || 'failed'} — orphan still live`
          : `Clore bad host (gate ${gate.step}) for order ${orderId}: ${gate.detail || 'failed'} — trying next offer`,
        { retryable: true },
      );
      /** @type {any} */ (gateError).providerInstanceId = orderId;
      throw gateError;
    }

    appendProvisionJournal(
      buildProvisionJournalEntry({
        ...journalBase,
        gateOk: true,
        gateStep: gate.step,
        gateDetail: gate.detail,
      }),
    );

    if (gate.order && typeof gate.order === 'object') {
      orderPayload = { ...orderPayload, ...gate.order };
    }

    return {
      ...orderPayload,
      order_id: orderId,
      id: orderId,
      region: best.region,
      gpuvietnam_selection: selectionMeta,
      gpuvietnam_ssh_password: sshPasswordFromBody,
      gpuvietnam_ops: gate.ops ?? null,
    };
  }

  /**
   * All orders from GET /my_orders (provider source of truth).
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async listMyOrders() {
    /** @type {Error | null} */
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const payload = await this.request('GET', '/my_orders');
        return Array.isArray(payload?.orders) ? payload.orders : [];
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const message = lastError.message;
        if (!/429|code.?5|rate.?limit/i.test(message)) throw lastError;
        const waitMs = 1500 * (attempt + 1);
        console.warn('[clore] my_orders rate-limited, retry in ' + waitMs + 'ms');
        await sleep(waitMs);
      }
    }
    throw lastError ?? new GPUProviderError('Clore.ai my_orders failed', { retryable: true });
  }

  /**
   * Newest active order for a marketplace server id (create_order response recovery).
   * @param {number|string} serverId
   */
  async findLatestOrderForServer(serverId) {
    const orders = await this.listMyOrders();
    const want = String(serverId);
    const matches = orders.filter((order) => {
      const sid = extractCloreServerId(order);
      return sid === want && isCloreOrderActive(order);
    });
    if (!matches.length) return null;
    matches.sort((a, b) => {
      const idA = Number(a?.order_id ?? a?.id ?? 0);
      const idB = Number(b?.order_id ?? b?.id ?? 0);
      if (idA !== idB) return idB - idA;
      return Number(b?.ct ?? b?.created ?? 0) - Number(a?.ct ?? a?.created ?? 0);
    });
    return matches[0];
  }

  /**
   * Retry my_orders lookup after create_order omits order_id.
   * @param {number|string} serverId
   * @param {unknown} rentedPayload
   * @param {{ label?: unknown; waitsMs?: number[]; onProgress?: (step: string) => void | Promise<void> }} [options]
   * @returns {Promise<string>}
   */
  async recoverOrderIdAfterCreate(serverId, rentedPayload, options = {}) {
    const waits = options.waitsMs ?? CLORE_ORDER_ID_RECOVERY_WAITS_MS;
    const started = Date.now();
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    providerLog().warn(
      {
        operation: 'clore.orderIdRecovery',
        event: 'ORDER_ID_RECOVERY_STARTED',
        provider: 'clore',
        serverId: String(serverId),
        orderId: null,
        machineId: null,
        gpuSessionId: null,
        elapsedTime: 0,
        recoveryAction: 'my_orders_lookup',
        label: options.label != null ? String(options.label) : null,
        payloadKeys:
          rentedPayload && typeof rentedPayload === 'object'
            ? Object.keys(/** @type {object} */ (rentedPayload))
            : [],
      },
      'create_order returned no order_id; recovering via my_orders',
    );

    for (let attempt = 0; attempt < waits.length; attempt += 1) {
      const waitMs = waits[attempt];
      try {
        if (onProgress) await onProgress('order_id_recovery_wait');
        await sleep(waitMs);
        if (onProgress) await onProgress('order_id_recovery');
        const recovered = await this.findLatestOrderForServer(serverId);
        const orderId = recovered ? extractCloreOrderId(recovered) : '';
        providerLog().info(
          {
            operation: 'clore.orderIdRecovery',
            event: 'ORDER_ID_RECOVERY_ATTEMPT',
            provider: 'clore',
            serverId: String(serverId),
            orderId: orderId || null,
            machineId: null,
            gpuSessionId: null,
            elapsedTime: Date.now() - started,
            recoveryAction: 'my_orders_lookup',
            attempt: attempt + 1,
            waitMs,
            found: Boolean(orderId),
          },
          'my_orders order_id recovery attempt',
        );
        if (orderId) {
          if (rentedPayload && typeof rentedPayload === 'object') {
            Object.assign(rentedPayload, recovered);
          }
          providerLog().info(
            {
              operation: 'clore.orderIdRecovery',
              event: 'ORDER_ID_RECOVERY_SUCCESS',
              provider: 'clore',
              serverId: String(serverId),
              orderId,
              machineId: orderId,
              gpuSessionId: null,
              elapsedTime: Date.now() - started,
              recoveryAction: 'my_orders_lookup',
              attempt: attempt + 1,
            },
            'Recovered Clore order_id via my_orders',
          );
          return orderId;
        }
      } catch (error) {
        providerLog().warn(
          {
            operation: 'clore.orderIdRecovery',
            event: 'ORDER_ID_RECOVERY_ATTEMPT',
            provider: 'clore',
            serverId: String(serverId),
            orderId: null,
            elapsedTime: Date.now() - started,
            recoveryAction: 'my_orders_lookup',
            attempt: attempt + 1,
            waitMs,
            err: {
              message: error instanceof Error ? error.message : String(error),
            },
          },
          'my_orders recovery attempt failed',
        );
      }
    }

    providerLog().error(
      {
        operation: 'clore.orderIdRecovery',
        event: 'ORDER_ID_RECOVERY_FAILED',
        provider: 'clore',
        serverId: String(serverId),
        orderId: null,
        machineId: null,
        gpuSessionId: null,
        elapsedTime: Date.now() - started,
        recoveryAction: 'my_orders_lookup',
      },
      'Failed to recover Clore order_id via my_orders',
    );
    return '';
  }

  /**
   * @param {string} orderId
   * @param {{ retries?: number; waitsMs?: number[] }} [options]
   */
  async getOrder(orderId, options = {}) {
    // my_orders can lag create_order by a few seconds — retry before failing.
    const waitsMs =
      Array.isArray(options.waitsMs) && options.waitsMs.length
        ? options.waitsMs
        : [400, 900, 1600, 2500];
    const retries = Number.isFinite(options.retries) ? Number(options.retries) : waitsMs.length;
    /** @type {Error | null} */
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const orders = await this.listMyOrders();
        const found = orders.find(
          (order) => String(order?.order_id ?? order?.id) === String(orderId),
        );
        if (found) return found;
        lastError = new GPUProviderError('Clore order not found: ' + orderId, { retryable: true });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const message = lastError.message;
        if (!/429|code.?5|rate.?limit|order not found/i.test(message) && attempt >= retries) {
          throw lastError;
        }
      }

      if (attempt >= retries) break;
      const waitMs = waitsMs[Math.min(attempt, waitsMs.length - 1)] ?? 1000;
      await sleep(waitMs);
    }

    throw (
      lastError ?? new GPUProviderError('Clore order not found: ' + orderId, { retryable: true })
    );
  }

  /**
   * True when my_orders no longer lists this order as an active rental.
   * @param {string|number} orderId
   */
  async isOrderGone(orderId) {
    const want = String(orderId);
    try {
      const orders = await this.listMyOrders();
      return !orders.some((order) => {
        const id = extractCloreOrderId(order);
        return id != null && String(id) === want && isCloreOrderActive(order);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Rate-limit on the verify read is not proof the order is gone.
      if (/429|code.?5|rate.?limit/i.test(message)) return false;
      // my_orders hard-fail / empty account → treat as gone so stop can converge.
      return true;
    }
  }

  /**
   * Cancel a Clore order with rate-limit retries. Idempotent: if the order is
   * already absent from my_orders, succeed even when cancel_order errors.
   * @param {string} orderId
   * @param {{ waitsMs?: number[] }} [options]
   */
  async destroyInstance(orderId, options = {}) {
    const id = Number(orderId) || orderId;
    const waitsMs =
      Array.isArray(options.waitsMs) && options.waitsMs.length
        ? options.waitsMs
        : CLORE_CANCEL_ORDER_RETRY_WAITS_MS;
    /** @type {Error | null} */
    let lastError = null;

    for (let attempt = 0; attempt <= waitsMs.length; attempt += 1) {
      try {
        await this.request('POST', '/cancel_order', { id });
        // Confirm absence — cancel_order can return OK while the order briefly lingers.
        if (await this.isOrderGone(orderId)) return { cancelled: true, orderId: String(orderId) };
        lastError = new GPUProviderError(
          `Clore cancel_order returned but order ${orderId} still active`,
          { retryable: true },
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const message = lastError.message;
        // Already gone / unknown id — succeed when my_orders agrees.
        if (/not found|unknown order|already|no such|code.?4\b/i.test(message)) {
          if (await this.isOrderGone(orderId)) {
            return { cancelled: true, alreadyGone: true, orderId: String(orderId) };
          }
        }
        if (!/429|code.?5|rate.?limit/i.test(message)) {
          // Non-rate-limit error: still succeed if provider no longer lists the order
          // (cancel may have applied despite a flaky response).
          if (await this.isOrderGone(orderId)) {
            return { cancelled: true, recovered: true, orderId: String(orderId) };
          }
          throw lastError;
        }
      }

      if (attempt >= waitsMs.length) break;
      const waitMs = waitsMs[attempt];
      console.warn(
        `[clore] cancel_order rate-limited/retry for order ${orderId}, wait ${waitMs}ms (attempt ${attempt + 1}/${waitsMs.length})`,
      );
      await sleep(waitMs);
    }

    if (await this.isOrderGone(orderId)) {
      return { cancelled: true, recovered: true, orderId: String(orderId) };
    }
    throw (
      lastError ??
      new GPUProviderError(`Clore.ai cancel_order failed for ${orderId}`, { retryable: true })
    );
  }
}

export { NO_AVAILABLE_WORKSTATION_MESSAGE as NO_GPU_MESSAGE };
