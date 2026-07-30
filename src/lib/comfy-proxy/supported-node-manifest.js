/**
 * A1 M2 — Supported Node Manifest helpers.
 *
 * SoT chain: image/official-nodes.lock + Runtime Image Spec (profile v3)
 *          → filtered object_info snapshot for offline Workspace.
 *
 * Does not claim arbitrary custom nodes. Pack JS offline stays out of scope (extensions=[]).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACK_VERSION,
  SPEC_ID_V3,
  nodesForProfile,
  parseOfficialNodesLock,
  defaultOfficialNodesLockPath,
} from '../cp-runtime/runtime-image-spec.js';
import { GPU_IMAGE_REPO } from '../gpu/gpu-config.js';

/** Official Image tag family for A1 offline catalog (profile v3). */
export const OFFICIAL_IMAGE_V3 = `${GPU_IMAGE_REPO}:v3.3`;

export const FE_PACKAGE_PIN = '1.45.21';
export const COMFYUI_RUNTIME_PIN = '0.28.0';

export const CAPTURE_STATUS_OFFICIAL = 'official_image';
export const CAPTURE_STATUS_PLACEHOLDER = 'placeholder_pending_official_image';

/** Core Comfy modules always allowed in offline catalog. */
export const CORE_PYTHON_MODULE_PREFIXES = Object.freeze(['comfy_extras.']);
export const CORE_PYTHON_MODULES = Object.freeze(['nodes']);

/** Packs that may appear in lock but contribute few/no object_info classes. */
export const LOCK_DIRS_OPTIONAL_OBJECT_INFO = Object.freeze([
  'ComfyUI-Manager',
]);

/** Minimum core class names required for a usable offline catalog. */
export const REQUIRED_CORE_NODE_CLASSES = Object.freeze([
  'CheckpointLoaderSimple',
  'CLIPTextEncode',
  'EmptyLatentImage',
  'KSampler',
  'VAEDecode',
  'SaveImage',
]);

/**
 * @param {string} [lockText]
 * @returns {string} sha256 hex of normalized lock text
 */
export function hashOfficialNodesLock(lockText) {
  const text = lockText ?? readFileSync(defaultOfficialNodesLockPath(), 'utf8');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {'v3' | 'v4'} [profile]
 * @param {{ locked?: import('../cp-runtime/runtime-image-spec.js').LockedNode[]; lockText?: string }} [options]
 */
export function buildPackAllowlist(profile = 'v3', options = {}) {
  const locked = options.locked ?? parseOfficialNodesLock(options.lockText);
  const packs = nodesForProfile(profile, locked);
  const packDirs = packs.map((p) => p.dir);
  return {
    profile,
    packDirs,
    packs,
    lockPath: defaultOfficialNodesLockPath(),
    lockSha256: hashOfficialNodesLock(
      options.lockText ?? readFileSync(defaultOfficialNodesLockPath(), 'utf8'),
    ),
  };
}

/**
 * @param {string | null | undefined} pythonModule
 * @param {Set<string> | string[]} packDirs
 */
export function isAllowedPythonModule(pythonModule, packDirs) {
  const m = String(pythonModule ?? '').trim();
  if (!m) return false;
  if (CORE_PYTHON_MODULES.includes(m)) return true;
  for (const prefix of CORE_PYTHON_MODULE_PREFIXES) {
    if (m.startsWith(prefix)) return true;
  }
  if (!m.startsWith('custom_nodes.')) return false;
  const dir = m.slice('custom_nodes.'.length);
  const set = packDirs instanceof Set ? packDirs : new Set(packDirs);
  // Exact dir match (Comfy registers as custom_nodes.<folder_name>).
  if (set.has(dir)) return true;
  // Tolerate nested module paths: custom_nodes.<dir>.something
  for (const allowed of set) {
    if (dir === allowed || dir.startsWith(`${allowed}.`)) return true;
  }
  return false;
}

/**
 * Filter raw Comfy `/object_info` to Supported Manifest allowlist.
 * @param {Record<string, unknown>} rawObjectInfo
 * @param {{ packDirs: string[] }} allowlist
 * @returns {{
 *   objectInfo: Record<string, unknown>;
 *   includedModules: string[];
 *   excludedModules: string[];
 *   excludedNodeCount: number;
 *   includedByModule: Record<string, number>;
 * }}
 */
export function filterObjectInfoByAllowlist(rawObjectInfo, allowlist) {
  const packSet = new Set(allowlist.packDirs || []);
  /** @type {Record<string, unknown>} */
  const objectInfo = {};
  /** @type {Map<string, number>} */
  const includedByModule = new Map();
  /** @type {Set<string>} */
  const excludedModules = new Set();
  let excludedNodeCount = 0;

  for (const [name, def] of Object.entries(rawObjectInfo || {})) {
    if (!def || typeof def !== 'object') {
      excludedNodeCount += 1;
      continue;
    }
    const pythonModule = /** @type {{ python_module?: string }} */ (def).python_module;
    if (!isAllowedPythonModule(pythonModule, packSet)) {
      excludedNodeCount += 1;
      if (pythonModule) excludedModules.add(String(pythonModule));
      continue;
    }
    objectInfo[name] = def;
    const mod = String(pythonModule);
    includedByModule.set(mod, (includedByModule.get(mod) || 0) + 1);
  }

  return {
    objectInfo,
    includedModules: [...includedByModule.keys()].sort(),
    excludedModules: [...excludedModules].sort(),
    excludedNodeCount,
    includedByModule: Object.fromEntries(
      [...includedByModule.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
  };
}

/**
 * @param {Record<string, unknown>} objectInfo
 * @returns {string[]}
 */
export function listCustomNodeDirsInObjectInfo(objectInfo) {
  /** @type {Set<string>} */
  const dirs = new Set();
  for (const def of Object.values(objectInfo || {})) {
    const m = String(
      /** @type {{ python_module?: string }} */ (def)?.python_module || '',
    );
    if (!m.startsWith('custom_nodes.')) continue;
    const rest = m.slice('custom_nodes.'.length);
    const dir = rest.split('.')[0];
    if (dir) dirs.add(dir);
  }
  return [...dirs].sort();
}

/**
 * @param {object} params
 * @param {'official_image' | 'placeholder_pending_official_image'} params.captureStatus
 * @param {Record<string, unknown>} params.objectInfo
 * @param {ReturnType<typeof buildPackAllowlist>} params.allowlist
 * @param {{
 *   dockerImage?: string;
 *   capturedAt?: string;
 *   source?: string;
 *   rawNodeCount?: number;
 *   excludedNodeCount?: number;
 *   includedModules?: string[];
 *   excludedModules?: string[];
 * }} [params.meta]
 */
export function buildSupportedNodeManifest(params) {
  const {
    captureStatus,
    objectInfo,
    allowlist,
    meta = {},
  } = params;
  const nodeNames = Object.keys(objectInfo || {}).sort();
  const customDirs = listCustomNodeDirsInObjectInfo(objectInfo);
  const missingCore = REQUIRED_CORE_NODE_CLASSES.filter((n) => !objectInfo?.[n]);
  const complete =
    captureStatus === CAPTURE_STATUS_OFFICIAL && missingCore.length === 0;

  return {
    schema_version: 1,
    manifest_id: `gpuvietnam.supported-nodes.v3@${PACK_VERSION}`,
    profile: 'v3',
    spec_id: SPEC_ID_V3,
    pack_version: PACK_VERSION,
    capture_status: captureStatus,
    complete,
    version_pins: {
      comfyui_frontend_package: FE_PACKAGE_PIN,
      comfyui_runtime: COMFYUI_RUNTIME_PIN,
      docker_image: meta.dockerImage || OFFICIAL_IMAGE_V3,
    },
    provenance: {
      lock_path: 'image/official-nodes.lock',
      lock_sha256: allowlist.lockSha256,
      docker_image: meta.dockerImage || OFFICIAL_IMAGE_V3,
      captured_at: meta.capturedAt || null,
      source: meta.source || null,
      allowlist_pack_dirs: allowlist.packDirs,
      packs: allowlist.packs,
    },
    catalog: {
      node_count: nodeNames.length,
      custom_node_dirs_included: customDirs,
      included_python_modules: meta.includedModules || [],
      excluded_python_modules_sample: (meta.excludedModules || []).slice(0, 40),
      raw_node_count: meta.rawNodeCount ?? null,
      excluded_node_count: meta.excludedNodeCount ?? null,
      missing_required_core: missingCore,
    },
    policy: {
      offline_extensions: [],
      unsupported_claim:
        'Offline catalog supports only core Comfy modules + packs pinned in image/official-nodes.lock for profile v3. Nodes outside this allowlist are not supported offline.',
      placeholder:
        captureStatus === CAPTURE_STATUS_PLACEHOLDER
          ? 'Artifact is a placeholder until object_info is captured from Official Image :v3.3. Do not treat as full Official Pack support.'
          : null,
    },
  };
}

/**
 * Validate a built manifest + object_info pair against current lock.
 * @param {object} manifest
 * @param {Record<string, unknown>} objectInfo
 * @param {{ lockText?: string; requireOfficial?: boolean }} [options]
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function validateSupportedNodeManifest(manifest, objectInfo, options = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest missing'] };
  }
  if (manifest.schema_version !== 1) {
    errors.push(`unexpected schema_version: ${manifest.schema_version}`);
  }
  if (manifest.profile !== 'v3') {
    errors.push(`profile must be v3, got ${manifest.profile}`);
  }
  if (manifest.spec_id !== SPEC_ID_V3) {
    errors.push(`spec_id mismatch: ${manifest.spec_id}`);
  }

  const allowlist = buildPackAllowlist('v3', { lockText: options.lockText });
  if (manifest.provenance?.lock_sha256 !== allowlist.lockSha256) {
    errors.push(
      `lock drift: manifest.lock_sha256=${manifest.provenance?.lock_sha256} current=${allowlist.lockSha256}`,
    );
  }

  const status = manifest.capture_status;
  if (
    status !== CAPTURE_STATUS_OFFICIAL &&
    status !== CAPTURE_STATUS_PLACEHOLDER
  ) {
    errors.push(`invalid capture_status: ${status}`);
  }

  // object_info must never contain disallowed modules
  for (const [name, def] of Object.entries(objectInfo || {})) {
    const mod = /** @type {{ python_module?: string }} */ (def)?.python_module;
    if (!isAllowedPythonModule(mod, allowlist.packDirs)) {
      errors.push(`object_info contains disallowed node ${name} module=${mod}`);
    }
  }

  if (status === CAPTURE_STATUS_PLACEHOLDER) {
    if (manifest.complete === true) {
      errors.push('placeholder manifest must have complete=false');
    }
    const customDirs = listCustomNodeDirsInObjectInfo(objectInfo || {});
    if (customDirs.length > 0) {
      errors.push(
        `placeholder must not include custom pack nodes (found: ${customDirs.join(', ')})`,
      );
    }
  }

  if (status === CAPTURE_STATUS_OFFICIAL || options.requireOfficial) {
    if (status !== CAPTURE_STATUS_OFFICIAL) {
      errors.push('requireOfficial but capture_status is not official_image');
    }
    if (!manifest.provenance?.captured_at) {
      errors.push('official capture missing provenance.captured_at');
    }
    if (!manifest.provenance?.source) {
      errors.push('official capture missing provenance.source');
    }
    const missingCore = REQUIRED_CORE_NODE_CLASSES.filter((n) => !objectInfo?.[n]);
    if (missingCore.length) {
      errors.push(`official catalog missing core nodes: ${missingCore.join(', ')}`);
    }
    const presentDirs = new Set(listCustomNodeDirsInObjectInfo(objectInfo || {}));
    for (const dir of allowlist.packDirs) {
      if (LOCK_DIRS_OPTIONAL_OBJECT_INFO.includes(dir)) continue;
      if (!presentDirs.has(dir)) {
        errors.push(`official catalog missing locked pack dir in object_info: ${dir}`);
      }
    }
  }

  if (
    typeof manifest.catalog?.node_count === 'number' &&
    manifest.catalog.node_count !== Object.keys(objectInfo || {}).length
  ) {
    errors.push(
      `catalog.node_count (${manifest.catalog.node_count}) != object_info keys (${Object.keys(objectInfo || {}).length})`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Resolve default catalog output directory (Worker-served artifacts).
 */
export function defaultCatalogDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '../../../workers/comfy-proxy/catalog');
}

export function defaultManifestPath() {
  return join(defaultCatalogDir(), 'supported-node-manifest.v3.json');
}

export function defaultObjectInfoPath() {
  return join(defaultCatalogDir(), 'supported-object_info.v3.json');
}
