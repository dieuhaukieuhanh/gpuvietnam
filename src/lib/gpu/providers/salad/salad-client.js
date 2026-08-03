/**
 * SaladCloud GPU provider client — container-group lifecycle.
 *
 * Salad uses a container-group model (create + start → Salad allocates a node),
 * fundamentally different from the Vast/Clore marketplace model.
 * There is no walkRentCandidates / cancelOrphan — createInstance directly
 * manages the full lifecycle: create → start → poll running → provision gate.
 */

import { GPUConfigurationError, GPUProviderError } from '../../gpu-errors.js';
import { profStart, profEnd } from '../../../prof.js';
import {
  DEFAULT_GPU_IMAGE,
  DEFAULT_GPU_PORT,
  resolveGpuImage,
} from '../../gpu-config.js';
import {
  rememberHostFailure,
  rememberHostSuccess,
} from '../../host-reputation/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SALAD_API_BASE = 'https://api.salad.com/api/public';

/** @type {Record<string, string>} */
const SALAD_GPU_CLASS_NAME_TO_LINE = {};

// GPU line → Salad GPU class name tokens for reverse mapping after listGpuClasses.
const GPU_LINE_TOKENS = {
  rtx3090: ['rtx 3090', 'rtx3090'],       // 24 GB — not Ti
  'rtx4090_1x': ['rtx 4090', 'rtx4090'],   // 24 GB
  'rtx4090_2x': ['rtx 4090', 'rtx4090'],   // 24 GB
  'rtx5090_1x': ['rtx 5090', 'rtx5090'],   // 32 GB — not Laptop
};

/** Token that disqualifies a GPU class from matching (laptop, mobile variants). */
const DISQUALIFY_TOKENS = ['laptop', 'mobile', 'max-q', 'ti '];

const GPU_LINE_VRAM_MIN = {
  rtx3090: 24,
  'rtx4090_1x': 24,
  'rtx4090_2x': 24,
  'rtx5090_1x': 32,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} gpuLine
 * @returns {string[]}
 */
function gpuLineTokens(gpuLine) {
  return GPU_LINE_TOKENS[/** @type {keyof typeof GPU_LINE_TOKENS} */ (gpuLine)] || [];
}

/**
 * @param {string} gpuLine
 * @returns {number}
 */
function gpuLineVramMin(gpuLine) {
  return GPU_LINE_VRAM_MIN[/** @type {keyof typeof GPU_LINE_VRAM_MIN} */ (gpuLine)] || 24;
}

/**
 * Generate a valid Salad container group name (2-63 lowercase alphanumeric + hyphens).
 * @param {string} [userId]
 * @returns {string}
 */
export function generateSaladContainerGroupName(userId) {
  const safeUser = (userId || 'anon').replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 20);
  const shortId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `gv-${safeUser}-${shortId}`.slice(0, 63);
}

/**
 * Build a Salad host reputation key scoped to GPU class + country for
 * aggregate quality tracking (Salad nodes are ephemeral, so we score
 * the GPU-class/region combination rather than individual instances).
 * @param {string} gpuClassUuid
 * @param {string} [countryCode]
 * @returns {string}
 */
function buildSaladHostReputationKey(gpuClassUuid, countryCode) {
  const cc = (countryCode || 'global').toLowerCase().slice(0, 4);
  const short = gpuClassUuid.replace(/-/g, '').slice(0, 12);
  return `salad:${short}:${cc}`;
}

// ---------------------------------------------------------------------------
// SaladClient
// ---------------------------------------------------------------------------

export class SaladClient {
  /**
   * @param {{
   *   apiKey?: string | null;
   *   organization?: string | null;
   *   project?: string | null;
   *   priority?: string | null;
   * }} [options]
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.SALAD_API_KEY ?? null;
    this.organization = options.organization ?? process.env.SALAD_ORGANIZATION ?? null;
    this.project = options.project ?? process.env.SALAD_PROJECT ?? null;
    this.priority = options.priority ?? process.env.SALAD_PRIORITY ?? 'high';

    /** @type {string | null} */
    this._orgBaseUrl = null;

    /** @type {Map<string, string> | null} */
    this._gpuClassUuidCache = null;

    /** @type {Promise<Map<string, string>> | null} */
    this._gpuClassUuidPromise = null;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Base URL for organization-scoped endpoints.
   */
  _resolveOrgBaseUrl() {
    if (this._orgBaseUrl) return this._orgBaseUrl;
    if (!this.organization) {
      throw new GPUConfigurationError('SALAD_ORGANIZATION is not configured');
    }
    this._orgBaseUrl = `${SALAD_API_BASE}/organizations/${encodeURIComponent(this.organization)}`;
    return this._orgBaseUrl;
  }

  /**
   * Full URL for project-scoped container endpoints.
   */
  _resolveContainerBaseUrl() {
    if (!this.project) {
      throw new GPUConfigurationError('SALAD_PROJECT is not configured');
    }
    return `${this._resolveOrgBaseUrl()}/projects/${encodeURIComponent(this.project)}/containers`;
  }

  /**
   * Issue an authenticated request to the SaladCloud API.
   *
   * @param {'GET' | 'POST' | 'DELETE'} method
   * @param {string} url — full URL (org-scoped or container-scoped)
   * @param {Record<string, unknown> | undefined} [body]
   * @returns {Promise<unknown>}
   */
  async _request(method, url, body) {
    if (!this.apiKey) {
      throw new GPUConfigurationError('SALAD_API_KEY is not configured');
    }

    /** @type {Record<string, string>} */
    const headers = {
      Accept: 'application/json',
      'Salad-Api-Key': this.apiKey,
    };

    /** @type {RequestInit} */
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const label = `Salad ${method} ${url.replace(SALAD_API_BASE, '')}`;
    const __prof = profStart(label);
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      profEnd(__prof);
      throw new GPUProviderError(
        `SaladCloud network error: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, retryable: true },
      );
    } finally {
      // profEnd only on success path; already called on error above.
    }

    const text = await response.text();
    profEnd(__prof);

    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const status = response.status;
      const msg =
        payload && typeof payload === 'object' && 'message' in payload
          ? String(/** @type {Record<string,unknown>} */ (payload).message)
          : typeof payload === 'string'
            ? payload.slice(0, 300)
            : response.statusText;
      throw new GPUProviderError(`SaladCloud HTTP ${status}: ${msg}`, {
        retryable: status >= 500 || status === 429,
      });
    }

    return payload;
  }

  // -----------------------------------------------------------------------
  // GPU Class helpers
  // -----------------------------------------------------------------------

  /**
   * Fetch and cache GPU classes from SaladCloud.
   * @returns {Promise<Map<string, string>>} Map of gpuLine → saladGpuClassUuid
   */
  async _fetchGpuClassMap() {
    if (this._gpuClassUuidCache) return this._gpuClassUuidCache;
    if (this._gpuClassUuidPromise) return this._gpuClassUuidPromise;

    this._gpuClassUuidPromise = (async () => {
      try {
        // Check for explicit env-var mapping first.
        const envMap = (process.env.SALAD_GPU_CLASS_UUID_MAP ?? '').trim();
        if (envMap) {
          try {
            const parsed = JSON.parse(envMap);
            if (parsed && typeof parsed === 'object') {
              this._gpuClassUuidCache = new Map(Object.entries(parsed));
              return this._gpuClassUuidCache;
            }
          } catch {
            // Fall through to API discovery.
          }
        }

        const url = `${this._resolveOrgBaseUrl()}/gpu-classes`;
        /** @type {{ items?: Array<{ id: string; name: string; display_name?: string }> } | null} */
        const data = /** @type {any} */ (await this._request('GET', url));

        const map = new Map();
        const items = Array.isArray(data?.items) ? data.items : [];
        for (const item of items) {
          const name = String(item.name || '').toLowerCase();
          const display = String(item.display_name || '').toLowerCase();
          const combined = `${name} ${display}`;

          // Skip laptop/mobile variants.
          if (DISQUALIFY_TOKENS.some((t) => combined.includes(t))) continue;

          // Extract VRAM from name (e.g. "RTX 5090 (32 GB)" → 32).
          const vramMatch = combined.match(/\((\d+)\s*gb\)/i);
          const nameVramGb = vramMatch ? Number(vramMatch[1]) : 0;

          const gpuClassId = item.id;
          for (const [line, tokens] of Object.entries(GPU_LINE_TOKENS)) {
            if (tokens.some((t) => combined.includes(t.toLowerCase()))) {
              // VRAM gate: must meet minimum for this GPU line.
              const minVram = gpuLineVramMin(line);
              if (nameVramGb > 0 && nameVramGb < minVram) continue;

              // Only set if not already mapped (first match wins).
              if (!map.has(line)) {
                map.set(line, gpuClassId);
              }
              SALAD_GPU_CLASS_NAME_TO_LINE[gpuClassId] = line;
            }
          }
        }

        this._gpuClassUuidCache = map;
        return map;
      } catch (err) {
        this._gpuClassUuidPromise = null;
        throw err;
      }
    })();

    return this._gpuClassUuidPromise;
  }

  /**
   * Resolve a Salad GPU class UUID for an internal GPU line.
   * @param {string} gpuLine
   * @returns {Promise<string>}
   */
  async resolveGpuClassUuid(gpuLine) {
    const map = await this._fetchGpuClassMap();
    const uuid = map.get(gpuLine);
    if (uuid) return uuid;

    // Try fallback env var.
    const fallback = (process.env.SALAD_DEFAULT_GPU_CLASS_UUID ?? '').trim();
    if (fallback) return fallback;

    throw new GPUProviderError(
      `No Salad GPU class found for ${gpuLine}. Available: ${[...map.keys()].join(', ')}`,
      { retryable: false },
    );
  }

  // -----------------------------------------------------------------------
  // Public API methods
  // -----------------------------------------------------------------------

  /**
   * List available GPU classes from SaladCloud.
   * @returns {Promise<Array<{ id: string; name: string; gpuLine: string | null }>>}
   */
  async listGpuClasses() {
    const map = await this._fetchGpuClassMap();
    const result = [];
    for (const [gpuLine, uuid] of map.entries()) {
      result.push({ id: uuid, name: gpuLine, gpuLine });
    }
    return result;
  }

  /**
   * Create a container group (does NOT start it).
   * Salad returns current_state as an object: { status: "pending"|"running"|"stopped"|... }
   *
   * @param {{
   *   name: string;
   *   image: string;
   *   gpuClassUuid: string;
   *   port?: number;
   *   env?: Record<string, string>;
   *   diskSize?: number;
   *   countryCodes?: string[];
   * }} params
   * @returns {Promise<{ name: string; current_state: string; instances: unknown[]; networking?: { dns?: string; protocol?: string; port?: number } }>}
   */
  async createContainerGroup(params) {
    const port = params.port ?? DEFAULT_GPU_PORT;
    const env = {
      HOST: '::',              // IPv6 dual-stack required by Salad
      PORT: String(port),
      ...(params.env ?? {}),
    };

    const body = {
      name: params.name,
      display_name: params.name,
      container: {
        image: params.image,
        command: [],           // use image default CMD
        resources: {
          cpu: 8,
          memory: 32768,     // 32 GB RAM — max for consumer nodes
          gpu_classes: [params.gpuClassUuid],
          storage_amount: 53_687_091_200, // 50 GiB (Salad max)
          shm_size: 2048,    // 2 GB shared memory
        },
        priority: this.priority,
        environment_variables: env,
      },
      autostart_policy: false,  // we start manually after create
      restart_policy: 'never',
      replicas: 1,
      country_codes: params.countryCodes ?? undefined,
      networking: {
        protocol: 'http',
        port,
        auth: false,
        load_balancer: 'least_number_of_connections',
        client_request_timeout: 100_000,
        server_response_timeout: 100_000,
      },
    };

    const url = this._resolveContainerBaseUrl();
    const result = /** @type {any} */ (await this._request('POST', url, body));
    // Salad nests state: { current_state: { status: "pending" }, instances: [...] }
    const state =
      result.current_state && typeof result.current_state === 'object'
        ? String(result.current_state.status || 'preparing')
        : String(result.current_state || 'preparing');
    return {
      name: result.name,
      current_state: state,
      instances: Array.isArray(result.instances) ? result.instances : [],
      networking: result.networking,
    };
  }

  /**
   * Start a container group.
   * @param {string} name
   * @returns {Promise<{ current_state: string }>}
   */
  async startContainerGroup(name) {
    const url = `${this._resolveContainerBaseUrl()}/${encodeURIComponent(name)}/start`;
    return /** @type {any} */ (await this._request('POST', url));
  }

  /**
   * Stop a container group (best-effort before delete).
   * @param {string} name
   * @returns {Promise<{ current_state: string }>}
   */
  async stopContainerGroup(name) {
    const url = `${this._resolveContainerBaseUrl()}/${encodeURIComponent(name)}/stop`;
    try {
      return /** @type {any} */ (await this._request('POST', url));
    } catch (err) {
      // 404 = already gone — not an error.
      if (err instanceof GPUProviderError && /404/i.test(err.message)) {
        return { current_state: 'stopped' };
      }
      throw err;
    }
  }

  /**
   * Delete a container group.
   * @param {string} name
   * @returns {Promise<void>}
   */
  async deleteContainerGroup(name) {
    const url = `${this._resolveContainerBaseUrl()}/${encodeURIComponent(name)}`;
    try {
      await this._request('DELETE', url);
    } catch (err) {
      // 404 on delete = already gone — not an error.
      if (err instanceof GPUProviderError && /404/i.test(err.message)) {
        return;
      }
      throw err;
    }
  }

  /**
   * Get container group status including instances and networking info.
   *
   * @param {string} name
   * @returns {Promise<{
   *   name: string;
   *   current_state: string;
   *   instances: Array<{ id: string; state: string; machine_type?: string }>;
   *   networking?: { dns?: string; protocol?: string; port?: number };
   * }>}
   */
  async getContainerGroup(name) {
    const url = `${this._resolveContainerBaseUrl()}/${encodeURIComponent(name)}`;
    const result = /** @type {any} */ (await this._request('GET', url));
    // Salad nests state: { current_state: { status: "running" } }.
    const state =
      result.current_state && typeof result.current_state === 'object'
        ? String(result.current_state.status || 'unknown')
        : String(result.current_state || 'unknown');
    // Instance status counts give per-instance state.
    const instances = Array.isArray(result.instances) ? result.instances : [];
    return {
      name: result.name,
      current_state: state,
      instances,
      networking: result.networking,
    };
  }

  /**
   * Get organization quotas.
   * @returns {Promise<{ containerReplicasQuota: number; containerReplicasUsed: number }>}
   */
  async getQuotas() {
    const url = `${this._resolveOrgBaseUrl()}/quotas`;
    const result = /** @type {any} */ (await this._request('GET', url));
    // Salad nests under container_groups_quotas.
    const gq = result?.container_groups_quotas;
    return {
      containerReplicasQuota: gq?.container_replicas_quota ?? 0,
      containerReplicasUsed: gq?.container_replicas_used ?? 0,
    };
  }

  // -----------------------------------------------------------------------
  // Instance lifecycle (ProviderAdapter-facing)
  // -----------------------------------------------------------------------

  /**
   * Resolve the public endpoint URL for a container group.
   * Salad generates a random DNS name (e.g. yogurt-garden-xxx.salad.cloud).
   * Always prefer the networking.dns from the API response.
   *
   * @param {string} _name — unused, kept for API compatibility
   * @param {{ dns?: string; protocol?: string; port?: number }} [networking]
   * @returns {string | null}
   */
  resolveEndpointUrl(_name, networking) {
    if (networking?.dns) {
      const dns = networking.dns;
      // Already a full URL or just a hostname.
      if (/^https?:\/\//i.test(dns)) return dns.replace(/\/+$/, '');
      return `https://${dns}`;
    }
    return null;
  }

  /**
   * Create and start a Salad container, poll until running, run provision gate.
   *
   * @param {import('../../provider-abstraction/provider-interface.js').CreateMachineParams} params
   * @returns {Promise<import('../../domain/gpu-instance').GPUInstance>}
   */
  async createInstance(params) {
    // 1. Validate configuration
    if (!this.apiKey) {
      throw new GPUConfigurationError('Salad is not configured (missing SALAD_API_KEY)');
    }
    if (!this.organization) {
      throw new GPUConfigurationError('Salad is not configured (missing SALAD_ORGANIZATION)');
    }
    if (!this.project) {
      throw new GPUConfigurationError('Salad is not configured (missing SALAD_PROJECT)');
    }

    const gpuLine = params.gpuLine || 'rtx3090';
    // Salad uses slim images (consumer nodes can't extract 20GB full images).
    const saladImage =
      (process.env.SALAD_GPU_IMAGE ?? '').trim() ||
      resolveGpuImage(gpuLine);  // use v3.6/v4.3 — same as Vast/Clore
    const image = params.image ?? saladImage;
    const port = params.port ?? DEFAULT_GPU_PORT;

    // 2. Resolve GPU class UUID
    const gpuClassUuid = await this.resolveGpuClassUuid(gpuLine);

    // 3. Generate unique container group name
    const containerName = generateSaladContainerGroupName(params.label);

    // 4. Create container group → status "pending" (image pull/compress)
    const created = await this.createContainerGroup({
      name: containerName,
      image,
      gpuClassUuid,
      port,
      env: params.env,
      diskSize: params.diskSize,
    });
    console.info(`[salad/createInstance] Created container group ${containerName}, state=${created.current_state}`);

    // 5. Poll until NOT pending (Salad prepares image → "stopped" when ready to start)
    const prepareDeadline = Date.now() + 300_000;
    let lastState = created.current_state;
    /** @type {{ dns?: string; protocol?: string; port?: number } | undefined} */
    let networking = created.networking;
    while (lastState === 'pending' && Date.now() < prepareDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const group = await this.getContainerGroup(containerName);
      lastState = group.current_state;
      networking = group.networking;
      if (lastState !== 'pending') {
        console.info(`[salad/createInstance] Container ${containerName} prepared, state=${lastState}`);
      }
    }

    if (lastState === 'failed') {
      throw new GPUProviderError(
        `Salad container group ${containerName} failed during preparation`,
        { retryable: true },
      );
    }
    if (lastState === 'pending') {
      throw new GPUProviderError(
        `Salad container group ${containerName} still pending after 5min`,
        { retryable: true },
      );
    }

    // 6. Start container group → "deploying" → "running"
    await this.startContainerGroup(containerName);
    console.info(`[salad/createInstance] Started container group ${containerName}`);

    // 7. Poll until running (timeout: 5 minutes)
    const runDeadline = Date.now() + 300_000;
    while (Date.now() < runDeadline) {
      const group = await this.getContainerGroup(containerName);
      lastState = group.current_state;
      networking = group.networking;

      if (lastState === 'running') {
        console.info(`[salad/createInstance] Container group ${containerName} is running`);
        break;
      }
      if (lastState === 'failed') {
        throw new GPUProviderError(
          `Salad container group ${containerName} failed to start`,
          { retryable: true },
        );
      }

      if (lastState !== 'deploying') {
        console.info(`[salad/createInstance] Container ${containerName} state: ${lastState}, waiting...`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    if (lastState !== 'running') {
      throw new GPUProviderError(
        `Salad container group ${containerName} timed out after 10min (state=${lastState})`,
        { retryable: true },
      );
    }

    // 8. Resolve endpoint URL
    const endpointUrl = this.resolveEndpointUrl(containerName, networking);
    if (!endpointUrl) {
      throw new GPUProviderError(
        `Salad container group ${containerName} has no endpoint URL`,
        { retryable: true },
      );
    }

    // 8. Run provision gate (HTTP customer-path smoke test) — done by caller (adapter)
    //    We return the instance so the adapter can run the gate before marking ready.

    // Determine country from instances for reputation key.
    const instances = Array.isArray(networking ? undefined : undefined) ? [] : [];

    // Build build reputation key from GPU class (no country info in basic API response).
    const hostRepKey = buildSaladHostReputationKey(gpuClassUuid);

    // 9. Return GPUInstance
    return {
      id: containerName,
      providerId: 'salad',
      providerName: 'SaladCloud',
      gpuLine: /** @type {import('../../domain/gpu-instance').GPULine} */ (gpuLine),
      status: 'running',
      region: 'global',
      endpointUrl,
      metadata: {
        containerGroupName: containerName,
        gpuClassUuid,
        image,
        priority: this.priority,
        hostReputationKey: hostRepKey,
        networking,
      },
    };
  }

  /**
   * Destroy a Salad container group — stop then delete.
   * @param {string} instanceId — container group name
   * @returns {Promise<void>}
   */
  async destroyInstance(instanceId) {
    const name = String(instanceId ?? '').trim();
    if (!name) {
      throw new GPUProviderError('Salad destroy requires a container group name', {
        retryable: false,
      });
    }

    console.info(`[salad/destroyInstance] Destroying container group ${name}`);
    await this.stopContainerGroup(name);
    await this.deleteContainerGroup(name);
    console.info(`[salad/destroyInstance] Destroyed container group ${name}`);
  }
}
