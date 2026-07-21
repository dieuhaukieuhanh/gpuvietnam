/**
 * Dual-run capacity helpers — count distinct marketplace hosts for a GPU line.
 */

import { hostKeyIsExcluded, normalizeExcludeHostToken } from '../gpu/exclude-host-keys.js';
import { resolveGpuLineFromPlan } from '../gpu/gpu-config.js';

/**
 * Prefer running machine GPU, else explicit line, else plan → package GPU.
 * Render an toàn always rents the same GPU type as the active package.
 *
 * @param {{
 *   activeGpuLine?: string | null;
 *   gpuLine?: string | null;
 *   planKey?: string | null;
 * }} input
 * @returns {string | null}
 */
export function resolveDualRunGpuLine(input = {}) {
  const active = String(input.activeGpuLine ?? '').trim();
  if (active) return active;
  const explicit = String(input.gpuLine ?? '').trim();
  if (explicit) return explicit;
  return resolveGpuLineFromPlan(input.planKey) || null;
}

/**
 * Physical host identity for counting (strip |gpuLine suffix).
 * @param {unknown} hostKey
 */
export function physicalHostId(hostKey) {
  const full = normalizeExcludeHostToken(hostKey);
  if (!full) return null;
  return full.split('|')[0];
}

/**
 * @param {Iterable<unknown>} hostKeys
 * @param {Iterable<unknown>} [excludeHostKeys]
 */
export function countDistinctHosts(hostKeys, excludeHostKeys = []) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const key of hostKeys) {
    if (hostKeyIsExcluded(key, excludeHostKeys)) continue;
    const id = physicalHostId(key);
    if (id) set.add(id);
  }
  return set.size;
}

/**
 * @param {{
 *   distinctHostCount?: number | null;
 *   minHosts?: number;
 * }} input
 */
export function evaluateDualRunCapacity(input = {}) {
  const minHosts = Math.max(2, Number(input.minHosts ?? 2) || 2);
  const count = input.distinctHostCount;
  if (count == null || !Number.isFinite(Number(count))) {
    return {
      ok: null,
      reason: 'unknown',
      distinctHostCount: null,
      minHosts,
      message: 'Chưa kiểm tra được số host khả dụng trên marketplace.',
    };
  }
  const n = Number(count);
  if (n < minHosts) {
    return {
      ok: false,
      reason: 'insufficient_hosts',
      distinctHostCount: n,
      minHosts,
      message:
        'Chưa đủ 2 host khác nhau cùng loại GPU gói đang dùng. Không thể bật Render an toàn.',
    };
  }
  return {
    ok: true,
    reason: 'enough_hosts',
    distinctHostCount: n,
    minHosts,
    message: null,
  };
}

/**
 * Best-effort marketplace probe (Vast then Clore). Returns null on skip/error.
 *
 * @param {{
 *   gpuLine: string;
 *   planKey?: string | null;
 *   excludeHostKeys?: string[];
 *   limit?: number;
 * }} input
 * @returns {Promise<{ distinctHostCount: number; provider: string } | null>}
 */
export async function probeDualRunDistinctHostCount(input) {
  if (String(process.env.GPUVIETNAM_DUAL_RUN_SKIP_CAPACITY_PROBE ?? '').trim() === '1') {
    return null;
  }
  const gpuLine = String(input.gpuLine ?? '').trim();
  if (!gpuLine) return null;
  const planKey = input.planKey ?? null;
  const excludeHostKeys = input.excludeHostKeys ?? [];
  const limit = Math.max(5, Number(input.limit ?? 20) || 20);

  try {
    const { VastClient, findRankedGPUOffers } = await import(
      '../gpu/providers/vast/vast-client.js'
    );
    const { resolveVastHostKey } = await import(
      '../gpu/providers/vast/vast-bad-host-exclusion.js'
    );
    const vastConfigured = Boolean(
      (process.env.VAST_AI_KEY ?? process.env.VAST_API_KEY ?? '').trim(),
    );
    if (vastConfigured) {
      const client = new VastClient();
      const offers = await client.searchOffers(/** @type {any} */ (gpuLine));
      const ranked = findRankedGPUOffers(gpuLine, planKey, offers, limit);
      const keys = ranked.map((row) => {
        const offer =
          row && typeof row === 'object' && 'offer' in row && row.offer && typeof row.offer === 'object'
            ? row.offer
            : row?.raw && typeof row.raw === 'object'
              ? row.raw
              : null;
        return resolveVastHostKey(
          offer && typeof offer === 'object'
            ? /** @type {Record<string, unknown>} */ (offer)
            : null,
          gpuLine,
        );
      });
      const distinctHostCount = countDistinctHosts(keys, excludeHostKeys);
      return { distinctHostCount, provider: 'vast' };
    }
  } catch (error) {
    console.warn(
      '[dual-run-capacity] vast probe failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    const { CloreClient } = await import('../gpu/providers/clore/clore-client.js');
    const { resolveCloreHostKey } = await import('../gpu/host-reputation/index.js');
    const cloreConfigured = Boolean((process.env.CLORE_API_KEY ?? '').trim());
    if (cloreConfigured) {
      const client = new CloreClient();
      const ranked = await client.findRankedOffers(
        /** @type {any} */ (gpuLine),
        planKey,
        { maxCandidates: limit },
      );
      const keys = (Array.isArray(ranked) ? ranked : []).map((row) =>
        resolveCloreHostKey(
          row?.raw && typeof row.raw === 'object'
            ? /** @type {Record<string, unknown>} */ (row.raw)
            : null,
          row?.offerId ?? null,
          gpuLine,
        ),
      );
      const distinctHostCount = countDistinctHosts(keys, excludeHostKeys);
      return { distinctHostCount, provider: 'clore' };
    }
  } catch (error) {
    console.warn(
      '[dual-run-capacity] clore probe failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  return null;
}
