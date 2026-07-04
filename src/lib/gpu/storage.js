import { DEFAULT_DISK_SIZE } from './gpu-config.js';
import { VastClient } from './providers/vast/vast-client.js';

const CACHE_TTL_MS = 15_000;
/** @type {Map<string, { at: number; value: unknown }>} */
const cache = new Map();

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function normalizeGb(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  if (num > 512) return round1(num / 1024);
  return round1(num);
}

/**
 * @param {string} ip
 * @param {number | string} [_port]
 * @param {{ instanceId?: string | null }} [options]
 */
export async function fetchStorageInfo(ip, _port, options = {}) {
  const cacheKey = `storage:${ip}:${options.instanceId ?? 'default'}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return cached.value;
  }

  let diskTotalGb = DEFAULT_DISK_SIZE;
  let diskUsedGb = 0;
  let source = 'default';

  if (options.instanceId) {
    try {
      const client = new VastClient();
      const raw = await client.getInstance(String(options.instanceId));
      const totalRaw = raw?.disk_space ?? raw?.dsize ?? raw?.disk_size ?? DEFAULT_DISK_SIZE;
      const usedRaw = raw?.disk_usage ?? raw?.disk_utilization ?? raw?.disk_used ?? 0;
      diskTotalGb = normalizeGb(totalRaw, DEFAULT_DISK_SIZE);
      diskUsedGb = Math.min(diskTotalGb, normalizeGb(usedRaw, 0));
      source = 'vast';
    } catch (error) {
      console.warn('[gpu/storage] Vast disk lookup failed:', error);
    }
  }

  const diskPercent = diskTotalGb > 0 ? Math.round((diskUsedGb / diskTotalGb) * 100) : 0;
  const result = {
    disk_used_gb: diskUsedGb,
    disk_total_gb: diskTotalGb,
    disk_percent: diskPercent,
    source,
  };

  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}
