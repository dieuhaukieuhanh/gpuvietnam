/**
 * Clore TTL bad-host exclusion (30 days) + permanent country block (UA/IR).
 * Shared DB table provider_bad_hosts.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLORE_BAD_HOST } from '../../gpu-config.js';
import {
  filterOffersByBlockedRegions,
  isMarketplaceRegionPermanentlyBlocked,
  isOfferRegionBlocked,
} from '../../blocked-regions.js';
import {
  rememberHostFailure,
  resolveCloreHostKey,
  withGpuLine,
} from '../../host-reputation/index.js';

/** @typedef {{ hostKey: string; reason: string; excludedAt: number; expiresAt: number; offerId?: string|null; instanceId?: string|null }} BadHostEntry */

/** @type {Map<string, BadHostEntry>} */
const memory = new Map();
let loadedFromDisk = false;

function exclusionFilePath() {
  const rel = CLORE_BAD_HOST.badHostExclusionFile || 'tmp/clore-bad-hosts.json';
  return join(process.cwd(), rel);
}

/** Default / category TTL — Clore uses a flat 30-day window. */
function ttlMsForReason(reasonCategory, reasonText) {
  const table = CLORE_BAD_HOST.badHostTtlByReasonMs || {};
  const fallback = Number(CLORE_BAD_HOST.badHostExclusionTtlMs);
  const defaultTtl =
    Number.isFinite(fallback) && fallback > 0 ? fallback : 30 * 24 * 60 * 60 * 1000;
  const cat = String(reasonCategory || '').trim();
  if (cat && Number.isFinite(table[cat]) && table[cat] > 0) return table[cat];
  const text = String(reasonText || '').toLowerCase();
  if (/ssh|exec/.test(text) && Number.isFinite(table.ssh_exec)) return table.ssh_exec;
  if (/http_endpoint/.test(text) && Number.isFinite(table.http_endpoint)) return table.http_endpoint;
  if (/port|endpoint|mapped/.test(text) && Number.isFinite(table.port)) return table.port;
  if (/gpu_stats/.test(text) && Number.isFinite(table.gpu_stats)) return table.gpu_stats;
  if (/nvidia|smi|gpu name|vram/.test(text) && Number.isFinite(table.nvidia_smi)) {
    return table.nvidia_smi;
  }
  if (/cuda/.test(text) && Number.isFinite(table.cuda)) return table.cuda;
  if (/comfy_smoke/.test(text) && Number.isFinite(table.comfy_smoke)) return table.comfy_smoke;
  if (/comfy|workflow|system_stats/.test(text) && Number.isFinite(table.comfy_workflow)) {
    return table.comfy_workflow;
  }
  if (Number.isFinite(table.default) && table.default > 0) return table.default;
  return defaultTtl;
}

/** @deprecated Use isMarketplaceRegionPermanentlyBlocked */
export const isCloreRegionPermanentlyBlocked = isMarketplaceRegionPermanentlyBlocked;

/** @deprecated Use isOfferRegionBlocked */
export const isCloreOfferRegionBlocked = isOfferRegionBlocked;

function pruneExpired(now = Date.now()) {
  for (const [key, entry] of memory.entries()) {
    if (!entry || entry.expiresAt <= now) memory.delete(key);
  }
}

function loadFromDiskIfNeeded() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  try {
    const file = exclusionFilePath();
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const entries = Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw) ? raw : [];
    const now = Date.now();
    for (const row of entries) {
      if (!row || typeof row !== 'object') continue;
      const hostKey = String(row.hostKey ?? '').trim();
      const expiresAt = Number(row.expiresAt);
      if (!hostKey || !(expiresAt > now)) continue;
      memory.set(hostKey, {
        hostKey,
        reason: String(row.reason ?? 'bad_host'),
        excludedAt: Number(row.excludedAt) || now,
        expiresAt,
        offerId: row.offerId != null ? String(row.offerId) : null,
        instanceId: row.instanceId != null ? String(row.instanceId) : null,
      });
    }
  } catch (error) {
    console.warn(
      '[clore/bad-host-exclusion] load failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

function persistToDisk() {
  try {
    pruneExpired();
    const file = exclusionFilePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          entries: Array.from(memory.values()),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (error) {
    console.warn(
      '[clore/bad-host-exclusion] persist failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * @param {string} hostKey
 * @param {{
 *   reason?: string;
 *   reasonCategory?: string | null;
 *   offerId?: string|null;
 *   instanceId?: string|null;
 *   now?: number;
 *   gpuLine?: string|null;
 * }} [meta]
 */
export function rememberCloreBadHost(hostKey, meta = {}) {
  const key = String(hostKey ?? '').trim().split('|')[0];
  if (!key) return null;
  loadFromDiskIfNeeded();
  const now = meta.now ?? Date.now();
  const ttl = ttlMsForReason(meta.reasonCategory, meta.reason);
  /** @type {BadHostEntry} */
  const entry = {
    hostKey: key,
    reason: String(meta.reason ?? 'post_rent_gate_failed'),
    excludedAt: now,
    expiresAt: now + ttl,
    offerId: meta.offerId != null ? String(meta.offerId) : null,
    instanceId: meta.instanceId != null ? String(meta.instanceId) : null,
  };
  memory.set(key, entry);
  persistToDisk();
  console.warn('[clore/bad-host-exclusion] remembered', {
    hostKey: key,
    reason: entry.reason,
    reasonCategory: meta.reasonCategory ?? null,
    ttlMs: ttl,
    expiresAt: new Date(entry.expiresAt).toISOString(),
  });
  try {
    const repKey = withGpuLine(key, meta.gpuLine) || key;
    rememberHostFailure(repKey, {
      reason: entry.reason,
      phase: 'post_rent_gate',
      gpuLine: meta.gpuLine != null ? String(meta.gpuLine) : null,
      now,
    });
  } catch {
    /* ignore */
  }
  void persistCloreBadHostToDb(entry, meta.reasonCategory).catch(() => undefined);
  return entry;
}

/**
 * @param {BadHostEntry} entry
 * @param {string | null | undefined} reasonCategory
 */
async function persistCloreBadHostToDb(entry, reasonCategory) {
  try {
    const { getSupabaseAdmin } = await import('../../../supabase-admin.js');
    const sb = getSupabaseAdmin();
    const { error } = await sb.from('provider_bad_hosts').upsert(
      {
        host_key: entry.hostKey,
        provider: 'clore',
        reason: entry.reason,
        reason_category: reasonCategory || null,
        offer_id: entry.offerId,
        instance_id: entry.instanceId,
        excluded_at: new Date(entry.excludedAt).toISOString(),
        expires_at: new Date(entry.expiresAt).toISOString(),
        metadata: {},
      },
      { onConflict: 'host_key' },
    );
    if (error && !/does not exist|schema cache|Could not find/i.test(error.message || '')) {
      console.warn('[clore/bad-host-exclusion] db upsert failed:', error.message);
    }
  } catch (err) {
    if (!/does not exist|schema cache/i.test(String(err instanceof Error ? err.message : err))) {
      console.warn(
        '[clore/bad-host-exclusion] db write skipped:',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * @param {string | null | undefined} hostKey
 * @param {number} [now]
 */
export function isCloreHostExcluded(hostKey, now = Date.now()) {
  const key = String(hostKey ?? '').trim().split('|')[0];
  if (!key) return false;
  const at = Number(now);
  const ts = Number.isFinite(at) && at > 0 ? at : Date.now();
  loadFromDiskIfNeeded();
  pruneExpired(ts);
  const entry = memory.get(key);
  return Boolean(entry && Number(entry.expiresAt) > ts);
}

/**
 * Drop Ukraine / Iran permanently (before rent / ranking).
 * @param {import('../../offer-selection.js').NormalizedOffer[]} offers
 */
export function filterCloreOffersByBlockedRegions(offers) {
  return filterOffersByBlockedRegions(offers, 'clore');
}

/**
 * @param {import('../../offer-selection.js').NormalizedOffer[]} offers
 * @param {string | null | undefined} [gpuLine]
 */
export function filterCloreOffersByBadHostExclusion(offers, gpuLine = null) {
  loadFromDiskIfNeeded();
  pruneExpired();
  const regionFiltered = filterCloreOffersByBlockedRegions(offers);
  let droppedExcludedHost = 0;
  /** @type {import('../../offer-selection.js').NormalizedOffer[]} */
  const kept = [];
  for (const offer of regionFiltered.offers) {
    const raw = offer.raw && typeof offer.raw === 'object' ? offer.raw : null;
    const hostKey = resolveCloreHostKey(
      /** @type {Record<string, unknown>} */ (raw),
      offer.offerId,
      gpuLine,
    );
    if (hostKey && isCloreHostExcluded(hostKey)) {
      droppedExcludedHost += 1;
      continue;
    }
    kept.push(offer);
  }
  if (droppedExcludedHost > 0 || regionFiltered.droppedBlockedRegion > 0) {
    console.info('[clore/bad-host-exclusion] filtered', {
      input: offers.length,
      kept: kept.length,
      droppedBlockedRegion: regionFiltered.droppedBlockedRegion,
      droppedExcludedHost,
    });
  }
  return {
    offers: kept,
    droppedExcludedHost,
    droppedBlockedRegion: regionFiltered.droppedBlockedRegion,
  };
}

/** Test helper */
export function resetCloreBadHostExclusionForTests() {
  memory.clear();
  loadedFromDisk = true;
}
