/**
 * Clore marketplace probe for Admin Host Intelligence card.
 */

import {
  CloreClient,
  classifyCloreServerForLine,
  cloreServerAcceptsCurrency,
} from '../providers/clore/clore-client.js';
import { resolveCloreHostKey } from './index.js';
import {
  getHostIntelligenceBookSummaryForProvider,
  matchesHostIntelligenceProvider,
} from './host-intelligence-inventory.js';
import {
  isKnownGoodHost,
  listHostReputationRecords,
  loadHostReputationStoreAsync,
} from './index.js';

const CLORE_HOST_INTEL_GPU_LINES = ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'];

/**
 * @param {Record<string, number>} [targetPerLine]
 */
export async function getHostIntelligenceCloreAdminSummary(targetPerLine = {}) {
  await loadHostReputationStoreAsync();
  const base = getHostIntelligenceBookSummaryForProvider('clore');

  /** @type {Record<string, number>} */
  const availableByLine = {};
  /** @type {Record<string, number>} */
  const marketCandidateCountByLine = {};
  for (const line of CLORE_HOST_INTEL_GPU_LINES) {
    availableByLine[line] = 0;
    marketCandidateCountByLine[line] = 0;
  }

  const client = new CloreClient();
  let marketProbe = 'ok';
  /** @type {Set<string>} */
  const marketKeys = new Set();

  if (!client.isConfigured()) {
    marketProbe = 'skipped_no_clore_key';
  } else {
    try {
      const servers = await client.searchOffers();
      for (const line of CLORE_HOST_INTEL_GPU_LINES) {
        let count = 0;
        for (const server of servers) {
          if (!server || typeof server !== 'object') continue;
          const record = /** @type {Record<string, unknown>} */ (server);
          if (record.rented === true) continue;
          const classified = classifyCloreServerForLine(record, line);
          if (!classified) continue;
          if (!cloreServerAcceptsCurrency(record, client.currency)) continue;
          const hostKey = resolveCloreHostKey(record, record.id ?? record.server_id, line);
          if (!hostKey) continue;
          marketKeys.add(hostKey);
          count += 1;
        }
        marketCandidateCountByLine[line] = count;
      }
    } catch (err) {
      marketProbe = 'clore_marketplace_error';
      console.warn(
        '[host-intel-clore] market probe failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  if (marketProbe === 'ok') {
    for (const r of listHostReputationRecords()) {
      if (!matchesHostIntelligenceProvider(r, 'clore')) continue;
      if (!isKnownGoodHost(r)) continue;
      if (!marketKeys.has(r.hostKey)) continue;
      const line = r.gpuLine || 'unknown';
      if (availableByLine[line] != null) availableByLine[line] += 1;
    }
  }

  const availableTotal = Object.values(availableByLine).reduce((a, b) => a + b, 0);

  /** @type {Record<string, { available: number; inBook: number; target: number; ok: boolean }>} */
  const lines = {};
  for (const line of CLORE_HOST_INTEL_GPU_LINES) {
    const available = availableByLine[line] ?? 0;
    const inBook = base.knownGoodByLine?.[line] ?? 0;
    const target = Number(targetPerLine?.[line] ?? 4) || 0;
    lines[line] = {
      available,
      inBook,
      target,
      ok: available >= target,
    };
  }

  return {
    ...base,
    availableByLine,
    availableTotal,
    marketCandidateCountByLine,
    marketProbe,
    lines,
    probedAt: new Date().toISOString(),
    cronStatus: 'active',
    unsupportedLines: [],
  };
}
