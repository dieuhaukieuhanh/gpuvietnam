import { GPUProviderError } from '../../gpu-errors.js';
import { DEFAULT_GPU_PORT } from '../../gpu-config.js';
import { normalizeVastInstanceRecord, resolveVastComfyPort } from './vast-mapper.js';
import { profStart, profEnd } from '../../../prof.js';

/**
 * Default timeout for ComfyUI HTTP calls. ComfyUI runs on a local GPU
 * instance and a healthy machine responds in well under a second. Node's
 * undici default connect timeout is 10s, which blocks every caller when a
 * machine is unreachable — notably /api/dashboard/me, which runs the destroy
 * pipeline and calls collectSessionMetrics on a leaked/dead machine. Fail
 * fast instead. Callers may pass their own init.signal to override.
 */
const COMFY_REQUEST_TIMEOUT_MS = 3000;

/**
 * Low-level HTTP client for ComfyUI on a running GPU instance.
 * No business logic — transport only.
 */
export class ComfyClient {
  /**
   * @param {string} endpointUrl Base URL e.g. http://host:8080
   */
  constructor(endpointUrl) {
    this.endpointUrl = endpointUrl.replace(/\/$/, '');
  }

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async request(path, init = {}) {
    const url = `${this.endpointUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const signal = init.signal ?? AbortSignal.timeout(COMFY_REQUEST_TIMEOUT_MS);

    const __prof = profStart(`ComfyUI ${path}`);
    let response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (error) {
      throw new GPUProviderError(`ComfyUI network error: ${error.message}`, {
        cause: error,
        retryable: true,
      });
    } finally {
      profEnd(__prof);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      throw new GPUProviderError(`ComfyUI ${response.status}: ${typeof payload === 'string' ? payload : response.statusText}`, {
        retryable: response.status >= 500,
      });
    }

    return payload;
  }

  async healthCheck() {
    return this.request('/');
  }

  /** @returns {Promise<{ running: number; pending: number }>} */
  async getQueue() {
    const payload = await this.request('/queue');
    const running = Array.isArray(payload?.queue_running) ? payload.queue_running.length : 0;
    const pending = Array.isArray(payload?.queue_pending) ? payload.queue_pending.length : 0;
    return { running, pending };
  }

  /**
   * @param {{ workflow: Record<string, unknown>; clientId?: string }} params
   */
  async submitWorkflow(params) {
    return this.request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.workflow,
        client_id: params.clientId,
      }),
    });
  }

  /** @param {string} jobId */
  async getHistory(jobId) {
    return this.request(`/history/${jobId}`);
  }

  /**
   * @param {string} filename
   * @param {Record<string, unknown>} workflow
   */
  async uploadWorkflow(filename, workflow) {
    return this.request('/upload/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, workflow }),
    });
  }

  /**
   * @param {string} jobId
   */
  async listOutputs(jobId) {
    const history = await this.getHistory(jobId);
    const entry = history?.[jobId] ?? history;
    const outputs = entry?.outputs ?? {};
    /** @type {{ id: string; filename: string; url?: string; mimeType?: string }[]} */
    const files = [];

    for (const nodeOutputs of Object.values(outputs)) {
      if (!nodeOutputs || typeof nodeOutputs !== 'object') continue;
      const images = /** @type {{ filename?: string; type?: string }[]} */ (nodeOutputs.images ?? []);
      for (const image of images) {
        if (!image?.filename) continue;
        files.push({
          id: image.filename,
          filename: image.filename,
          url: `${this.endpointUrl}/view?filename=${encodeURIComponent(image.filename)}`,
          mimeType: image.type === 'output' ? 'image/png' : undefined,
        });
      }
    }

    return files;
  }
}

/**
 * Build ComfyUI endpoint from Vast instance payload.
 * @param {Record<string, unknown>} vastInstance
 */
export function resolveComfyEndpoint(vastInstance) {
  const record = normalizeVastInstanceRecord(vastInstance);
  const publicIp =
    record.public_ipaddr ??
    record.public_ip ??
    (typeof record.ssh_host === 'string' ? record.ssh_host : undefined);

  if (!publicIp || typeof publicIp !== 'string') {
    return null;
  }

  const port = resolveVastComfyPort(record, DEFAULT_GPU_PORT);
  return `http://${publicIp}:${port}`;
}
