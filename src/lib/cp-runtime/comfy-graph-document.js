/**
 * ComfyUI graph ↔ CP workflow.document contract (opaque jsonb, round-trip helpers).
 *
 * CP stores whatever Comfy `app.graph.serialize()` produces (LiteGraph).
 * Prompt-style maps (`{ "1": { class_type, inputs } }`) are also accepted as document
 * but are not auto-converted for the canvas — canvas inject uses LiteGraph shape.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize inbound document for storage.
 * @param {unknown} document
 * @returns {Record<string, unknown>}
 */
export function normalizeCpWorkflowDocument(document) {
  if (!isPlainObject(document)) return {};
  // Structured clone via JSON to drop non-JSON values / cycles.
  try {
    return JSON.parse(JSON.stringify(document));
  } catch {
    return {};
  }
}

/**
 * True when document looks like a LiteGraph serialize() payload (has nodes array).
 * @param {unknown} document
 */
export function isLiteGraphDocument(document) {
  if (!isPlainObject(document)) return false;
  return Array.isArray(document.nodes);
}

/**
 * True when document looks like Comfy API prompt map (node id → { class_type }).
 * @param {unknown} document
 */
export function isComfyPromptDocument(document) {
  if (!isPlainObject(document) || Array.isArray(document.nodes)) return false;
  const entries = Object.entries(document);
  if (entries.length === 0) return false;
  let typed = 0;
  for (const [, node] of entries) {
    if (!isPlainObject(node)) return false;
    if (typeof node.class_type === 'string' && node.class_type) typed += 1;
  }
  return typed > 0 && typed === entries.length;
}

/**
 * Count LiteGraph nodes (0 when not a LiteGraph document).
 * @param {unknown} document
 */
export function countLiteGraphNodes(document) {
  if (!isLiteGraphDocument(document)) return 0;
  return /** @type {{ nodes: unknown[] }} */ (document).nodes.length;
}

/**
 * True when inbound LiteGraph (or empty object) would wipe a non-empty SoT graph.
 * Used to block boot/empty-canvas autosave from clobbering Control Plane.
 * @param {unknown} existingDocument
 * @param {unknown} inboundDocument
 */
export function shouldRejectEmptyDocumentOverwrite(existingDocument, inboundDocument) {
  const existingNodes = countLiteGraphNodes(existingDocument);
  if (existingNodes <= 0) return false;
  if (!isPlainObject(inboundDocument)) return true;
  if (Object.keys(inboundDocument).length === 0) return true;
  if (isLiteGraphDocument(inboundDocument) && countLiteGraphNodes(inboundDocument) === 0) {
    return true;
  }
  return false;
}

/**
 * Whether CP document should be injected into the Comfy canvas on boot.
 * Empty `{}` / empty nodes[] → skip (first session or wiped canvas).
 * @param {unknown} document
 */
export function shouldInjectDocumentIntoComfy(document) {
  if (!isPlainObject(document)) return false;
  if (Object.keys(document).length === 0) return false;
  return isLiteGraphDocument(document) && countLiteGraphNodes(document) > 0;
}

/**
 * Build client-facing sync payload (extension + dashboards).
 * @param {object} workflow row or client payload
 * @param {{ machineId?: string | null }} [extra]
 */
export function toComfySyncPayload(workflow, extra = {}) {
  const document = normalizeCpWorkflowDocument(workflow?.document ?? {});
  return {
    schema: 'cp.comfy_sync.v1',
    workflowId: workflow?.id ?? workflow?.workflowId ?? null,
    projectId: workflow?.project_id ?? workflow?.projectId ?? null,
    name: workflow?.name ?? 'Untitled',
    document,
    settings: isPlainObject(workflow?.settings) ? workflow.settings : {},
    revision: Number(workflow?.revision ?? 1) || 1,
    status: workflow?.status ?? 'draft',
    updatedAt: workflow?.updated_at ?? workflow?.updatedAt ?? null,
    machineId: extra.machineId ?? null,
    inject: shouldInjectDocumentIntoComfy(document),
  };
}

/**
 * Encode bootstrap fragment for work enter / direct open.
 * @param {{ token?: string; workflowId?: string | null; apiBase?: string | null; revision?: number | null }} input
 */
export function encodeComfyCpBootstrapHash(input = {}) {
  const payload = {
    v: 1,
    t: input.token ? String(input.token) : undefined,
    w: input.workflowId ? String(input.workflowId) : undefined,
    a: input.apiBase ? String(input.apiBase).replace(/\/$/, '') : undefined,
    r: input.revision != null ? Number(input.revision) : undefined,
  };
  const json = JSON.stringify(payload);
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(json, 'utf8').toString('base64url')
      : btoa(unescape(encodeURIComponent(json)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
  return `gvn_cp=${b64}`;
}

/**
 * @param {string} hashOrQuery fragment without leading #, or full hash
 * @returns {{ v: number; token?: string; workflowId?: string; apiBase?: string; revision?: number } | null}
 */
export function decodeComfyCpBootstrapHash(hashOrQuery) {
  const raw = String(hashOrQuery ?? '')
    .replace(/^#/, '')
    .trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw.includes('=') ? raw : `gvn_cp=${raw}`);
  const encoded = params.get('gvn_cp');
  if (!encoded) return null;
  try {
    const json =
      typeof Buffer !== 'undefined'
        ? Buffer.from(encoded, 'base64url').toString('utf8')
        : decodeURIComponent(escape(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))));
    const parsed = JSON.parse(json);
    if (!isPlainObject(parsed) || Number(parsed.v) !== 1) return null;
    return {
      v: 1,
      token: parsed.t ? String(parsed.t) : undefined,
      workflowId: parsed.w ? String(parsed.w) : undefined,
      apiBase: parsed.a ? String(parsed.a).replace(/\/$/, '') : undefined,
      revision: parsed.r != null ? Number(parsed.r) : undefined,
    };
  } catch {
    return null;
  }
}
