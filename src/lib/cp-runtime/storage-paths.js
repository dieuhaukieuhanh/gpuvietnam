/**
 * Control Plane durable storage path helpers (Architecture v2.0 / B1.3).
 * Spec: docs/architecture/B1_3_STORAGE_SPEC.md
 *
 * Plane B keys live under users/{userId}/cp/…
 * Plane C stock models stay under stock/models/… (unchanged).
 */

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function requireSegment(value, label) {
  const s = String(value ?? '').trim();
  if (!s) throw new Error(`${label} is required`);
  if (!SAFE_SEGMENT.test(s)) {
    throw new Error(`${label} contains invalid characters`);
  }
  return s;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function requireFilename(value) {
  const s = String(value ?? '').trim().replace(/\\/g, '/');
  if (!s || s.includes('/') || s.includes('..')) {
    throw new Error('filename must be a single path segment');
  }
  if (!SAFE_FILENAME.test(s)) {
    throw new Error('filename contains invalid characters');
  }
  if (s.length > 255) throw new Error('filename too long');
  return s;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function requireAttemptNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('attemptNumber must be an integer >= 1');
  }
  return n;
}

/**
 * @param {string} userId
 * @param {string} projectId
 * @param {string} assetId
 * @param {string} filename
 */
export function buildProjectAssetKey(userId, projectId, assetId, filename) {
  const uid = requireSegment(userId, 'userId');
  const pid = requireSegment(projectId, 'projectId');
  const aid = requireSegment(assetId, 'assetId');
  const name = requireFilename(filename);
  return `users/${uid}/cp/projects/${pid}/assets/${aid}/${name}`;
}

/**
 * @param {string} userId
 * @param {string} jobId
 * @param {string} filename
 */
export function buildJobInputKey(userId, jobId, filename) {
  const uid = requireSegment(userId, 'userId');
  const jid = requireSegment(jobId, 'jobId');
  const name = requireFilename(filename);
  return `users/${uid}/cp/jobs/${jid}/inputs/${name}`;
}

/**
 * @param {string} userId
 * @param {string} jobId
 * @param {number|string} attemptNumber
 * @param {string} filename
 */
export function buildAttemptOutputKey(userId, jobId, attemptNumber, filename) {
  const uid = requireSegment(userId, 'userId');
  const jid = requireSegment(jobId, 'jobId');
  const n = requireAttemptNumber(attemptNumber);
  const name = requireFilename(filename);
  return `users/${uid}/cp/jobs/${jid}/attempts/${n}/outputs/${name}`;
}

/**
 * @param {string} userId
 * @param {string} jobId
 * @param {number|string} attemptNumber
 * @param {string} filename
 */
export function buildAttemptLogKey(userId, jobId, attemptNumber, filename) {
  const uid = requireSegment(userId, 'userId');
  const jid = requireSegment(jobId, 'jobId');
  const n = requireAttemptNumber(attemptNumber);
  const name = requireFilename(filename);
  return `users/${uid}/cp/jobs/${jid}/attempts/${n}/logs/${name}`;
}

/**
 * @param {string} userId
 * @param {string} jobId
 * @param {number|string} attemptNumber
 * @param {string} filename
 */
export function buildAttemptSidecarKey(userId, jobId, attemptNumber, filename) {
  const uid = requireSegment(userId, 'userId');
  const jid = requireSegment(jobId, 'jobId');
  const n = requireAttemptNumber(attemptNumber);
  const name = requireFilename(filename);
  return `users/${uid}/cp/jobs/${jid}/attempts/${n}/sidecar/${name}`;
}

/**
 * Relative stock model key → full R2 key (Plane C).
 * @param {string} relativeKey e.g. checkpoints/foo.safetensors or models/checkpoints/foo.safetensors
 */
export function buildStockModelKey(relativeKey) {
  let key = String(relativeKey ?? '').trim().replace(/\\/g, '/');
  while (key.startsWith('/')) key = key.slice(1);
  if (!key || key.includes('..') || key.split('/').some((p) => p === '' || p === '..')) {
    throw new Error('invalid stock model relative key');
  }
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(key)) {
    throw new Error('stock model key contains invalid characters');
  }
  if (key.startsWith('stock/')) return key;
  if (key.startsWith('models/')) return `stock/${key}`;
  return `stock/models/${key}`;
}

/**
 * True if key is Plane B (CP durable), not workspace backup Plane A.
 * @param {string} objectKey
 */
export function isCpDurableObjectKey(objectKey) {
  const key = String(objectKey ?? '').replace(/^\/+/, '');
  return /^users\/[^/]+\/cp\//.test(key);
}

/**
 * True if key is shared stock (Plane C).
 * @param {string} objectKey
 */
export function isStockObjectKey(objectKey) {
  const key = String(objectKey ?? '').replace(/^\/+/, '');
  return key.startsWith('stock/');
}

/**
 * @param {object} input
 * @param {'input'|'output'|'project_asset'|'log'|'model_ref'|'sidecar'} input.kind
 * @param {string} [input.assetId]
 * @param {string} input.r2Key
 * @param {string} input.filename
 * @param {string} [input.contentType]
 * @param {number} [input.bytes]
 * @param {string} [input.sha256]
 * @param {'stock'|'user'} [input.source] for model_refs
 */
export function buildManifestEntry(input) {
  const filename = requireFilename(input.filename);
  const r2Key = String(input.r2Key ?? '').trim();
  if (!r2Key) throw new Error('r2Key is required');
  if (r2Key.includes('..')) throw new Error('r2Key must not contain ..');

  /** @type {Record<string, unknown>} */
  const entry = {
    r2_key: r2Key,
    filename,
  };
  if (input.assetId) entry.asset_id = String(input.assetId);
  if (input.contentType) entry.content_type = String(input.contentType);
  if (input.bytes != null) entry.bytes = Number(input.bytes) || 0;
  if (input.sha256) entry.sha256 = String(input.sha256);
  if (input.source) entry.source = String(input.source);
  if (input.kind) entry.kind = String(input.kind);
  return entry;
}

/**
 * @param {{
 *   inputs?: object[];
 *   outputs?: object[];
 *   model_refs?: object[];
 * }} parts
 */
export function buildResultManifest(parts = {}) {
  return {
    schema: 'cp.storage.manifest.v1',
    inputs: Array.isArray(parts.inputs) ? parts.inputs : [],
    outputs: Array.isArray(parts.outputs) ? parts.outputs : [],
    model_refs: Array.isArray(parts.model_refs) ? parts.model_refs : [],
  };
}
