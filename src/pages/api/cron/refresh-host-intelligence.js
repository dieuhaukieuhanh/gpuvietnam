/**
 * Cron endpoint: Host Intelligence System refresh.
 *
 * Runs every 15 min via Vercel cron. Discovers + re-tests Vast GPU hosts
 * using a lightweight test image (~300MB, no ComfyUI). Clore support can
 * be added later — same architecture, just needs rate-limit-aware scheduling
 * (Clore enforces 5.5s between create_order calls).
 *
 * Three job types per cycle:
 *   A) Discover — test hosts never seen before
 *   B) Recheck — re-verify stale known-good hosts (>24h since last check)
 *   C) BadRetry — retest failed hosts after cooldown period (default 3 days)
 *
 * Costs ~$0.002-0.01 per cycle (< $15/month total).
 */

import { HOST_REPUTATION, readHostIntelligenceConfigAsync } from '@/lib/gpu/host-reputation/host-reputation-config';
import {
  getHostsNeedingRecheck,
  getHostsInCooldownDone,
  isHostUnseen,
  resolveVastHostKey,
  rememberHostSuccess,
  rememberHostFailure,
  getHostIntelligenceSummary,
} from '@/lib/gpu/host-reputation/index.js';
import { classifyHostFailure } from '@/lib/gpu/host-reputation/host-reputation-classify.js';
import { VastClient } from '@/lib/gpu/providers/vast/vast-client.js';
import { runTestProvisionGate } from '@/lib/gpu/providers/test-gate.js';
import { resolveVastEndpoint } from '@/lib/gpu/providers/vast/vast-endpoint-resolver.js';
import { normalizeVastOffer, selectWorkstationOffers } from '@/lib/gpu/offer-selection.js';
import { filterVastOffersBySanity } from '@/lib/gpu/providers/vast/vast-offer-sanity.js';

// GPU line → plan mapping (same as PLAN_TO_GPU but reversed)
const LINE_TO_PLAN = {
  rtx3090: 'starter',
  rtx4090_1x: 'pro',
  rtx5090_1x: 'studio',
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TEST_IMAGE = process.env.GPU_TEST_IMAGE || 'dieuhaukieuhanh/gpu-test:v1';
const TEST_GPU_PORT = Number(process.env.GPU_TEST_PORT || 8080);
const GPU_LINES = ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'];
const MAX_TEST_PER_CYCLE = HOST_REPUTATION.maxTestPerCycle || 2;
const MAX_TEST_BELOW_TARGET = HOST_REPUTATION.maxTestWhenBelowTarget || 4;

// ── Jitter / anti-pattern detection ────────────────────────────────────
// Providers should NOT see a fixed periodic pattern (every 15 min exactly).

/** Probability of skipping a cycle entirely (0.0-1.0). Default 10%. */
const SKIP_PROBABILITY = Number(process.env.HOST_INTEL_SKIP_PROBABILITY || 0.10);

/** Max initial delay before starting work (ms). Default 6 min (25% of 25-min interval). */
const MAX_START_JITTER_MS = Number(process.env.HOST_INTEL_START_JITTER_MS || 360_000);

/** Max delay between tests within a cycle (ms). Default 30s. */
const MAX_INTER_TEST_JITTER_MS = Number(process.env.HOST_INTEL_INTER_TEST_JITTER_MS || 30_000);

/**
 * Crypto-grade random in [0, max).
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
 * Shuffle array in-place (Fisher-Yates).
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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function isAuthorized(req) {
  if (req.headers['x-vercel-cron']) return true;
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Search + filter Vast offers using the same pipeline as user requests.
 * Only consider offers passing: normalization → sanity filter → workstation selection.
 * This ensures we only test hosts the system would actually rent for users.
 *
 * @param {VastClient} client
 * @param {string} gpuLine
 * @returns {Promise<Array<{ hostKey: string; offerId: number | string; gpuLine: string }>>}
 */
async function searchCandidates(client, gpuLine) {
  try {
    const plan = LINE_TO_PLAN[gpuLine] || 'starter';
    const rawOffers = await client.searchOffers(gpuLine);
    if (!rawOffers.length) return [];

    // 1. Normalize (same as findRankedGPUOffers)
    const normalized = [];
    for (const raw of rawOffers) {
      const offer = normalizeVastOffer(/** @type {Record<string, unknown>} */ (raw));
      if (offer) normalized.push(offer);
    }
    if (!normalized.length) return [];

    // 2. Sanity filter (uptime ≥ 98%, VRAM, GPU name match, price band)
    const { offers: saneOffers } = filterVastOffersBySanity(normalized, gpuLine, { plan });
    if (!saneOffers.length) return [];

    // 3. Workstation selection (uptime groups, top cheapest per group)
    const selected = selectWorkstationOffers(saneOffers, { plan, gpuLine });
    if (!selected.length) return [];

    // 4. Extract hostKey + offerId from filtered offers
    return selected
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
  } catch (err) {
    console.warn(`[host-intel] Vast search failed for ${gpuLine}:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Select targets by priority: Discover > Recheck > BadRetry.
 */
function selectTargets(allCandidates, maxTotal) {
  /** @type {Array<{ hostKey: string; offerId: number|string; gpuLine: string; reason: string }>} */
  const targets = [];
  /** @type {Set<string>} */
  const seen = new Set();

  function add(c, reason) {
    if (targets.length >= maxTotal) return;
    if (seen.has(c.hostKey)) return;
    seen.add(c.hostKey);
    targets.push({ ...c, reason });
  }

  // A) Discover: never-before-seen hosts
  for (const c of allCandidates) {
    if (targets.length >= maxTotal) break;
    if (isHostUnseen(c.hostKey)) add(c, 'discover');
  }

  // B) Recheck: stale known-good hosts (sample up to 10% of stale pool)
  if (targets.length < maxTotal) {
    const staleRecords = getHostsNeedingRecheck();
    const sampleSize = Math.max(1, Math.ceil(staleRecords.length * HOST_REPUTATION.staleSampleFraction));
    const sampled = staleRecords.slice(0, sampleSize);
    const staleKeys = new Set(sampled.map((r) => r.hostKey));
    for (const c of allCandidates) {
      if (targets.length >= maxTotal) break;
      if (staleKeys.has(c.hostKey)) add(c, 'recheck');
    }
  }

  // C) BadRetry: cooldown-expired hosts
  if (targets.length < maxTotal) {
    const cdRecords = getHostsInCooldownDone();
    const cdKeys = new Set(cdRecords.map((r) => r.hostKey));
    for (const c of allCandidates) {
      if (targets.length >= maxTotal) break;
      if (cdKeys.has(c.hostKey)) add(c, 'bad_retry');
    }
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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
  const vastClient = new VastClient();
  /** @type {Array<{ reason: string; hostKey: string; gpuLine: string; ok: boolean; detail: string; elapsedMs: number }>} */
  const results = [];

  if (!vastClient.apiKey) {
    return res.status(200).json({
      ok: true,
      message: 'Vast not configured (missing VAST_AI_KEY)',
      results: [],
      summary: getHostIntelligenceSummary(),
      elapsedMs: Date.now() - t0,
    });
  }

  // ── Runtime config (admin UI) ────────────────────────────────────────
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

  // Filter GPU lines by provider availability. If both providers disabled, skip.
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

  // Use admin-configurable target per GPU line
  const targetPerLine = { ...runtimeConfig.targetPerLine };
  const TARGET_PER_LINE = targetPerLine;

  // ── Jitter: anti-pattern detection ──────────────────────────────────

  // 1. Random initial delay before starting any work (0-6 min)
  const startDelayMs = randInt(MAX_START_JITTER_MS);
  console.info(`[host-intel] Jitter: delaying start by ${Math.round(startDelayMs / 1000)}s`);
  await sleep(startDelayMs);

  // 2. Random skip — sometimes do nothing (10% chance by default)
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

  // 3. Vary GPU line order randomly each cycle
  const shuffledLines = shuffle([...GPU_LINES]);

  // 4. Adaptive test count — more aggressive when pool is below target
  const summary = getHostIntelligenceSummary();
  const belowTarget = GPU_LINES.filter((line) => {
    const count = summary.knownGoodByLine?.[line] ?? 0;
    const target = typeof TARGET_PER_LINE === 'object' ? (TARGET_PER_LINE[line] ?? 4) : 4;
    return count < target;
  });

  let testCount = 1 + randInt(MAX_TEST_PER_CYCLE); // default: 1-2
  if (belowTarget.length > 0) {
    // Pool below target — test more aggressively (up to MAX_TEST_BELOW_TARGET)
    testCount = MAX_TEST_PER_CYCLE + randInt(MAX_TEST_BELOW_TARGET - MAX_TEST_PER_CYCLE + 1);
    console.info(`[host-intel] Pool below target: ${belowTarget.join(', ')} need more hosts, testing up to ${testCount}`);
  }

  try {
    // 1. Collect candidates across shuffled GPU lines
    /** @type {Array<{ hostKey: string; offerId: number|string; gpuLine: string }>} */
    const allCandidates = [];
    for (const gpuLine of shuffledLines) {
      const candidates = await searchCandidates(vastClient, gpuLine);
      allCandidates.push(...candidates);
    }

    if (allCandidates.length === 0) {
      return res.status(200).json({
        ok: true,
        message: 'No marketplace offers found',
        results: [],
        summary: getHostIntelligenceSummary(),
        skipped: false,
        jitter: { startDelayMs },
        elapsedMs: Date.now() - t0,
      });
    }

    // 2. Select targets by priority (shuffle within each priority class)
    const targets = selectTargets(allCandidates, testCount);

    if (targets.length === 0) {
      return res.status(200).json({
        ok: true,
        message: 'No hosts need testing this cycle',
        candidates: allCandidates.length,
        results: [],
        summary: getHostIntelligenceSummary(),
        skipped: false,
        jitter: { startDelayMs, testCount },
        elapsedMs: Date.now() - t0,
      });
    }

    // 3. Test each target with inter-test jitter
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const tStart = Date.now();
      let instanceId = null;

      try {
        // Rent with test image
        const comfyPort = TEST_GPU_PORT;
        const rentBody = {
          label: 'gpuvietnam-host-intel',
          image: TEST_IMAGE,
          disk: 20,
          runtype: 'args',
          target_state: 'running',
          env: {
            [`-p ${comfyPort}:${comfyPort}`]: '1',
            HOST: '0.0.0.0',    // IPv4 — Vast hosts may not have IPv6
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
            detail: 'rent returned no instance id',
            elapsedMs: Date.now() - tStart,
          });
          continue;
        }

        const liveInstance = rented && typeof rented === 'object'
          ? /** @type {Record<string, unknown>} */ (rented)
          : null;

        // Wait for endpoint + run test gate
        const waitForEndpoint = async () => {
          const resolved = await resolveVastEndpoint(
            vastClient,
            instanceId,
            comfyPort,
            liveInstance,
          );
          return resolved?.status === 'resolved' ? resolved.endpoint?.url ?? null : null;
        };

        const gate = await runTestProvisionGate({
          waitForEndpoint,
          gpuLine: target.gpuLine,
          timeoutMs: HOST_REPUTATION.testGateTimeoutMs,
        });

        // Record result
        if (gate.ok) {
          rememberHostSuccess(target.hostKey, {
            gpuName: gate.gpuName,
            vramGb: gate.vramGb,
            driverVersion: gate.driverVersion,
            readyLatencyMs: gate.elapsedMs,
            bootSec: gate.bootSec,
          });
        } else {
          const category = classifyHostFailure(gate.detail);
          rememberHostFailure(target.hostKey, {
            error: new Error(gate.detail),
            phase: 'provision',
            category,
          });
        }

        // Destroy
        try {
          await vastClient.destroyInstance(instanceId);
        } catch (destroyErr) {
          console.warn(`[host-intel] destroy ${instanceId} failed:`,
            destroyErr instanceof Error ? destroyErr.message : String(destroyErr));
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
        // Best-effort cleanup
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

      // ── Inter-test jitter (0-30s random delay between hosts) ──
      if (i < targets.length - 1) {
        const interDelayMs = randInt(MAX_INTER_TEST_JITTER_MS);
        if (interDelayMs > 0) {
          console.info(`[host-intel] Jitter: inter-test delay ${Math.round(interDelayMs / 1000)}s`);
          await sleep(interDelayMs);
        }
      }
    }

    const summary = getHostIntelligenceSummary();
    const passed = results.filter((r) => r.ok).length;

    console.info('[host-intel] cycle complete', {
      candidates: allCandidates.length,
      targets: targets.length,
      tested: results.length,
      passed,
      failed: results.length - passed,
      totalHosts: summary.totalHosts,
      knownGood: summary.knownGood,
      stale: summary.stale,
      reasons: results.map((r) => r.reason),
      elapsedMs: Date.now() - t0,
    });

    return res.status(200).json({
      ok: true,
      candidates: allCandidates.length,
      targets: targets.length,
      tested: results.length,
      passed,
      results,
      summary,
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    console.error('[host-intel] fatal:', err instanceof Error ? err.message : String(err));
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      results,
      elapsedMs: Date.now() - t0,
    });
  }
}
