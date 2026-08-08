/**
 * Host Intelligence Cron Worker — standalone script for VPS.
 *
 * Runs the same logic as /api/cron/refresh-host-intelligence but without
 * Next.js or Vercel serverless constraints. Designed to run via systemd timer
 * or crontab every 25 minutes.
 *
 * Usage:
 *   node scripts/host-intelligence-cron.mjs
 *
 * Env vars needed:
 *   VAST_AI_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 *   Optional: HOST_REP_* overrides
 */

import { VastClient } from '../src/lib/gpu/providers/vast/vast-client.js';
import { runTestProvisionGate } from '../src/lib/gpu/providers/test-gate.js';
import { resolveVastEndpoint } from '../src/lib/gpu/providers/vast/vast-endpoint-resolver.js';
import { normalizeVastOffer, selectWorkstationOffers } from '../src/lib/gpu/offer-selection.js';
import { filterVastOffersBySanity } from '../src/lib/gpu/providers/vast/vast-offer-sanity.js';
import {
  getHostsNeedingRecheck,
  getHostsInCooldownDone,
  isHostUnseen,
  resolveVastHostKey,
  rememberHostSuccess,
  rememberHostFailure,
  getHostIntelligenceSummary,
} from '../src/lib/gpu/host-reputation/index.js';
import { HOST_REPUTATION, readHostIntelligenceConfigAsync } from '../src/lib/gpu/host-reputation/host-reputation-config.js';
import { classifyHostFailure } from '../src/lib/gpu/host-reputation/host-reputation-classify.js';

// ── Config ─────────────────────────────────────────────────────────────────
const TEST_IMAGE = process.env.GPU_TEST_IMAGE || 'dieuhaukieuhanh/gpu-test:v1';
const TEST_GPU_PORT = Number(process.env.GPU_TEST_PORT || 8080);
const GPU_LINES = ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'];
const LINE_TO_PLAN = { rtx3090: 'starter', rtx4090_1x: 'pro', rtx5090_1x: 'studio' };

const MAX_TEST_PER_CYCLE = HOST_REPUTATION.maxTestPerCycle || 2;
const MAX_TEST_BELOW_TARGET = HOST_REPUTATION.maxTestWhenBelowTarget || 4;

// ── Helpers ────────────────────────────────────────────────────────────────
function randInt(max) {
  if (max <= 0) return 0;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Candidate search ───────────────────────────────────────────────────────
async function searchCandidates(client, gpuLine) {
  try {
    const plan = LINE_TO_PLAN[gpuLine] || 'starter';
    const rawOffers = await client.searchOffers(gpuLine);
    if (!rawOffers.length) return [];

    const normalized = [];
    for (const raw of rawOffers) {
      const offer = normalizeVastOffer(raw);
      if (offer) normalized.push(offer);
    }
    if (!normalized.length) return [];

    const { offers: saneOffers } = filterVastOffersBySanity(normalized, gpuLine, { plan });
    if (!saneOffers.length) return [];

    const selected = selectWorkstationOffers(saneOffers, { plan, gpuLine });
    if (!selected.length) return [];

    return selected
      .map((offer) => {
        const raw = offer.raw && typeof offer.raw === 'object' ? offer.raw : null;
        if (!raw) return null;
        const hostKey = resolveVastHostKey(raw, gpuLine);
        const offerId = raw.id ?? raw.offer_id ?? raw.bundle_id ?? offer.offerId;
        if (!hostKey || offerId == null) return null;
        return { hostKey, offerId, gpuLine };
      })
      .filter((c) => c != null);
  } catch (err) {
    console.warn(`[host-intel] Vast search failed for ${gpuLine}:`, err.message);
    return [];
  }
}

function selectTargets(allCandidates, maxTotal) {
  const targets = [];
  const seen = new Set();

  function add(c, reason) {
    if (targets.length >= maxTotal) return;
    if (seen.has(c.hostKey)) return;
    seen.add(c.hostKey);
    targets.push({ ...c, reason });
  }

  // A) Discover
  for (const c of allCandidates) {
    if (targets.length >= maxTotal) break;
    if (isHostUnseen(c.hostKey)) add(c, 'discover');
  }

  // B) Recheck
  if (targets.length < maxTotal) {
    const staleRecords = getHostsNeedingRecheck();
    const sampleSize = Math.max(1, Math.ceil(staleRecords.length * 0.1));
    const sampled = staleRecords.slice(0, sampleSize);
    const staleKeys = new Set(sampled.map((r) => r.hostKey));
    for (const c of allCandidates) {
      if (targets.length >= maxTotal) break;
      if (staleKeys.has(c.hostKey)) add(c, 'recheck');
    }
  }

  // C) BadRetry
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

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('[host-intel] VPS cron starting');

  // 1. Check config
  const runtimeConfig = await readHostIntelligenceConfigAsync();
  if (!runtimeConfig.enabled) {
    console.log('[host-intel] Disabled in admin config — exiting');
    return;
  }

  const enabledProviders = Object.entries(runtimeConfig.providers)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  if (enabledProviders.length === 0) {
    console.log('[host-intel] No providers enabled — exiting');
    return;
  }

  if (!enabledProviders.includes('vast')) {
    console.log('[host-intel] Vast not enabled — exiting (Clore cron not implemented yet)');
    return;
  }

  // 2. Check Vast API key
  const vastClient = new VastClient();
  if (!vastClient.apiKey) {
    console.log('[host-intel] Missing VAST_AI_KEY — exiting');
    return;
  }

  // 3. Adaptive test count
  const summary = getHostIntelligenceSummary();
  const targetPerLine = runtimeConfig.targetPerLine;
  const belowTarget = GPU_LINES.filter((line) => {
    const count = summary.knownGoodByLine?.[line] ?? 0;
    return count < (targetPerLine[line] ?? 4);
  });

  let testCount = 1 + randInt(MAX_TEST_PER_CYCLE);
  if (belowTarget.length > 0) {
    testCount = MAX_TEST_PER_CYCLE + randInt(MAX_TEST_BELOW_TARGET - MAX_TEST_PER_CYCLE + 1);
    console.log(`[host-intel] Pool below target: ${belowTarget.join(', ')}, testing up to ${testCount}`);
  }

  // 4. Collect candidates
  const shuffledLines = shuffle([...GPU_LINES]);
  const allCandidates = [];
  for (const gpuLine of shuffledLines) {
    const candidates = await searchCandidates(vastClient, gpuLine);
    allCandidates.push(...candidates);
  }

  if (allCandidates.length === 0) {
    console.log('[host-intel] No marketplace offers found');
    return;
  }

  // 5. Select targets
  const targets = selectTargets(allCandidates, testCount);
  if (targets.length === 0) {
    console.log('[host-intel] No hosts need testing this cycle');
    return;
  }

  // 6. Test each target
  const results = [];
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
          COMFYUI_PORT: String(comfyPort),
          COMFYUI_LISTEN: '0.0.0.0',
        },
      };

      const rented = await vastClient.request('PUT', `/asks/${target.offerId}/`, rentBody);
      instanceId = String(
        (rented && typeof rented === 'object'
          ? (rented.new_contract ?? rented.id ?? rented.instance_id)
          : null) ?? '',
      );
      console.log(`[host-intel-debug] rented: offerId=${target.offerId} instanceId=${instanceId} image=${TEST_IMAGE}`);

      if (!instanceId) {
        results.push({ reason: target.reason, hostKey: target.hostKey, gpuLine: target.gpuLine, ok: false, detail: 'no instance id' });
        continue;
      }

      const liveInstance = rented && typeof rented === 'object' ? rented : null;

      const waitForEndpoint = async () => {
        const resolved = await resolveVastEndpoint(vastClient, instanceId, comfyPort, liveInstance);
        const url = resolved?.status === 'resolved' ? resolved.endpoint?.url ?? null : null;
        console.log(`[host-intel-debug] endpoint resolution: instanceId=${instanceId} status=${resolved?.status} url=${url} detail=${resolved?.detail}`);
        return url;
      };

      const gate = await runTestProvisionGate({
        waitForEndpoint,
        gpuLine: target.gpuLine,
        timeoutMs: HOST_REPUTATION.testGateTimeoutMs,
      });

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
        rememberHostFailure(target.hostKey, { error: new Error(gate.detail), phase: 'provision', category });
      }

      try { await vastClient.destroyInstance(instanceId); } catch { /* ignore */ }

      results.push({
        reason: target.reason, hostKey: target.hostKey, gpuLine: target.gpuLine,
        ok: gate.ok, detail: gate.detail, elapsedMs: Date.now() - tStart,
      });
      const status = gate.ok ? 'OK' : 'FAIL';
      console.log(`[host-intel-result] status=${status} host=${target.hostKey} line=${target.gpuLine} reason=${target.reason} detail="${gate.detail}" elapsed=${Date.now() - tStart}ms`);

    } catch (err) {
      if (instanceId) { try { await vastClient.destroyInstance(instanceId); } catch { /* ignore */ } }
      results.push({ reason: target.reason, hostKey: target.hostKey, gpuLine: target.gpuLine, ok: false, detail: err.message, elapsedMs: Date.now() - tStart });
      console.warn(`[host-intel-result] status=ERROR host=${target.hostKey} line=${target.gpuLine} reason=${target.reason} detail="${err.message}"`);
    }

    // Brief pause between tests
    if (i < targets.length - 1) {
      await sleep(2000 + randInt(5000));
    }
  }

  const summary2 = getHostIntelligenceSummary();
  const passed = results.filter((r) => r.ok).length;
  console.log('[host-intel] Cycle complete —', {
    candidates: allCandidates.length, targets: targets.length, tested: results.length, passed, failed: results.length - passed,
    knownGood: summary2.knownGood, totalHosts: summary2.totalHosts,
  });
}

main().catch((err) => {
  console.error('[host-intel] Fatal:', err);
  process.exit(1);
});
