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
import {
  filterVastOffersBySanity,
  isVastDiskOnlyBilling,
  unwrapVastInstanceRecord,
} from '../src/lib/gpu/providers/vast/vast-offer-sanity.js';
import {
  resolveVastHostKey,
  rememberHostSuccess,
  rememberHostFailure,
  getHostIntelligenceSummary,
  listHostReputationRecords,
  isKnownGoodHost,
  loadHostReputationStoreAsync,
  persistHostReputationStoreAsync,
} from '../src/lib/gpu/host-reputation/index.js';
import { HOST_REPUTATION, readHostIntelligenceConfigAsync } from '../src/lib/gpu/host-reputation/host-reputation-config.js';
import { classifyHostFailure } from '../src/lib/gpu/host-reputation/host-reputation-classify.js';
import {
  allocateSlotsByDeficit,
  selectTargetsFair,
} from '../src/lib/gpu/host-reputation/host-intelligence-targets.js';
import { runCloreHostIntelligenceCycle } from '../src/lib/gpu/host-reputation/host-intelligence-clore-run.js';
import { matchesHostIntelligenceProvider } from '../src/lib/gpu/host-reputation/host-intelligence-inventory.js';
import {
  HOST_INTEL_VAST_LABEL,
  acquireHostIntelLock,
  releaseHostIntelLock,
  installHostIntelCleanupHooks,
  setHostIntelDestroyers,
  trackHostIntelVastInstance,
  cleanupTrackedHostIntelLeases,
  destroyHostIntelLeaseWithRetry,
  resolveHostIntelProbeMaxMs,
} from '../src/lib/gpu/host-reputation/host-intel-runtime.js';

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
/**
 * @returns {Promise<{
 *   rentCandidates: Array<{ hostKey: string; offerId: number|string; gpuLine: string }>;
 *   marketHostKeys: string[];
 * }>}
 */
async function searchLineOffers(client, gpuLine) {
  try {
    const plan = LINE_TO_PLAN[gpuLine] || 'starter';
    const rawOffers = await client.searchOffers(gpuLine);
    if (!rawOffers.length) return { rentCandidates: [], marketHostKeys: [] };

    const normalized = [];
    for (const raw of rawOffers) {
      const offer = normalizeVastOffer(raw);
      if (offer) normalized.push(offer);
    }
    if (!normalized.length) return { rentCandidates: [], marketHostKeys: [] };

    const { offers: saneOffers } = filterVastOffersBySanity(normalized, gpuLine, { plan });
    if (!saneOffers.length) return { rentCandidates: [], marketHostKeys: [] };

    // Available inventory = known-good still listed anywhere in sane marketplace
    const marketHostKeys = [];
    for (const offer of saneOffers) {
      const raw = offer.raw && typeof offer.raw === 'object' ? offer.raw : null;
      if (!raw) continue;
      const hostKey = resolveVastHostKey(raw, gpuLine);
      if (hostKey) marketHostKeys.push(hostKey);
    }

    // Rent/test shortlist stays price/uptime truncated
    const selected = selectWorkstationOffers(saneOffers, { plan, gpuLine });
    const rentCandidates = selected
      .map((offer) => {
        const raw = offer.raw && typeof offer.raw === 'object' ? offer.raw : null;
        if (!raw) return null;
        const hostKey = resolveVastHostKey(raw, gpuLine);
        const offerId = raw.id ?? raw.offer_id ?? raw.bundle_id ?? offer.offerId;
        if (!hostKey || offerId == null) return null;
        return { hostKey, offerId, gpuLine };
      })
      .filter((c) => c != null);

    return { rentCandidates, marketHostKeys };
  } catch (err) {
    console.warn(`[host-intel] Vast search failed for ${gpuLine}:`, err.message);
    return { rentCandidates: [], marketHostKeys: [] };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('[host-intel] VPS cron starting');

  const lock = acquireHostIntelLock();
  if (!lock.ok) {
    console.warn(
      `[host-intel] Another cycle is running (lock holder pid=${lock.holderPid ?? '?'}) — skip overlap`,
    );
    return;
  }
  installHostIntelCleanupHooks();

  try {
  // 0. Load reputation SoT (JSON + Supabase merge) before any decisions
  await loadHostReputationStoreAsync();

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

  const targetPerLine = runtimeConfig.targetPerLine;

  // ── Vast cycle (optional) ─────────────────────────────────────────────
  if (enabledProviders.includes('vast')) {
    const vastClient = new VastClient();
    setHostIntelDestroyers({
      destroyVast: (id) => vastClient.destroyInstance(id),
    });
    if (!vastClient.apiKey) {
      console.log('[host-intel] Vast enabled but missing VAST_AI_KEY — skip Vast');
    } else {
      const shuffledLines = shuffle([...GPU_LINES]);
      const allCandidates = [];
      const marketHostKeys = new Set();
      for (const gpuLine of shuffledLines) {
        const { rentCandidates, marketHostKeys: keys } = await searchLineOffers(vastClient, gpuLine);
        allCandidates.push(...rentCandidates);
        for (const key of keys) marketHostKeys.add(key);
      }

      const records = listHostReputationRecords();
      const availablePerLine = {};
      for (const r of records) {
        if (!matchesHostIntelligenceProvider(r, 'vast')) continue;
        if (isKnownGoodHost(r) && marketHostKeys.has(r.hostKey)) {
          const line = r.gpuLine || 'unknown';
          availablePerLine[line] = (availablePerLine[line] || 0) + 1;
        }
      }

      const belowTarget = GPU_LINES.filter((line) => {
        const available = availablePerLine[line] ?? 0;
        return available < (targetPerLine[line] ?? 4);
      });

      console.log(`[host-intel] Vast available: 3090=${availablePerLine['rtx3090']??0} 4090=${availablePerLine['rtx4090_1x']??0} 5090=${availablePerLine['rtx5090_1x']??0}`);

      const belowTargetSet = new Set(belowTarget);
      const candidatesNeeded = allCandidates.filter((c) => belowTargetSet.has(c.gpuLine));

      if (belowTarget.length === 0) {
        console.log('[host-intel] Vast: all lines at target — skip tests');
      } else if (candidatesNeeded.length === 0) {
        console.log('[host-intel] Vast: no candidates for below-target lines');
      } else {
        let testCount = MAX_TEST_PER_CYCLE + randInt(MAX_TEST_BELOW_TARGET - MAX_TEST_PER_CYCLE + 1);
        testCount = Math.max(testCount, Math.min(belowTarget.length, MAX_TEST_BELOW_TARGET));
        const slotAlloc = allocateSlotsByDeficit(belowTarget, targetPerLine, availablePerLine, testCount);
        console.log(`[host-intel] Vast below: ${belowTarget.join(', ')}, testing up to ${testCount}, slots=${JSON.stringify(slotAlloc)}`);

        const targets = selectTargetsFair(candidatesNeeded, testCount, {
          belowTarget,
          targetPerLine,
          availablePerLine,
        });
        console.log(`[host-intel] Vast targets: ${targets.map((t) => `${t.gpuLine}:${t.reason}:${t.hostKey}`).join(' | ')}`);

        const results = [];
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i];
          const tStart = Date.now();
          let instanceId = null;

          try {
            const comfyPort = TEST_GPU_PORT;
            const rentBody = {
              label: HOST_INTEL_VAST_LABEL,
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
                ? (rented.new_contract ?? rented.id ?? rented.instance_id)
                : null) ?? '',
            );
            console.log(`[host-intel-debug] rented: offerId=${target.offerId} instanceId=${instanceId} image=${TEST_IMAGE}`);

            if (!instanceId) {
              results.push({ reason: target.reason, hostKey: target.hostKey, gpuLine: target.gpuLine, ok: false, detail: 'no instance id' });
              continue;
            }
            trackHostIntelVastInstance(instanceId);

            const liveInstance = rented && typeof rented === 'object' ? rented : null;
            const probeMaxMs = resolveHostIntelProbeMaxMs();
            const gateTimeoutMs = Math.min(
              HOST_REPUTATION.testGateTimeoutMs || 90_000,
              probeMaxMs,
            );
            const gate = await Promise.race([
              runTestProvisionGate({
                waitForEndpoint: async () => {
                  // Fail fast on Vast disk-only / GPU struck-through before HTTP looks "ok".
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
                    // getInstance flakiness — continue endpoint poll
                  }
                  const resolved = await resolveVastEndpoint(vastClient, instanceId, comfyPort, liveInstance);
                  const url = resolved?.status === 'resolved' ? resolved.endpoint?.url ?? null : null;
                  console.log(`[host-intel-debug] endpoint resolution: instanceId=${instanceId} status=${resolved?.status} url=${url}`);
                  return url;
                },
                gpuLine: target.gpuLine,
                timeoutMs: gateTimeoutMs,
              }),
              sleep(probeMaxMs).then(() => ({
                ok: false,
                detail: `probe_max_ms_exceeded (${probeMaxMs})`,
                elapsedMs: probeMaxMs,
                gpuName: null,
                vramGb: null,
                driverVersion: null,
                bootSec: null,
              })),
            ]);

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

            await destroyHostIntelLeaseWithRetry(
              (id) => vastClient.destroyInstance(id),
              instanceId,
              'vast',
            );

            results.push({
              reason: target.reason, hostKey: target.hostKey, gpuLine: target.gpuLine,
              ok: gate.ok, detail: gate.detail, elapsedMs: Date.now() - tStart,
            });
            console.log(`[host-intel-result] status=${gate.ok ? 'OK' : 'FAIL'} host=${target.hostKey} line=${target.gpuLine} reason=${target.reason} detail="${gate.detail}" elapsed=${Date.now() - tStart}ms`);
          } catch (err) {
            if (instanceId) {
              try {
                await destroyHostIntelLeaseWithRetry(
                  (id) => vastClient.destroyInstance(id),
                  instanceId,
                  'vast',
                );
              } catch {
                /* alert already emitted */
              }
            }
            results.push({ reason: target.reason, hostKey: target.hostKey, gpuLine: target.gpuLine, ok: false, detail: err.message, elapsedMs: Date.now() - tStart });
            console.warn(`[host-intel-result] status=ERROR host=${target.hostKey} detail="${err.message}"`);
          }

          if (i < targets.length - 1) await sleep(2000 + randInt(5000));
        }

        await persistHostReputationStoreAsync();
        const passed = results.filter((r) => r.ok).length;
        console.log('[host-intel] Vast cycle complete —', {
          tested: results.length, passed, failed: results.length - passed,
        });
      }
    }
  } else {
    console.log('[host-intel] Vast disabled in admin config — skip Vast');
  }

  // ── Clore cycle (optional) ────────────────────────────────────────────
  if (enabledProviders.includes('clore')) {
    await runCloreHostIntelligenceCycle({
      targetPerLine,
      log: (msg) => console.log(msg),
    });
  } else {
    console.log('[host-intel] Clore disabled in admin config — skip Clore');
  }

  const summary2 = getHostIntelligenceSummary();
  console.log('[host-intel] Cron finished —', {
    knownGood: summary2.knownGood,
    totalHosts: summary2.totalHosts,
    providers: enabledProviders,
  });

  await cleanupTrackedHostIntelLeases({ reason: 'cycle_end' });
  } finally {
    releaseHostIntelLock();
  }
}

main().catch(async (err) => {
  console.error('[host-intel] Fatal:', err);
  try {
    await cleanupTrackedHostIntelLeases({ reason: 'fatal' });
  } catch {
    /* ignore */
  }
  try {
    await persistHostReputationStoreAsync();
  } catch {
    /* ignore */
  }
  releaseHostIntelLock();
  process.exit(1);
});
