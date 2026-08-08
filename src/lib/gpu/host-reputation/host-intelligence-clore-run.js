/**
 * Host Intelligence — Clore cycle (Discover / Recheck / BadRetry).
 *
 * Separate from Vast: host keys `clore-host:*`, marketplace = Clore /marketplace.
 * Uses lightweight gpu-test image (no ComfyUI onstart).
 */

import {
  CloreClient,
  CLORE_CREATE_ORDER_MIN_INTERVAL_MS,
  extractCloreOrderId,
  sanitizeCloreContainerEnv,
  classifyCloreServerForLine,
  cloreServerAcceptsCurrency,
} from '../providers/clore/clore-client.js';
import { resolveClorePublicEndpoints } from '../providers/clore/clore-mapper.js';
import { runTestProvisionGate } from '../providers/test-gate.js';
import { isCloreGpuLineSupported } from '../gpu-config.js';
import {
  resolveCloreHostKey,
  rememberHostSuccess,
  rememberHostFailure,
  listHostReputationRecords,
  isKnownGoodHost,
  loadHostReputationStoreAsync,
  persistHostReputationStoreAsync,
} from './index.js';
import { HOST_REPUTATION } from './host-reputation-config.js';
import { classifyHostFailure } from './host-reputation-classify.js';
import {
  allocateSlotsByDeficit,
  selectTargetsFair,
} from './host-intelligence-targets.js';
import { matchesHostIntelligenceProvider } from './host-intelligence-inventory.js';

export const CLORE_HOST_INTEL_GPU_LINES = ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'];
const LINE_TO_PLAN = { rtx3090: 'starter', rtx4090_1x: 'pro', rtx5090_1x: 'studio' };

const TEST_IMAGE = process.env.GPU_TEST_IMAGE || 'dieuhaukieuhanh/gpu-test:v1';
const TEST_GPU_PORT = Number(process.env.GPU_TEST_PORT || 8080);
const MAX_TEST_PER_CYCLE = HOST_REPUTATION.maxTestPerCycle || 2;
const MAX_TEST_BELOW_TARGET = HOST_REPUTATION.maxTestWhenBelowTarget || 4;

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

/**
 * Full marketplace host keys + rent shortlist for one Clore GPU line.
 * @param {CloreClient} client
 * @param {string} gpuLine
 */
async function searchCloreLineOffers(client, gpuLine) {
  if (!isCloreGpuLineSupported(gpuLine)) {
    return { rentCandidates: [], marketHostKeys: [], offerByHostKey: new Map() };
  }

  try {
    const plan = LINE_TO_PLAN[gpuLine] || 'starter';
    // findRankedOffers already filters currency/uptime/reputation and pins known-good
    const ranked = await client.findRankedOffers(gpuLine, plan, {
      maxCandidates: Math.max(6, MAX_TEST_BELOW_TARGET + 2),
    });

    /** @type {Map<string, import('../offer-selection.js').RankedOffer>} */
    const offerByHostKey = new Map();
    /** @type {Array<{ hostKey: string; offerId: number|string; gpuLine: string }>} */
    const rentCandidates = [];

    for (const offer of ranked) {
      const raw = offer.raw && typeof offer.raw === 'object'
        ? /** @type {Record<string, unknown>} */ (offer.raw)
        : null;
      const hostKey = resolveCloreHostKey(raw, offer.offerId, gpuLine);
      if (!hostKey || offer.offerId == null) continue;
      offerByHostKey.set(hostKey, offer);
      rentCandidates.push({ hostKey, offerId: offer.offerId, gpuLine });
    }

    // Broader market keys: all servers matching line (for available ∩ known-good)
    const servers = await client.searchOffers();
    /** @type {string[]} */
    const marketHostKeys = [];
    for (const server of servers) {
      if (!server || typeof server !== 'object') continue;
      const record = /** @type {Record<string, unknown>} */ (server);
      if (record.rented === true) continue;
      const classified = classifyCloreServerForLine(record, gpuLine);
      if (!classified) continue;
      if (!cloreServerAcceptsCurrency(record, client.currency)) continue;
      const hostKey = resolveCloreHostKey(record, record.id ?? record.server_id, gpuLine);
      if (hostKey) marketHostKeys.push(hostKey);
    }

    return { rentCandidates, marketHostKeys, offerByHostKey };
  } catch (err) {
    console.warn(
      `[host-intel-clore] search failed for ${gpuLine}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { rentCandidates: [], marketHostKeys: [], offerByHostKey: new Map() };
  }
}

/**
 * Create Clore order with gpu-test image only.
 * Must NOT call rentOfferOnce — that runs Comfy provision gate + destroy on fail.
 * @param {CloreClient} client
 * @param {import('../offer-selection.js').RankedOffer} best
 * @param {string} gpuLine
 */
async function rentCloreTestHost(client, best, gpuLine) {
  const serverId = Number(best.offerId);
  if (!Number.isFinite(serverId)) {
    throw new Error('invalid clore server id');
  }

  const sshPassword =
    String(process.env.CLORE_SSH_PASSWORD ?? '').trim() ||
    'Gv' +
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 8) +
      'A1';

  const label = 'gpuvietnam-host-intel-clore';
  /** @type {Record<string, unknown>} */
  const body = {
    type: 'on-demand',
    currency: client.currency,
    image: TEST_IMAGE,
    renting_server: serverId,
    ports: {
      '22': 'tcp',
      [String(TEST_GPU_PORT)]: 'http',
    },
    env: sanitizeCloreContainerEnv({
      HOST: '0.0.0.0',
      PORT: String(TEST_GPU_PORT),
      COMFYUI_PORT: String(TEST_GPU_PORT),
      GPUVIETNAM_LABEL: label,
    }),
    ssh_password: sshPassword,
    // Intentionally NO autossh_entrypoint / command — image CMD = health server
  };

  await client.assertPayCurrencyBalance();

  // Respect Clore create_order spacing (same as rentOfferOnce).
  const lastAt = Number(/** @type {{ _lastCreateOrderAt?: number }} */ (client)._lastCreateOrderAt || 0);
  if (lastAt > 0) {
    const elapsed = Date.now() - lastAt;
    if (elapsed < CLORE_CREATE_ORDER_MIN_INTERVAL_MS) {
      await sleep(CLORE_CREATE_ORDER_MIN_INTERVAL_MS - elapsed);
    }
  }
  /** @type {{ _lastCreateOrderAt?: number }} */ (client)._lastCreateOrderAt = Date.now();

  let rented;
  try {
    rented = await client.request('POST', '/create_order', body);
  } catch (createErr) {
    const msg = createErr instanceof Error ? createErr.message : String(createErr);
    if (/code.?1|internal server error/i.test(msg)) {
      const recoveredId = await client.recoverOrderIdAfterCreate(serverId, null, { label });
      if (recoveredId) {
        rented = { code: 0, order_id: recoveredId, id: recoveredId };
      } else {
        throw createErr;
      }
    } else {
      throw createErr;
    }
  }

  let orderId = extractCloreOrderId(rented);
  if (!orderId) {
    orderId = await client.recoverOrderIdAfterCreate(serverId, rented, { label });
  }
  if (!orderId) {
    throw new Error('clore create_order returned no order id');
  }

  let orderPayload =
    rented && typeof rented === 'object'
      ? /** @type {Record<string, unknown>} */ (rented)
      : { order_id: orderId };
  try {
    await sleep(800);
    const live = await client.getOrder(orderId);
    if (live && typeof live === 'object') {
      orderPayload = { ...orderPayload, ...live };
    }
  } catch {
    /* gate will re-fetch */
  }

  return { orderId, rented: orderPayload, sshPassword };
}

/**
 * Run one Clore Host Intelligence cycle.
 * @param {{
 *   targetPerLine?: Record<string, number>;
 *   log?: (msg: string) => void;
 * }} [options]
 */
export async function runCloreHostIntelligenceCycle(options = {}) {
  const log = options.log || ((msg) => console.log(msg));
  const targetPerLine = {
    rtx3090: 4,
    rtx4090_1x: 4,
    rtx5090_1x: 4,
    ...(options.targetPerLine || {}),
  };

  await loadHostReputationStoreAsync();

  const client = new CloreClient();
  if (!client.isConfigured()) {
    log('[host-intel-clore] Missing CLORE_API_KEY — skip');
    return {
      provider: 'clore',
      skipped: true,
      reason: 'missing_api_key',
      results: [],
      availablePerLine: {},
    };
  }

  const shuffledLines = shuffle([...CLORE_HOST_INTEL_GPU_LINES]);
  /** @type {Array<{ hostKey: string; offerId: number|string; gpuLine: string }>} */
  const allCandidates = [];
  /** @type {Set<string>} */
  const marketHostKeys = new Set();
  /** @type {Map<string, import('../offer-selection.js').RankedOffer>} */
  const offerByHostKey = new Map();

  for (const gpuLine of shuffledLines) {
    const { rentCandidates, marketHostKeys: keys, offerByHostKey: map } =
      await searchCloreLineOffers(client, gpuLine);
    allCandidates.push(...rentCandidates);
    for (const key of keys) marketHostKeys.add(key);
    for (const [k, v] of map) offerByHostKey.set(k, v);
  }

  /** @type {Record<string, number>} */
  const availablePerLine = { rtx3090: 0, rtx4090_1x: 0, rtx5090_1x: 0 };
  for (const r of listHostReputationRecords()) {
    if (!matchesHostIntelligenceProvider(r, 'clore')) continue;
    if (!isKnownGoodHost(r)) continue;
    if (!marketHostKeys.has(r.hostKey)) continue;
    const line = r.gpuLine || 'unknown';
    if (availablePerLine[line] != null) availablePerLine[line] += 1;
  }

  const belowTarget = CLORE_HOST_INTEL_GPU_LINES.filter((line) => {
    const available = availablePerLine[line] ?? 0;
    return available < (targetPerLine[line] ?? 4);
  });

  log(
    `[host-intel-clore] Available known-good: 3090=${availablePerLine.rtx3090 ?? 0} 4090=${availablePerLine.rtx4090_1x ?? 0} 5090=${availablePerLine.rtx5090_1x ?? 0}`,
  );

  if (belowTarget.length === 0) {
    log('[host-intel-clore] All Clore lines at target — skipping tests');
    await persistHostReputationStoreAsync();
    return {
      provider: 'clore',
      skipped: false,
      belowTarget: [],
      availablePerLine,
      results: [],
      tested: 0,
      passed: 0,
    };
  }

  let testCount = MAX_TEST_PER_CYCLE + randInt(MAX_TEST_BELOW_TARGET - MAX_TEST_PER_CYCLE + 1);
  testCount = Math.max(testCount, Math.min(belowTarget.length, MAX_TEST_BELOW_TARGET));
  const slotAlloc = allocateSlotsByDeficit(belowTarget, targetPerLine, availablePerLine, testCount);
  log(
    `[host-intel-clore] Below target: ${belowTarget.join(', ')}, testing up to ${testCount}, slots=${JSON.stringify(slotAlloc)}`,
  );

  const belowSet = new Set(belowTarget);
  const candidatesNeeded = allCandidates.filter((c) => belowSet.has(c.gpuLine));
  const targets = selectTargetsFair(candidatesNeeded, testCount, {
    belowTarget,
    targetPerLine,
    availablePerLine,
  });

  if (!targets.length) {
    log('[host-intel-clore] No testable Clore hosts this cycle');
    await persistHostReputationStoreAsync();
    return {
      provider: 'clore',
      availablePerLine,
      belowTarget,
      results: [],
      tested: 0,
      passed: 0,
    };
  }

  log(
    `[host-intel-clore] Targets: ${targets.map((t) => `${t.gpuLine}:${t.reason}:${t.hostKey}`).join(' | ')}`,
  );

  /** @type {Array<{ reason: string; hostKey: string; gpuLine: string; ok: boolean; detail: string; elapsedMs: number }>} */
  const results = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const tStart = Date.now();
    let orderId = null;

    try {
      const best = offerByHostKey.get(target.hostKey);
      if (!best) {
        results.push({
          reason: target.reason,
          hostKey: target.hostKey,
          gpuLine: target.gpuLine,
          ok: false,
          detail: 'offer not in shortlist map',
          elapsedMs: Date.now() - tStart,
        });
        continue;
      }

      const rented = await rentCloreTestHost(client, best, target.gpuLine);
      orderId = rented.orderId;
      log(`[host-intel-clore] rented orderId=${orderId} host=${target.hostKey} image=${TEST_IMAGE}`);

      const seedOrder =
        rented.rented && typeof rented.rented === 'object'
          ? /** @type {Record<string, unknown>} */ (rented.rented)
          : null;

      let lastOrder = seedOrder;
      const gate = await runTestProvisionGate({
        waitForEndpoint: async () => {
          try {
            const live = await client.getOrder(orderId);
            if (live && typeof live === 'object') {
              lastOrder = /** @type {Record<string, unknown>} */ (live);
            }
          } catch {
            /* keep lastOrder */
          }
          const endpoints = lastOrder
            ? resolveClorePublicEndpoints(lastOrder, TEST_GPU_PORT)
            : null;
          const url = endpoints?.endpointUrl ?? null;
          log(`[host-intel-clore] endpoint orderId=${orderId} url=${url}`);
          return url;
        },
        gpuLine: target.gpuLine,
        // Clore http_pub appears before container listen; allow pull + proxy settle.
        // 5090 hosts often need longer before /health is ready.
        timeoutMs: Math.max(
          HOST_REPUTATION.testGateTimeoutMs || 90_000,
          target.gpuLine === 'rtx5090_1x' ? 180_000 : 120_000,
        ),
      });

      if (gate.ok) {
        rememberHostSuccess(target.hostKey, {
          provider: 'clore',
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
          provider: 'clore',
          gpuLine: target.gpuLine,
          error: new Error(gate.detail),
          phase: 'provision',
          category,
        });
      }

      try {
        await client.destroyInstance(orderId);
      } catch {
        /* ignore */
      }

      results.push({
        reason: target.reason,
        hostKey: target.hostKey,
        gpuLine: target.gpuLine,
        ok: gate.ok,
        detail: gate.detail,
        elapsedMs: Date.now() - tStart,
      });
      log(
        `[host-intel-clore-result] status=${gate.ok ? 'OK' : 'FAIL'} host=${target.hostKey} line=${target.gpuLine} reason=${target.reason} detail="${gate.detail}" elapsed=${Date.now() - tStart}ms`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (orderId) {
        try {
          await client.destroyInstance(orderId);
        } catch {
          /* ignore */
        }
      }
      rememberHostFailure(target.hostKey, {
        provider: 'clore',
        gpuLine: target.gpuLine,
        error: err instanceof Error ? err : new Error(message),
        phase: 'provision',
      });
      results.push({
        reason: target.reason,
        hostKey: target.hostKey,
        gpuLine: target.gpuLine,
        ok: false,
        detail: message,
        elapsedMs: Date.now() - tStart,
      });
      log(
        `[host-intel-clore-result] status=ERROR host=${target.hostKey} line=${target.gpuLine} detail="${message}"`,
      );
    }

    if (i < targets.length - 1) {
      await sleep(5000 + randInt(5000));
    }
  }

  await persistHostReputationStoreAsync();
  const passed = results.filter((r) => r.ok).length;
  log(
    `[host-intel-clore] Cycle complete — tested=${results.length} passed=${passed} failed=${results.length - passed}`,
  );

  return {
    provider: 'clore',
    availablePerLine,
    belowTarget,
    slots: slotAlloc,
    results,
    tested: results.length,
    passed,
  };
}
