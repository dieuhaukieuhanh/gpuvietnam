import {
  buildConsumerEndpoint,
  isEndpointReadyForTraffic,
  requireComfyUrlFromResolvedEndpoint,
} from '../endpoint-utils.js';
import { ComfyClient } from './providers/vast/comfy-client.js';
import { fetchStorageInfo } from './storage.js';
import { fetchCurrentWorkflow } from './workflow.js';

const CACHE_TTL_MS = 15_000;
/** @type {Map<string, { at: number; value: unknown }>} */
const cache = new Map();

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function cacheKey(type, ip, port, extra = '') {
  return `${type}:${ip}:${port}:${extra}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  cache.set(key, { at: Date.now(), value });
}

/**
 * @param {string} comfyUrl
 */
async function fetchGpuMetricsFromUrl(comfyUrl) {
  const key = cacheKey('gpu', comfyUrl, '');
  const cached = getCached(key);
  if (cached) return cached;

  const comfy = new ComfyClient(comfyUrl);
  const stats = await comfy.request('/system_stats');
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  const cudaDevice = devices.find((device) => device?.type === 'cuda') ?? devices[0];

  const vramTotalBytes = Number(cudaDevice?.vram_total ?? 0);
  const vramFreeBytes = Number(cudaDevice?.vram_free ?? 0);
  const vramUsedBytes = Math.max(0, vramTotalBytes - vramFreeBytes);

  let gpuUsagePercent = Number(cudaDevice?.gpu_utilization ?? cudaDevice?.utilization ?? NaN);
  if (!Number.isFinite(gpuUsagePercent) && vramTotalBytes > 0) {
    gpuUsagePercent = Math.round((vramUsedBytes / vramTotalBytes) * 100);
  }

  const temperatureRaw = cudaDevice?.temperature ?? cudaDevice?.gpu_temp ?? stats?.system?.gpu_temp;
  const temperature =
    temperatureRaw != null && Number.isFinite(Number(temperatureRaw)) ? Math.round(Number(temperatureRaw)) : null;

  const result = {
    vram_used_gb: round1(vramUsedBytes / 1024 ** 3),
    vram_total_gb: round1(vramTotalBytes / 1024 ** 3),
    vram_percent: vramTotalBytes > 0 ? Math.round((vramUsedBytes / vramTotalBytes) * 100) : 0,
    gpu_usage_percent: Number.isFinite(gpuUsagePercent) ? Math.round(gpuUsagePercent) : 0,
    temperature,
  };

  setCached(key, result);
  return result;
}

/**
 * @param {unknown} history
 * @param {string | null | undefined} sessionStartedAt
 */
function countHistoryOutputs(history, sessionStartedAt) {
  const sessionStartMs = sessionStartedAt ? new Date(sessionStartedAt).getTime() : 0;
  let count = 0;

  for (const entry of Object.values(history ?? {})) {
    if (!entry || typeof entry !== 'object') continue;

    if (sessionStartMs > 0) {
      const messages = entry?.status?.messages;
      const lastMessage = Array.isArray(messages) ? messages[messages.length - 1] : null;
      const timestamp = Array.isArray(lastMessage) ? Number(lastMessage[1]?.timestamp ?? 0) : 0;
      if (timestamp > 0 && timestamp < sessionStartMs) continue;
    }

    const outputs = entry?.outputs ?? {};
    for (const nodeOutput of Object.values(outputs)) {
      if (!nodeOutput || typeof nodeOutput !== 'object') continue;
      count += Array.isArray(nodeOutput.images) ? nodeOutput.images.length : 0;
    }
  }

  return count;
}

/**
 * @param {string} ip
 * @param {number | string} port
 */
export async function fetchGpuMetrics(ip, port) {
  return fetchGpuMetricsFromUrl(requireComfyUrlFromResolvedEndpoint(ip, port));
}

/**
 * @param {string} comfyUrl
 * @param {string | null | undefined} [sessionStartedAt]
 */
async function fetchOutputCountFromUrl(comfyUrl, sessionStartedAt) {
  const key = cacheKey('output', comfyUrl, sessionStartedAt ?? 'all');
  const cached = getCached(key);
  if (cached) return cached;

  const comfy = new ComfyClient(comfyUrl);
  const history = await comfy.request('/history');
  const result = { output_count: countHistoryOutputs(history, sessionStartedAt) };

  setCached(key, result);
  return result;
}

/**
 * @param {string} ip
 * @param {number | string} port
 * @param {string | null | undefined} [sessionStartedAt]
 */
export async function fetchOutputCount(ip, port, sessionStartedAt) {
  return fetchOutputCountFromUrl(
    requireComfyUrlFromResolvedEndpoint(ip, port),
    sessionStartedAt,
  );
}

/**
 * @param {string} comfyUrl
 * @param {number} [limit]
 */
async function fetchRecentOutputImagesFromUrl(comfyUrl, limit = 6) {
  const key = cacheKey('recent-images', comfyUrl, String(limit));
  const cached = getCached(key);
  if (cached) return cached;

  const endpoint = comfyUrl;
  const comfy = new ComfyClient(endpoint);
  const history = await comfy.request('/history');

  const entries = Object.entries(history ?? {}).map(([id, entry]) => {
    const messages = entry?.status?.messages;
    const lastMessage = Array.isArray(messages) ? messages[messages.length - 1] : null;
    const timestamp = Array.isArray(lastMessage) ? Number(lastMessage[1]?.timestamp ?? 0) : 0;
    return { id, entry, timestamp };
  });

  entries.sort((a, b) => b.timestamp - a.timestamp);

  /** @type {{ id: string; filename: string; url: string }[]} */
  const items = [];

  for (const { entry } of entries) {
    const outputs = entry?.outputs ?? {};
    for (const nodeOutput of Object.values(outputs)) {
      if (!nodeOutput || typeof nodeOutput !== 'object') continue;
      const images = Array.isArray(nodeOutput.images) ? nodeOutput.images : [];
      for (const image of images) {
        if (!image?.filename) continue;
        const type = image.type ?? 'output';
        const params = new URLSearchParams({
          filename: String(image.filename),
          type: String(type),
        });
        if (image.subfolder) {
          params.set('subfolder', String(image.subfolder));
        }
        items.push({
          id: `${image.filename}-${items.length}`,
          filename: String(image.filename),
          url: `${endpoint}/view?${params.toString()}`,
        });
        if (items.length >= limit) {
          setCached(key, items);
          return items;
        }
      }
    }
  }

  setCached(key, items);
  return items;
}

/**
 * @param {string} ip
 * @param {number | string} port
 * @param {number} [limit]
 */
export async function fetchRecentOutputImages(ip, port, limit = 6) {
  return fetchRecentOutputImagesFromUrl(
    requireComfyUrlFromResolvedEndpoint(ip, port),
    limit,
  );
}

/**
 * @param {{
 *   machine: Record<string, unknown>;
 *   healthOk?: boolean;
 *   instanceId?: string | null;
 *   sessionStartedAt?: string | null;
 * }} params
 */
export async function fetchLiveMetrics(params) {
  const { machine, healthOk = false, instanceId, sessionStartedAt } = params;

  if (!machine || !isEndpointReadyForTraffic(machine, healthOk)) {
    return null;
  }

  const { ip, port, comfyUrl } = buildConsumerEndpoint(machine, healthOk);
  if (!ip || port == null || !comfyUrl) {
    return null;
  }

  const [gpuMetrics, outputCount, storageInfo, workflowInfo] = await Promise.all([
    fetchGpuMetricsFromUrl(comfyUrl).catch(() => null),
    fetchOutputCountFromUrl(comfyUrl, sessionStartedAt).catch(() => ({ output_count: 0 })),
    fetchStorageInfo(ip, port, { instanceId }).catch(() => null),
    fetchCurrentWorkflow(comfyUrl).catch(() => ({
      model: null,
      loras: [],
      current_model: null,
    })),
  ]);

  return {
    vram: gpuMetrics
      ? {
          used_gb: gpuMetrics.vram_used_gb,
          total_gb: gpuMetrics.vram_total_gb,
          percent: gpuMetrics.vram_percent,
        }
      : null,
    gpu_usage_percent: gpuMetrics?.gpu_usage_percent ?? null,
    temperature: gpuMetrics?.temperature ?? null,
    disk: storageInfo
      ? {
          used_gb: storageInfo.disk_used_gb,
          total_gb: storageInfo.disk_total_gb,
          percent: storageInfo.disk_percent,
        }
      : null,
    current_model: workflowInfo?.current_model ?? workflowInfo?.model ?? null,
    loras: workflowInfo?.loras ?? [],
    output_count: outputCount?.output_count ?? 0,
  };
}
