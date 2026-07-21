/**
 * Runtime Image Spec catalog + parity gate (Architecture v2.0 / B1.3.5).
 * Spec: docs/architecture/RuntimeImageSpec.md
 *
 * Build SoT for node SHAs: image/official-nodes.lock
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_IMAGE_REPO, GPU_IMAGE_V3, GPU_IMAGE_V4 } from '../gpu/gpu-config.js';

export const PACK_VERSION = '1.0';

export const SPEC_ID_V3 = `gpuvietnam.comfy.v3@${PACK_VERSION}`;
export const SPEC_ID_V4 = `gpuvietnam.comfy.v4@${PACK_VERSION}`;

/** @typedef {'v3' | 'v4'} ImageProfile */

/**
 * @typedef {{ dir: string; git_url: string; commit: string; profiles: string[] }} LockedNode
 * @typedef {{ relative: string; required?: boolean }} StockModelRef
 * @typedef {{
 *   spec_id: string;
 *   runtime_kind: 'comfy';
 *   pack_version: string;
 *   profile: ImageProfile;
 *   docker: { repository: string; tag: string; image: string };
 *   cuda: { target: string };
 *   custom_nodes: Array<{ dir: string; git_url: string; commit: string }>;
 *   extensions: string[];
 *   stock_models: StockModelRef[];
 *   loras: StockModelRef[];
 *   satisfies_spec_ids: string[];
 * }} RuntimeImageSpec
 */

export const GPUVIETNAM_EXTENSIONS = Object.freeze([
  'gpuvietnam_branding',
  'gpuvietnam_backup',
]);

/** MVP stock models aligned with scripts/download-models.sh */
export const DEFAULT_STOCK_MODELS = Object.freeze([
  { relative: 'checkpoints/sd_xl_base_1.0.safetensors', required: true },
  { relative: 'checkpoints/RealVisXL_V6.0_B1.safetensors', required: true },
  { relative: 'upscale_models/RealESRGAN_x4plus.pth', required: true },
]);

/**
 * @param {string} [lockText]
 * @returns {LockedNode[]}
 */
export function parseOfficialNodesLock(lockText) {
  const text =
    lockText ??
    readFileSync(defaultOfficialNodesLockPath(), 'utf8');
  /** @type {LockedNode[]} */
  const nodes = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [profile, dir, git_url, commit] = parts;
    if (!profile || !dir || !git_url || !commit) continue;
    const existing = nodes.find((n) => n.dir === dir);
    if (existing) {
      if (!existing.profiles.includes(profile)) existing.profiles.push(profile);
      continue;
    }
    nodes.push({
      dir,
      git_url,
      commit,
      profiles: [profile],
    });
  }
  return nodes;
}

/**
 * @returns {string}
 */
export function defaultOfficialNodesLockPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '../../../image/official-nodes.lock');
}

/**
 * Nodes installed for a profile (common + profile-specific).
 * @param {ImageProfile} profile
 * @param {LockedNode[]} [locked]
 */
export function nodesForProfile(profile, locked) {
  const list = locked ?? parseOfficialNodesLock();
  return list
    .filter((n) => n.profiles.includes('common') || n.profiles.includes(profile))
    .map(({ dir, git_url, commit }) => ({ dir, git_url, commit }));
}

/**
 * @param {ImageProfile} profile
 * @param {{ image?: string; locked?: LockedNode[] }} [options]
 * @returns {RuntimeImageSpec}
 */
export function buildRuntimeImageSpec(profile, options = {}) {
  if (profile !== 'v3' && profile !== 'v4') {
    throw new Error(`unsupported image profile: ${profile}`);
  }
  const tag = profile;
  const image =
    (options.image && String(options.image).trim()) ||
    (profile === 'v4' ? GPU_IMAGE_V4 : GPU_IMAGE_V3);
  const custom_nodes = nodesForProfile(profile, options.locked);
  const spec_id = profile === 'v4' ? SPEC_ID_V4 : SPEC_ID_V3;
  const satisfies_spec_ids =
    profile === 'v4' ? [SPEC_ID_V3, SPEC_ID_V4] : [SPEC_ID_V3];

  return {
    spec_id,
    runtime_kind: 'comfy',
    pack_version: PACK_VERSION,
    profile,
    docker: {
      repository: GPU_IMAGE_REPO,
      tag,
      image,
    },
    cuda: {
      target: profile === 'v4' ? '12.8' : '12.0',
    },
    custom_nodes,
    extensions: [...GPUVIETNAM_EXTENSIONS],
    stock_models: DEFAULT_STOCK_MODELS.map((m) => ({ ...m })),
    loras: [],
    satisfies_spec_ids,
  };
}

/** @type {Map<string, RuntimeImageSpec> | null} */
let catalogCache = null;

/**
 * @param {{ reload?: boolean; locked?: LockedNode[] }} [options]
 * @returns {Map<string, RuntimeImageSpec>}
 */
export function getRuntimeImageSpecCatalog(options = {}) {
  if (catalogCache && !options.reload && !options.locked) return catalogCache;
  const locked = options.locked ?? parseOfficialNodesLock();
  const v3 = buildRuntimeImageSpec('v3', { locked });
  const v4 = buildRuntimeImageSpec('v4', { locked });
  const map = new Map([
    [v3.spec_id, v3],
    [v4.spec_id, v4],
  ]);
  if (!options.locked) catalogCache = map;
  return map;
}

/**
 * @param {string | null | undefined} specId
 * @returns {RuntimeImageSpec | null}
 */
export function getRuntimeImageSpec(specId) {
  const id = String(specId ?? '').trim();
  if (!id) return null;
  return getRuntimeImageSpecCatalog().get(id) ?? null;
}

/**
 * Map GPU line → Image Spec id (provision / Job default).
 * @param {string | null | undefined} gpuLine
 * @returns {string}
 */
export function resolveImageSpecRefForGpuLine(gpuLine) {
  const line = String(gpuLine ?? '').trim();
  if (line === 'rtx5090_1x') return SPEC_ID_V4;
  return SPEC_ID_V3;
}

/**
 * Infer spec id from a docker image reference when possible.
 * @param {string | null | undefined} image
 * @returns {string | null}
 */
export function inferImageSpecRefFromDockerImage(image) {
  const img = String(image ?? '').trim().toLowerCase();
  if (!img) return null;
  if (img.endsWith(':v4') || img.includes(':v4-') || img.includes('/gpuvietnam-comfyui:v4')) {
    return SPEC_ID_V4;
  }
  if (img.endsWith(':v3') || img.includes(':v3-') || img.includes('/gpuvietnam-comfyui:v3')) {
    return SPEC_ID_V3;
  }
  return null;
}

/**
 * @param {RuntimeImageSpec} spec
 * @returns {Set<string>}
 */
function capabilityNodeSet(spec) {
  const set = new Set(spec.extensions);
  for (const n of spec.custom_nodes) set.add(n.dir);
  return set;
}

/**
 * @param {RuntimeImageSpec} spec
 * @returns {Set<string>}
 */
function capabilityModelSet(spec) {
  return new Set(spec.stock_models.map((m) => m.relative));
}

/**
 * @param {RuntimeImageSpec} spec
 * @returns {Set<string>}
 */
function capabilityLoraSet(spec) {
  return new Set(spec.loras.map((m) => m.relative));
}

/**
 * Normalize model key to stock-relative form when possible.
 * @param {string} key
 */
export function normalizeModelRelativeKey(key) {
  let k = String(key ?? '').trim().replace(/\\/g, '/');
  while (k.startsWith('/')) k = k.slice(1);
  if (k.startsWith('stock/models/')) k = k.slice('stock/models/'.length);
  else if (k.startsWith('models/')) k = k.slice('models/'.length);
  return k;
}

/**
 * Parity gate: can this Runtime accept an Attempt for the required spec?
 *
 * @param {{
 *   requiredSpecId: string | null | undefined;
 *   runtimeSpecId: string | null | undefined;
 *   requiredNodes?: string[];
 *   requiredModels?: string[];
 *   requiredLoras?: string[];
 *   availableUserModels?: string[];
 *   availableUserLoras?: string[];
 * }} input
 * @returns {{
 *   ok: boolean;
 *   code: string;
 *   requiredSpecId: string | null;
 *   runtimeSpecId: string | null;
 *   missing: { nodes: string[]; models: string[]; loras: string[]; reason?: string };
 * }}
 */
export function evaluateImageSpecParity(input) {
  const requiredSpecId = String(input.requiredSpecId ?? '').trim() || null;
  const runtimeSpecId = String(input.runtimeSpecId ?? '').trim() || null;
  /** @type {{ nodes: string[]; models: string[]; loras: string[]; reason?: string }} */
  const missing = { nodes: [], models: [], loras: [] };

  if (!requiredSpecId || !runtimeSpecId) {
    return {
      ok: false,
      code: 'missing_spec_ref',
      requiredSpecId,
      runtimeSpecId,
      missing: { ...missing, reason: 'requiredSpecId and runtimeSpecId are required' },
    };
  }

  const required = getRuntimeImageSpec(requiredSpecId);
  const runtime = getRuntimeImageSpec(runtimeSpecId);
  if (!required || !runtime) {
    return {
      ok: false,
      code: 'unknown_spec',
      requiredSpecId,
      runtimeSpecId,
      missing: {
        ...missing,
        reason: !required
          ? `unknown requiredSpecId: ${requiredSpecId}`
          : `unknown runtimeSpecId: ${runtimeSpecId}`,
      },
    };
  }

  if (!runtime.satisfies_spec_ids.includes(requiredSpecId)) {
    return {
      ok: false,
      code: 'profile_mismatch',
      requiredSpecId,
      runtimeSpecId,
      missing: {
        ...missing,
        reason: `${runtimeSpecId} does not satisfy ${requiredSpecId}`,
      },
    };
  }

  const nodes = capabilityNodeSet(runtime);
  for (const dir of input.requiredNodes ?? []) {
    const name = String(dir ?? '').trim();
    if (name && !nodes.has(name)) missing.nodes.push(name);
  }

  const models = capabilityModelSet(runtime);
  const userModels = new Set(
    (input.availableUserModels ?? []).map(normalizeModelRelativeKey),
  );
  for (const m of input.requiredModels ?? []) {
    const rel = normalizeModelRelativeKey(m);
    if (rel && !models.has(rel) && !userModels.has(rel) && !userModels.has(m)) {
      missing.models.push(rel);
    }
  }

  const loras = capabilityLoraSet(runtime);
  const userLoras = new Set(
    (input.availableUserLoras ?? []).map(normalizeModelRelativeKey),
  );
  for (const m of input.requiredLoras ?? []) {
    const rel = normalizeModelRelativeKey(m);
    if (rel && !loras.has(rel) && !userLoras.has(rel) && !userLoras.has(m)) {
      missing.loras.push(rel);
    }
  }

  const ok =
    missing.nodes.length === 0 &&
    missing.models.length === 0 &&
    missing.loras.length === 0;

  return {
    ok,
    code: ok ? 'ok' : 'parity_gap',
    requiredSpecId,
    runtimeSpecId,
    missing,
  };
}
