/**
 * Cron endpoint: Host Intelligence System refresh (manual / Bearer).
 *
 * Primary scheduler is VPS systemd `gpuvietnam-host-intel.timer` →
 * `scripts/host-intelligence-cron.mjs`. This API mirrors that logic for
 * ad-hoc runs (not in vercel.json).
 *
 * Providers: Vast and/or Clore (admin config). Books stay separate
 * (`vast-host:*` vs `clore-host:*`).
 */

import { HOST_REPUTATION, readHostIntelligenceConfigAsync } from '@/lib/gpu/host-reputation/host-reputation-config';
import {
  resolveVastHostKey,
  rememberHostSuccess,
  rememberHostFailure,
  getHostIntelligenceSummary,
  listHostReputationRecords,
  isKnownGoodHost,
  loadHostReputationStoreAsync,
  persistHostReputationStoreAsync,
} from '@/lib/gpu/host-reputation/index.js';
import { classifyHostFailure } from '@/lib/gpu/host-reputation/host-reputation-classify.js';
import {
  allocateSlotsByDeficit,
  selectTargetsFair,
} from '@/lib/gpu/host-reputation/host-intelligence-targets.js';
import { matchesHostIntelligenceProvider } from '@/lib/gpu/host-reputation/host-intelligence-inventory.js';
import { runCloreHostIntelligenceCycle } from '@/lib/gpu/host-reputation/host-intelligence-clore-run.js';
import { VastClient } from '@/lib/gpu/providers/vast/vast-client.js';
import { runTestProvisionGate } from '@/lib/gpu/providers/test-gate.js';
import { resolveVastEndpoint } from '@/lib/gpu/providers/vast/vast-endpoint-resolver.js';
import { normalizeVastOffer, selectWorkstationOffers } from '@/lib/gpu/offer-selection.js';
import {
  filterVastOffersBySanity,
  isVastDiskOnlyBilling,
  unwrapVastInstanceRecord,
} from '@/lib/gpu/providers/vast/vast-offer-sanity.js';

const LINE_TO_PLAN = {
  rtx3090: 'starter',
  rtx4090_1x: 'pro',
  rtx5090_1x: 'studio',
};

const TEST_IMAGE = process.env.GPU_TEST_IMAGE || 'dieuhaukieuhanh/gpu-test:v1';
const TEST_GPU_PORT = Number(process.env.GPU_TEST_PORT || 8080);
const GPU_LINES = ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'];
const MAX_TEST_PER_CYCLE = HOST_REPUTATION.maxTestPerCycle || 2;
const MAX_TEST_BELOW_TARGET = HOST_REPUTATION.maxTestWhenBelowTarget || 4;

const SKIP_PROBABILITY = Number(process.env.HOST_INTEL_SKIP_PROBABILITY || 0.10);
const MAX_START_JITTER_MS = Number(process.env.HOST_INTEL_START_JITTER_MS || 360_000);
const MAX_INTER_TEST_JITTER_MS = Number(process.env.HOST_INTEL_INTER_TEST_JITTER_MS || 30_000);

/**
 * @param {number} max
 * @returns {number}
 */
function randInt(max) {
  if (max <= 0) return 0;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

/**
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthorized(req) {
  if (req.headers['x-vercel-cron']) return true;
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  return false;
}

/**
 * @param {VastClient} client
 * @param {string} gpuLine
 */
async function searchLineOffers(client, gpuLine) {
  try {
    const plan = LINE_TO_PLAN[gpuLine] || 'starter';
    const rawOffers = await client.searchOffers(gpuLine);
    if (!rawOffers.length) return { rentCandidates: [], marketHostKeys: [] };

    const normalized = [];
    for (const raw of rawOffers) {
      const offer = normalizeVastOffer(/** @type {Record<string, unknown>} */ (raw));
      if (offer) normalized.push(offer);
    }
    if (!normalized.length) return { rentCandidates: [], marketHostKeys: [] };

    const { offers: saneOffers } = filterVastOffersBySanity(normalized, gpuLine, { plan });
    if (!saneOffers.length) return { rentCandidates: [], marketHostKeys: [] };

    /** @type {string[]} */
    const marketHostKeys = [];
    for (const offer of saneOffers) {
      const raw = offer.raw && typeof offer.raw === 'object'
        ? /** @type {Record<string, unknown>} */ (offer.raw)
        : null;
      if (!raw) continue;
      const hostKey = resolveVastHostKey(raw, gpuLine);
      if (hostKey) marketHostKeys.push(hostKey);
    }

    const selected = selectWorkstationOffers(saneOffers, { plan, gpuLine });
    const rentCandidates = selected
      .map((offer) => {
        const raw = offer.raw && typeof offer.raw === 'object'
          ? /** @type {Record<string, unknown>} */ (offer.raw)
          : null;
        if (!raw) return null;
        const hostKey = resolveVastHostKey(raw, gpuLine);
        const offerId = raw.id ?? raw.offer_id ?? raw.bundle_id ?? offer.offerId;
        if (!hostKey || offerId == null) return null;
        return { hostKey, offerId: /** @type {number | string} */ (offerId), gpuLine };
      })
      .filter(/** @returns {c is { hostKey: string; offerId: number|string; gpuLine: string }} */ (c) => c != null);

    return { rentCandidates, marketHostKeys };
  } catch (err) {
    console.warn(`[host-intel] Vast search failed for ${gpuLine}:`, err instanceof Error ? err.message : String(err));
    return { rentCandidates: [], marketHostKeys: [] };
  }
}

/**
 * @param {VastClient} vastClient
 * @param {Record<string, number>} targetPerLine
 * @returns {Promise<{
 *   results: Array<{ reason: string; hostKey: string; gpuLine: string; ok: boolean; detail: string; elapsedMs: number }>;
 *   message?: string;
 *   candidates?: number;
 *   targets?: number;
 *   slotAlloc?: Record<string, number>;
 *   availablePerLine?: Record<string, number>;
 * }>}
 */
async function runVastHostIntelligenceCycle(vastClient, targetPerLine) {
  /** @type {Array<{ reason: string; hostKey: string; gpuLine: string; ok: boolean; detail: string; elapsedMs: number }>} */
  const results = [];

  if (!vastClient.apiKey) {
    return { results, message: 'Vast not configured (missing VAST_AI_KEY)' };
  }

  const shuffledLines = shuffle([...GPU_LINES]);
  /** @type {Array<{ hostKey: string; offerId: number|string; gpuLine: string }>} */
  const allCandidates = [];
  /** @type {Set<string>} */
  const marketKeys = new Set();
  for (const gpuLine of shuffledLines) {
    const { rentCandidates, marketHostKeys } = await searchLineOffers(vastClient, gpuLine);
    allCandidates.push(...rentCandidates);
    for (const key of marketHostKeys) marketKeys.add(key);
  }

  if (allCandidates.length === 0) {
    return { results, message: 'No Vast marketplace offers found', candidates: 0 };
  }

  /** @type {Record<string, number>} */
  const availablePerLine = {};
  for (const r of listHostReputationRecords()) {
    if (!matchesHostIntelligenceProvider(r, 'vast')) continue;
    if (isKnownGoodHost(r) && marketKeys.has(r.hostKey)) {
      const line = r.gpuLine || 'unknown';
      availablePerLine[line] = (availablePerLine[line] || 0) + 1;
    }
  }
  const belowTarget = GPU_LINES.filter(
    (line) => (availablePerLine[line] ?? 0) < (targetPerLine[line] ?? 4),
  );

  let testCount = 1 + randInt(MAX_TEST_PER_CYCLE);
  if (belowTarget.length > 0) {
    testCount = MAX_TEST_PER_CYCLE + randInt(MAX_TEST_BELOW_TARGET - MAX_TEST_PER_CYCLE + 1);
    testCount = Math.max(testCount, Math.min(belowTarget.length, MAX_TEST_BELOW_TARGET));
  }
  const slotAlloc = allocateSlotsByDeficit(belowTarget, targetPerLine, availablePerLine, testCount);
  console.info('[host-intel] Vast pool below target', {
    belowTarget,
    testCount,
    slotAlloc,
    availablePerLine,
  });

  const candidatesNeeded = allCandidates.filter((c) => belowTarget.includes(c.gpuLine));
  const targets = selectTargetsFair(candidatesNeeded, testCount, {
    belowTarget,
    targetPerLine,
    availablePerLine,
  });

  if (targets.length === 0) {
    return {
      results,
      message: belowTarget.length === 0
        ? 'All Vast GPU lines at or above target'
        : 'No Vast hosts need testing this cycle',
      candidates: allCandidates.length,
      targets: 0,
      slotAlloc,
      availablePerLine,
    };
  }

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const tStart = Date.now();
    let instanceId = null;

    try {
      const comfyPort = TEST_GPU_PORT;
      const rentBody = {
        label: 'gpuvietnam-host-intel',
        image: TEST_IMAGE,
        disk: 20,
        runtype: 'args',
        target_state: 'running',
        env: {
          [`-p ${comfyPort}:${comfyPort}`]: '1',
          HOST: '0.0.0.0',
          PORT: String(comfyPort),
          COMFYUI_PORT: String(comfyPort),
        },
      };

      const rented = await vastClient.request('PUT', `/asks/${target.offerId}/`, rentBody);
      instanceId = String(
        (rented && typeof rented === 'object'
          ? (/** @type {Record<string, unknown>} */ (rented).new_contract ??
             /** @type {Record<string, unknown>} */ (rented).id ??
             /** @type {Record<string, unknown>} */ (rented).instance_id)
          : null) ?? '',
      );

      if (!instanceId) {
        results.push({
          reason: target.reason,
          hostKey: target.hostKey,
          gpuLine: target.gpuLine,
          ok: false,
          detail: 'no instance id',
          elapsedMs: Date.now() - tStart,
        });
        continue;
      }

      const liveInstance = rented && typeof rented === 'object' ? rented : null;
      const gate = await runTestProvisionGate({
        waitForEndpoint: async () => {
          try {
            const raw = await vastClient.getInstance(instanceId);
            const live = unwrapVastInstanceRecord(
              raw && typeof raw === 'object'
                ? /** @type {Record<string, unknown>} */ (raw)
                : null,
            );
            if (isVastDiskOnlyBilling(live)) {
              throw new Error('disk_only_billing (GPU struck through / stopped)');
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/disk_only/i.test(msg)) throw err instanceof Error ? err : new Error(msg);
          }
          const resolved = await resolveVastEndpoint(vastClient, instanceId, comfyPort, liveInstance);
          return resolved?.status === 'resolved' ? resolved.endpoint?.url ?? null : null;
        },
        gpuLine: target.gpuLine,
        timeoutMs: HOST_REPUTATION.testGateTimeoutMs,
      });

      if (gate.ok) {
        rememberHostSuccess(target.hostKey, {
          provider: 'vast',
          gpuLine: target.gpuLine,
          gpuName: gate.gpuName,
          vramGb: gate.vramGb,
          driverVersion: gate.driverVersion,
          readyLatencyMs: gate.elapsedMs,
          bootSec: gate.bootSec,
        });
      } else {
        const category = classifyHostFailure(gate.detail);
        rememberHostFailure(target.hostKey, {
          provider: 'vast',
          error: new Error(gate.detail),
          phase: 'provision',
          category,
        });
      }

      try {
        await vastClient.destroyInstance(instanceId);
      } catch (destroyErr) {
        console.warn(
          `[host-intel] destroy ${instanceId} failed:`,
          destroyErr instanceof Error ? destroyErr.message : String(destroyErr),
        );
      }

      results.push({
        reason: target.reason,
        hostKey: target.hostKey,
        gpuLine: target.gpuLine,
        ok: gate.ok,
        detail: gate.detail,
        elapsedMs: Date.now() - tStart,
      });
    } catch (err) {
      if (instanceId) {
        try { await vastClient.destroyInstance(instanceId); } catch { /* ignore */ }
      }
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        reason: target.reason,
        hostKey: target.hostKey,
        gpuLine: target.gpuLine,
        ok: false,
        detail: msg,
        elapsedMs: Date.now() - tStart,
      });
    }

    if (i < targets.length - 1) {
      const interDelayMs = randInt(MAX_INTER_TEST_JITTER_MS);
      if (interDelayMs > 0) {
        console.info(`[host-intel] Jitter: inter-test delay ${Math.round(interDelayMs / 1000)}s`);
        await sleep(interDelayMs);
      }
    }
  }

  await persistHostReputationStoreAsync();
  return {
    results,
    candidates: allCandidates.length,
    targets: targets.length,
    slotAlloc,
    availablePerLine,
  };
}

/**
 * @param {import('next').NextApiRequest} req
 * @param {import('next').NextApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthorized(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const t0 = Date.now();
  await loadHostReputationStoreAsync();

  const runtimeConfig = await readHostIntelligenceConfigAsync();

  if (!runtimeConfig.enabled) {
    return res.status(200).json({
      ok: true,
      message: 'Host Intelligence is disabled (admin config)',
      results: [],
      summary: getHostIntelligenceSummary(),
      elapsedMs: Date.now() - t0,
    });
  }

  const enabledProviders = Object.entries(runtimeConfig.providers)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  if (enabledProviders.length === 0) {
    return res.status(200).json({
      ok: true,
      message: 'All providers disabled in admin config',
      results: [],
      summary: getHostIntelligenceSummary(),
      elapsedMs: Date.now() - t0,
    });
  }

  const targetPerLine = { ...runtimeConfig.targetPerLine };

  const startDelayMs = randInt(MAX_START_JITTER_MS);
  console.info(`[host-intel] Jitter: delaying start by ${Math.round(startDelayMs / 1000)}s`);
  await sleep(startDelayMs);

  const roll = Math.random();
  if (roll < SKIP_PROBABILITY) {
    console.info(`[host-intel] Jitter: skipping cycle (roll=${roll.toFixed(2)} < ${SKIP_PROBABILITY})`);
    return res.status(200).json({
      ok: true,
      message: 'Skipped this cycle (random jitter)',
      skipped: true,
      results: [],
      summary: getHostIntelligenceSummary(),
      elapsedMs: Date.now() - t0,
    });
  }

  try {
    /** @type {Array<{ reason: string; hostKey: string; gpuLine: string; ok: boolean; detail: string; elapsedMs: number }>} */
    let vastResults = [];
    /** @type {Record<string, unknown>|null} */
    let vastMeta = null;
    /** @type {Record<string, unknown>|null} */
    let cloreMeta = null;

    if (enabledProviders.includes('vast')) {
      const vastClient = new VastClient();
      const vastCycle = await runVastHostIntelligenceCycle(vastClient, targetPerLine);
      vastResults = vastCycle.results;
      vastMeta = vastCycle;
      console.info('[host-intel] Vast cycle', {
        tested: vastResults.length,
        passed: vastResults.filter((r) => r.ok).length,
        message: vastCycle.message,
      });
    }

    if (enabledProviders.includes('clore')) {
      cloreMeta = await runCloreHostIntelligenceCycle({
        targetPerLine,
        log: (msg) => console.info(msg),
      });
    }

    const cloreResults = Array.isArray(cloreMeta?.results) ? cloreMeta.results : [];
    const results = [...vastResults, ...cloreResults];
    const summary = getHostIntelligenceSummary();
    const passed = results.filter((r) => r.ok).length;

    console.info('[host-intel] cycle complete', {
      providers: enabledProviders,
      tested: results.length,
      passed,
      failed: results.length - passed,
      totalHosts: summary.totalHosts,
      knownGood: summary.knownGood,
      elapsedMs: Date.now() - t0,
    });

    return res.status(200).json({
      ok: true,
      providers: enabledProviders,
      vast: vastMeta,
      clore: cloreMeta,
      tested: results.length,
      passed,
      results,
      summary,
      jitter: { startDelayMs },
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    console.error('[host-intel] fatal:', err instanceof Error ? err.message : String(err));
    try { await persistHostReputationStoreAsync(); } catch { /* ignore */ }
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      elapsedMs: Date.now() - t0,
    });
  }
}
