/**
 * Comfy Adapter — RuntimePort implementation for ComfyUI (B1.5).
 * Spec: docs/architecture/RuntimePort.md · docs/architecture/B1_5_COMFY_ADAPTER.md
 *
 * Control Plane must import this factory and call Port methods only.
 * Comfy HTTP dialect (/prompt, /history, /view, /system_stats) stays inside this module.
 */

import { randomUUID } from 'node:crypto';
import { ComfyClient } from '../gpu/providers/vast/comfy-client.js';
import { GPUProviderError } from '../gpu/gpu-errors.js';
import {
  evaluateImageSpecParity,
  inferImageSpecRefFromDockerImage,
  resolveImageSpecRefForGpuLine,
} from './runtime-image-spec.js';
import {
  RuntimePortError,
  assertRuntimePort,
  validateCreateParams,
  validateSubmitParams,
} from './runtime-port.js';
import {
  buildAttemptOutputKey,
  buildManifestEntry,
  buildResultManifest,
} from './storage-paths.js';

/**
 * @typedef {import('./runtime-port.js').RuntimePort} RuntimePort
 * @typedef {import('./runtime-port.js').RuntimePortCreateParams} RuntimePortCreateParams
 * @typedef {import('./runtime-port.js').RuntimePortSubmitParams} RuntimePortSubmitParams
 * @typedef {import('./runtime-port.js').RuntimePortMonitorParams} RuntimePortMonitorParams
 * @typedef {import('./runtime-port.js').RuntimePortFetchParams} RuntimePortFetchParams
 * @typedef {import('./runtime-port.js').RuntimePortDestroyParams} RuntimePortDestroyParams
 */

/**
 * @typedef {object} ComfyAdapterRuntimeRecord
 * @property {string} runtimeId
 * @property {string} userId
 * @property {string} attemptId
 * @property {string} jobId
 * @property {string} imageSpecRef
 * @property {string} endpointUrl
 * @property {string | null} machineId
 * @property {string | null} provider
 * @property {'ready' | 'provisioning' | 'starting' | 'destroyed' | 'error'} status
 * @property {string | null} externalExecutionId
 * @property {number} attemptNumber
 */

/**
 * @param {unknown} err
 * @param {string} fallbackCode
 * @returns {RuntimePortError}
 */
function mapComfyError(err, fallbackCode = 'UNAVAILABLE') {
  if (err instanceof RuntimePortError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const retryable =
    (err instanceof GPUProviderError && Boolean(err.retryable)) ||
    /timeout|network|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message);
  let code = fallbackCode;
  if (/not ready|proxy is starting/i.test(message)) code = 'RUNTIME_NOT_READY';
  else if (retryable) code = 'UNAVAILABLE';
  return new RuntimePortError(code, message, {
    retryable,
    cause: err,
  });
}

/**
 * @param {unknown} historyPayload
 * @param {string} promptId
 */
function interpretHistoryStatus(historyPayload, promptId) {
  if (!historyPayload || typeof historyPayload !== 'object') {
    return { status: /** @type {const} */ ('queued') };
  }
  const root = /** @type {Record<string, unknown>} */ (historyPayload);
  const entry = root[promptId] ?? (root.outputs || root.status ? root : null);
  if (!entry || typeof entry !== 'object') {
    return { status: /** @type {const} */ ('queued') };
  }
  const rec = /** @type {Record<string, unknown>} */ (entry);
  const status = rec.status && typeof rec.status === 'object'
    ? /** @type {Record<string, unknown>} */ (rec.status)
    : null;
  const statusStr = status?.status_str;
  const failed =
    (Array.isArray(statusStr) && statusStr.some((s) => String(s).includes('error'))) ||
    String(statusStr ?? '').toLowerCase().includes('error') ||
    status?.completed === false && Boolean(status?.messages);

  if (failed) {
    return {
      status: /** @type {const} */ ('failed'),
      errorMessage: String(statusStr ?? 'Comfy execution failed'),
    };
  }
  // Presence in /history means finished for typical ComfyUI.
  if (rec.outputs || status?.completed === true || statusStr) {
    return { status: /** @type {const} */ ('succeeded') };
  }
  return { status: /** @type {const} */ ('running') };
}

/**
 * Create a RuntimePort backed by ComfyUI.
 *
 * B1.5: `create` expects `metadata.endpointUrl` (or `provisionRuntime` dep for 1.6).
 *
 * @param {{
 *   createComfyClient?: (endpointUrl: string) => ComfyClient;
 *   provisionRuntime?: (params: RuntimePortCreateParams) => Promise<{
 *     endpointUrl: string;
 *     runtimeId?: string;
 *     machineId?: string | null;
 *     provider?: string | null;
 *     imageSpecRef?: string;
 *     status?: 'ready' | 'provisioning' | 'starting';
 *   }>;
 *   releaseCompute?: (runtime: ComfyAdapterRuntimeRecord, params: RuntimePortDestroyParams) => Promise<void>;
 *   putObject?: (args: { key: string; body: Buffer | Uint8Array; contentType?: string }) => Promise<string>;
 *   downloadView?: (endpointUrl: string, filename: string, fileType?: string) => Promise<Buffer>;
 *   evaluateParity?: typeof evaluateImageSpecParity;
 *   idFactory?: () => string;
 *   defaultAttemptNumber?: number;
 * }} [deps]
 * @returns {RuntimePort & { _debug: { runtimes: Map<string, ComfyAdapterRuntimeRecord> } }}
 */
export function createComfyRuntimePort(deps = {}) {
  const createComfyClient =
    deps.createComfyClient ?? ((url) => new ComfyClient(url));
  const evaluateParity = deps.evaluateParity ?? evaluateImageSpecParity;
  const idFactory = deps.idFactory ?? (() => randomUUID());
  const defaultAttemptNumber = Number(deps.defaultAttemptNumber) > 0
    ? Number(deps.defaultAttemptNumber)
    : 1;

  /** @type {Map<string, ComfyAdapterRuntimeRecord>} */
  const runtimes = new Map();

  /**
   * @param {string} endpointUrl
   * @param {string} filename
   * @param {string} [fileType]
   */
  async function downloadView(endpointUrl, filename, fileType = 'output') {
    if (typeof deps.downloadView === 'function') {
      return deps.downloadView(endpointUrl, filename, fileType);
    }
    const base = endpointUrl.replace(/\/$/, '');
    const qs = new URLSearchParams({
      filename,
      type: fileType || 'output',
    });
    const url = `${base}/view?${qs.toString()}`;
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw mapComfyError(error, 'FETCH_FAILED');
    }
    if (!response.ok) {
      throw new RuntimePortError(
        'FETCH_FAILED',
        `Comfy /view ${response.status} for ${filename}`,
        { retryable: response.status >= 500 },
      );
    }
    const ab = await response.arrayBuffer();
    return Buffer.from(ab);
  }

  /**
   * @param {string} runtimeId
   * @returns {ComfyAdapterRuntimeRecord}
   */
  function requireRuntime(runtimeId) {
    const rt = runtimes.get(String(runtimeId ?? ''));
    if (!rt) {
      throw new RuntimePortError('UNKNOWN_RUNTIME', `Unknown runtimeId: ${runtimeId}`);
    }
    if (rt.status === 'destroyed') {
      throw new RuntimePortError('UNKNOWN_RUNTIME', `Runtime already destroyed: ${runtimeId}`);
    }
    return rt;
  }

  /** @type {RuntimePort} */
  const port = {
    async create(params) {
      try {
        validateCreateParams(params);
        const meta = params.metadata && typeof params.metadata === 'object'
          ? /** @type {Record<string, unknown>} */ (params.metadata)
          : {};

        let endpointUrl = String(meta.endpointUrl ?? meta.endpoint_url ?? '').trim();
        let machineId = meta.machineId != null ? String(meta.machineId) : null;
        let provider = meta.provider != null ? String(meta.provider) : 'comfy';
        let runtimeId = String(params.runtimeId ?? meta.runtimeId ?? '').trim() || idFactory();
        let status = /** @type {ComfyAdapterRuntimeRecord['status']} */ ('ready');

        let imageSpecRef =
          String(meta.imageSpecRef ?? meta.image_spec_ref ?? '').trim() ||
          inferImageSpecRefFromDockerImage(String(meta.image ?? '')) ||
          resolveImageSpecRefForGpuLine(params.gpuLine);

        if (!endpointUrl && typeof deps.provisionRuntime === 'function') {
          const provisioned = await deps.provisionRuntime(params);
          endpointUrl = String(provisioned.endpointUrl ?? '').trim();
          runtimeId = String(provisioned.runtimeId ?? runtimeId).trim();
          machineId = provisioned.machineId != null ? String(provisioned.machineId) : machineId;
          provider = provisioned.provider != null ? String(provisioned.provider) : provider;
          if (provisioned.imageSpecRef) imageSpecRef = String(provisioned.imageSpecRef);
          if (provisioned.status) status = provisioned.status;
        }

        if (!endpointUrl) {
          throw new RuntimePortError(
            'INVALID_ARGUMENT',
            'create requires metadata.endpointUrl (or provisionRuntime dep — see 1.6)',
          );
        }

        const parity = evaluateParity({
          requiredSpecId: params.requiredImageSpecRef,
          runtimeSpecId: imageSpecRef,
        });
        if (!parity.ok) {
          throw new RuntimePortError('PARITY_FAILED', parity.missing.reason || 'Image Spec parity failed', {
            details: { missing: parity.missing, code: parity.code },
          });
        }

        if (status === 'ready') {
          const client = createComfyClient(endpointUrl);
          try {
            const health = await client.healthCheck();
            if (!ComfyClient.isReadyPayload(health)) {
              status = 'starting';
            }
          } catch (error) {
            throw mapComfyError(error, 'RUNTIME_NOT_READY');
          }
        }

        const attemptNumber = Number(meta.attemptNumber ?? meta.attempt_number) > 0
          ? Number(meta.attemptNumber ?? meta.attempt_number)
          : defaultAttemptNumber;

        /** @type {ComfyAdapterRuntimeRecord} */
        const record = {
          runtimeId,
          userId: String(params.userId),
          attemptId: String(params.attemptId),
          jobId: String(params.jobId),
          imageSpecRef,
          endpointUrl: endpointUrl.replace(/\/$/, ''),
          machineId,
          provider,
          status: status === 'ready' ? 'ready' : status,
          externalExecutionId: null,
          attemptNumber,
        };
        runtimes.set(runtimeId, record);

        return {
          runtimeId,
          endpointUrl: record.endpointUrl,
          imageSpecRef,
          status: record.status === 'ready' ? 'ready' : /** @type {'provisioning' | 'starting'} */ (record.status),
          machineId,
          provider,
        };
      } catch (error) {
        throw mapComfyError(error, 'UNAVAILABLE');
      }
    },

    async submit(params) {
      try {
        validateSubmitParams(params);
        const rt = requireRuntime(params.runtimeId);
        if (rt.status !== 'ready') {
          throw new RuntimePortError(
            'RUNTIME_NOT_READY',
            `Runtime status is ${rt.status}`,
          );
        }

        const parity = evaluateParity({
          requiredSpecId: params.imageSpecRef,
          runtimeSpecId: rt.imageSpecRef,
        });
        if (!parity.ok) {
          throw new RuntimePortError('PARITY_FAILED', parity.missing.reason || 'parity failed', {
            details: { missing: parity.missing },
          });
        }

        const client = createComfyClient(rt.endpointUrl);
        const clientId =
          String(params.clientId ?? '').trim() ||
          `cp-${params.attemptId}`.slice(0, 64);

        let response;
        try {
          response = await client.submitWorkflow({
            workflow: params.workflowSnapshot,
            clientId,
          });
        } catch (error) {
          throw mapComfyError(error, 'SUBMIT_REJECTED');
        }

        const promptId = String(
          response?.prompt_id ?? response?.promptId ?? response?.number ?? '',
        ).trim();
        if (!promptId) {
          throw new RuntimePortError(
            'SUBMIT_REJECTED',
            'Comfy submit returned no prompt_id',
            { details: { response } },
          );
        }

        rt.externalExecutionId = promptId;
        return {
          externalExecutionId: promptId,
          status: 'queued',
        };
      } catch (error) {
        throw mapComfyError(error, 'SUBMIT_REJECTED');
      }
    },

    async monitor(params) {
      try {
        const runtimeId = String(params?.runtimeId ?? '').trim();
        const externalExecutionId = String(params?.externalExecutionId ?? '').trim();
        if (!runtimeId || !externalExecutionId) {
          throw new RuntimePortError(
            'INVALID_ARGUMENT',
            'monitor requires runtimeId and externalExecutionId',
          );
        }
        const rt = requireRuntime(runtimeId);
        const client = createComfyClient(rt.endpointUrl);

        try {
          const queue = await client.getQueue();
          const history = await client.getHistory(externalExecutionId);
          const interpreted = interpretHistoryStatus(history, externalExecutionId);
          if (interpreted.status === 'queued' || interpreted.status === 'running') {
            const inFlight = (queue.running ?? 0) + (queue.pending ?? 0) > 0;
            return {
              status: interpreted.status === 'queued' && !inFlight ? 'running' : interpreted.status,
              progress: { queue },
              errorMessage: null,
            };
          }
          return {
            status: interpreted.status,
            errorMessage: interpreted.errorMessage ?? null,
          };
        } catch (error) {
          const mapped = mapComfyError(error, 'EXECUTION_LOST');
          if (mapped.retryable || mapped.code === 'UNAVAILABLE' || mapped.code === 'RUNTIME_NOT_READY') {
            return {
              status: 'lost',
              errorMessage: mapped.message,
            };
          }
          throw mapped;
        }
      } catch (error) {
        throw mapComfyError(error, 'UNAVAILABLE');
      }
    },

    async fetch(params) {
      try {
        const runtimeId = String(params?.runtimeId ?? '').trim();
        const jobId = String(params?.jobId ?? '').trim();
        const attemptId = String(params?.attemptId ?? '').trim();
        const userId = String(params?.userId ?? '').trim();
        const externalExecutionId = String(params?.externalExecutionId ?? '').trim();
        if (!runtimeId || !jobId || !attemptId || !userId || !externalExecutionId) {
          throw new RuntimePortError(
            'INVALID_ARGUMENT',
            'fetch requires runtimeId, jobId, attemptId, userId, externalExecutionId',
          );
        }

        const rt = requireRuntime(runtimeId);
        const client = createComfyClient(rt.endpointUrl);

        /** @type {{ id: string; filename: string; url?: string; mimeType?: string }[]} */
        let files;
        try {
          files = await client.listOutputs(externalExecutionId);
        } catch (error) {
          throw mapComfyError(error, 'FETCH_FAILED');
        }

        const putObject =
          deps.putObject ??
          (async ({ key }) => key);

        /** @type {object[]} */
        const outputs = [];
        for (const file of files) {
          const filename = String(file.filename || file.id || '').trim();
          if (!filename) continue;
          const body = await downloadView(rt.endpointUrl, filename, 'output');
          const key = buildAttemptOutputKey(
            userId,
            jobId,
            rt.attemptNumber,
            filename.replace(/[^a-zA-Z0-9._-]/g, '_'),
          );
          await putObject({
            key,
            body,
            contentType: file.mimeType || 'image/png',
          });
          outputs.push(
            buildManifestEntry({
              kind: 'output',
              r2Key: key,
              filename: filename.replace(/[^a-zA-Z0-9._-]/g, '_'),
              contentType: file.mimeType || 'image/png',
              bytes: body.byteLength,
            }),
          );
        }

        if (outputs.length === 0) {
          throw new RuntimePortError(
            'FETCH_FAILED',
            'No outputs found for execution',
            { details: { externalExecutionId } },
          );
        }

        return {
          outputManifest: buildResultManifest({ outputs }),
          assetIds: [],
        };
      } catch (error) {
        throw mapComfyError(error, 'FETCH_FAILED');
      }
    },

    async destroy(params) {
      try {
        const runtimeId = String(params?.runtimeId ?? '').trim();
        if (!runtimeId) {
          throw new RuntimePortError('INVALID_ARGUMENT', 'destroy requires runtimeId');
        }
        const existing = runtimes.get(runtimeId);
        if (!existing || existing.status === 'destroyed') {
          return { runtimeId, status: 'destroyed' };
        }

        const releaseCompute = params.releaseCompute !== false;
        if (releaseCompute && typeof deps.releaseCompute === 'function') {
          try {
            await deps.releaseCompute(existing, params);
          } catch (error) {
            throw mapComfyError(error, 'DESTROY_FAILED');
          }
        }

        existing.status = 'destroyed';
        runtimes.set(runtimeId, existing);
        return { runtimeId, status: 'destroyed' };
      } catch (error) {
        throw mapComfyError(error, 'DESTROY_FAILED');
      }
    },
  };

  assertRuntimePort(port);
  return Object.assign(port, { _debug: { runtimes } });
}

/**
 * CP-style orchestration for one Job Attempt via Port only (smoke / 1.5).
 *
 * @param {RuntimePort} port
 * @param {{
 *   userId: string;
 *   jobId?: string;
 *   attemptId?: string;
 *   requiredImageSpecRef: string;
 *   workflowSnapshot: Record<string, unknown>;
 *   createMetadata?: Record<string, unknown>;
 *   gpuLine?: string;
 *   pollMs?: number;
 *   timeoutMs?: number;
 *   inputManifest?: object;
 * }} opts
 */
export async function runJobAttemptViaRuntimePort(port, opts) {
  assertRuntimePort(port);
  const userId = String(opts.userId);
  const jobId = String(opts.jobId ?? randomUUID());
  const attemptId = String(opts.attemptId ?? randomUUID());
  const pollMs = Math.max(10, Number(opts.pollMs ?? 50));
  const timeoutMs = Math.max(pollMs, Number(opts.timeoutMs ?? 15_000));

  const created = await port.create({
    userId,
    jobId,
    attemptId,
    requiredImageSpecRef: opts.requiredImageSpecRef,
    gpuLine: opts.gpuLine,
    metadata: opts.createMetadata ?? {},
  });

  if (created.status !== 'ready') {
    throw new RuntimePortError(
      'RUNTIME_NOT_READY',
      `Runtime not ready after create: ${created.status}`,
    );
  }

  const submitted = await port.submit({
    runtimeId: created.runtimeId,
    jobId,
    attemptId,
    workflowSnapshot: opts.workflowSnapshot,
    inputManifest: opts.inputManifest ?? buildResultManifest({}),
    imageSpecRef: opts.requiredImageSpecRef,
  });

  const deadline = Date.now() + timeoutMs;
  /** @type {Awaited<ReturnType<RuntimePort['monitor']>> | null} */
  let last = null;
  while (Date.now() < deadline) {
    last = await port.monitor({
      runtimeId: created.runtimeId,
      attemptId,
      externalExecutionId: submitted.externalExecutionId,
    });
    if (
      last.status === 'succeeded' ||
      last.status === 'failed' ||
      last.status === 'lost'
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (!last || (last.status !== 'succeeded' && last.status !== 'failed' && last.status !== 'lost')) {
    await port.destroy({ runtimeId: created.runtimeId, reason: 'smoke_timeout' });
    throw new RuntimePortError('TIMEOUT', 'monitor timed out before terminal status');
  }

  if (last.status !== 'succeeded') {
    await port.destroy({ runtimeId: created.runtimeId, reason: last.status });
    throw new RuntimePortError(
      last.status === 'lost' ? 'EXECUTION_LOST' : 'EXECUTION_FAILED',
      last.errorMessage || `execution ${last.status}`,
    );
  }

  const fetched = await port.fetch({
    runtimeId: created.runtimeId,
    jobId,
    attemptId,
    userId,
    externalExecutionId: submitted.externalExecutionId,
  });

  await port.destroy({ runtimeId: created.runtimeId, reason: 'smoke_complete' });

  return {
    jobId,
    attemptId,
    runtimeId: created.runtimeId,
    externalExecutionId: submitted.externalExecutionId,
    outputManifest: fetched.outputManifest,
  };
}
