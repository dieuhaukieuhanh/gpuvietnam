/**
 * A1 M2 — Build Supported Node Manifest + offline object_info snapshot.
 *
 * Official (preferred):
 *   node scripts/build-supported-node-manifest.mjs --capture-docker
 *   # or after manual capture from :v3.2:
 *   node scripts/build-supported-node-manifest.mjs --from-object-info ./tmp/object_info.v32.json
 *
 * Placeholder (no Docker / no official capture):
 *   node scripts/build-supported-node-manifest.mjs --placeholder
 *
 * Env:
 *   GPUVIETNAM_COMFYUI_IMAGE_V3  override image (must be …:v3.2 family for official)
 *   COMFY_CAPTURE_PORT           host port for docker publish (default 18188)
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OFFICIAL_IMAGE_V3,
  CAPTURE_STATUS_OFFICIAL,
  CAPTURE_STATUS_PLACEHOLDER,
  buildPackAllowlist,
  filterObjectInfoByAllowlist,
  buildSupportedNodeManifest,
  validateSupportedNodeManifest,
  defaultCatalogDir,
  defaultManifestPath,
  defaultObjectInfoPath,
} from '../src/lib/comfy-proxy/supported-node-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function parseArgs(argv) {
  const out = {
    placeholder: false,
    captureDocker: false,
    fromObjectInfo: null,
    outDir: defaultCatalogDir(),
    image: (process.env.GPUVIETNAM_COMFYUI_IMAGE_V3 || '').trim() || OFFICIAL_IMAGE_V3,
    port: Number(process.env.COMFY_CAPTURE_PORT || 18188),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--placeholder') out.placeholder = true;
    else if (a === '--capture-docker') out.captureDocker = true;
    else if (a === '--from-object-info') out.fromObjectInfo = argv[++i];
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--image') out.image = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage:
  --capture-docker              Run Official Image, GET /object_info, write official artifacts
  --from-object-info <file>     Build official artifacts from a pre-captured object_info JSON
  --placeholder                 Write incomplete placeholder (no pack defs; not Official support)
  --out-dir <dir>               Default: workers/comfy-proxy/catalog
  --image <ref>                 Default: ${OFFICIAL_IMAGE_V3}
  --port <n>                    Host port for docker capture (default 18188)
`);
      process.exit(0);
    }
  }
  return out;
}

function assertV32Family(image) {
  if (!/:(v3\.2)(\b|$)/.test(String(image)) && !String(image).endsWith(':v3.2')) {
    // Allow digest forms later; for tags require v3.2
    if (!String(image).includes('v3.2')) {
      throw new Error(
        `Refuse: official capture image must be :v3.2 family, got ${image}`,
      );
    }
  }
}

async function fetchObjectInfo(baseUrl, attempts = 60) {
  const base = baseUrl.replace(/\/$/, '');
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${base}/object_info`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        return await res.json();
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `Timed out waiting for object_info at ${base}: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
  );
}

function dockerAvailable() {
  const r = spawnSync('docker', ['info'], { encoding: 'utf8' });
  return r.status === 0;
}

async function captureFromDocker(image, port) {
  if (!dockerAvailable()) {
    throw new Error(
      'Docker daemon not available. Start Docker Desktop, or use --from-object-info / --placeholder.',
    );
  }
  assertV32Family(image);
  // Official image start.sh defaults COMFYUI_PORT=8080 (not stock 8188).
  const containerPort = Number(process.env.COMFY_CAPTURE_CONTAINER_PORT || 8080);
  const name = `gvn-a1-m2-capture-${Date.now()}`;
  console.log(
    JSON.stringify(
      { action: 'docker_run', image, hostPort: port, containerPort, name },
      null,
      2,
    ),
  );
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '--gpus',
      'all',
      '-e',
      'GPUVIETNAM_SKIP_MODEL_DOWNLOAD=1',
      '-e',
      'GPUVIETNAM_PERIODIC_BACKUP=0',
      '-e',
      `COMFYUI_PORT=${containerPort}`,
      '-p',
      `${port}:${containerPort}`,
      image,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) {
    throw new Error(`docker run failed: ${(run.stderr || run.stdout || '').slice(0, 800)}`);
  }
  try {
    // Cold start of Official Image can take several minutes (custom nodes import).
    const raw = await fetchObjectInfo(`http://127.0.0.1:${port}`, 180);
    return {
      raw,
      source: `docker:${image}`,
      dockerImage: image,
    };
  } finally {
    spawnSync('docker', ['stop', '-t', '20', name], { encoding: 'utf8' });
  }
}

function writeArtifacts(outDir, manifest, objectInfo) {
  mkdirSync(outDir, { recursive: true });
  const manifestPath = join(outDir, 'supported-node-manifest.v3.json');
  const objectInfoPath = join(outDir, 'supported-object_info.v3.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(objectInfoPath, `${JSON.stringify(objectInfo)}\n`, 'utf8');
  // Worker-friendly re-export (avoids JSON import quirks across bundlers).
  const genPath = join(root, 'workers/comfy-proxy/src/catalog-data.gen.js');
  writeFileSync(
    genPath,
    `/* eslint-disable */\n/* Generated by scripts/build-supported-node-manifest.mjs — do not edit. */\nexport const SUPPORTED_NODE_MANIFEST = ${JSON.stringify(manifest)};\nexport const SUPPORTED_OBJECT_INFO = ${JSON.stringify(objectInfo)};\n`,
    'utf8',
  );
  return { manifestPath, objectInfoPath, genPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.placeholder && !args.captureDocker && !args.fromObjectInfo) {
    console.error(
      'Specify --capture-docker, --from-object-info <file>, or --placeholder',
    );
    process.exit(2);
  }
  if (args.placeholder && (args.captureDocker || args.fromObjectInfo)) {
    console.error('--placeholder cannot combine with capture inputs');
    process.exit(2);
  }

  const allowlist = buildPackAllowlist('v3');
  const capturedAt = new Date().toISOString();

  if (args.placeholder) {
    const objectInfo = {};
    const manifest = buildSupportedNodeManifest({
      captureStatus: CAPTURE_STATUS_PLACEHOLDER,
      objectInfo,
      allowlist,
      meta: {
        dockerImage: OFFICIAL_IMAGE_V3,
        capturedAt,
        source: 'placeholder:no-capture',
        rawNodeCount: 0,
        excludedNodeCount: 0,
        includedModules: [],
        excludedModules: [],
      },
    });
    const check = validateSupportedNodeManifest(manifest, objectInfo);
    if (!check.ok) {
      console.error('PLACEHOLDER_VALIDATION_FAIL', check.errors);
      process.exit(1);
    }
    const paths = writeArtifacts(args.outDir, manifest, objectInfo);
    console.log(
      JSON.stringify(
        {
          ok: true,
          capture_status: CAPTURE_STATUS_PLACEHOLDER,
          note: 'Docker/official capture required for complete catalog. Packs from lock are NOT included.',
          allowlist_pack_dirs: allowlist.packDirs,
          lock_sha256: allowlist.lockSha256,
          ...paths,
          node_count: 0,
        },
        null,
        2,
      ),
    );
    return;
  }

  let raw;
  let source;
  let dockerImage = args.image;

  if (args.captureDocker) {
    assertV32Family(args.image);
    const cap = await captureFromDocker(args.image, args.port);
    raw = cap.raw;
    source = cap.source;
    dockerImage = cap.dockerImage;
  } else {
    assertV32Family(args.image);
    const file = args.fromObjectInfo;
    if (!file || !existsSync(file)) {
      throw new Error(`--from-object-info not found: ${file}`);
    }
    raw = JSON.parse(readFileSync(file, 'utf8'));
    source = `file:${file}`;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('object_info capture is not a JSON object');
  }

  const filtered = filterObjectInfoByAllowlist(raw, allowlist);
  const manifest = buildSupportedNodeManifest({
    captureStatus: CAPTURE_STATUS_OFFICIAL,
    objectInfo: filtered.objectInfo,
    allowlist,
    meta: {
      dockerImage,
      capturedAt,
      source,
      rawNodeCount: Object.keys(raw).length,
      excludedNodeCount: filtered.excludedNodeCount,
      includedModules: filtered.includedModules,
      excludedModules: filtered.excludedModules,
    },
  });

  const check = validateSupportedNodeManifest(manifest, filtered.objectInfo, {
    requireOfficial: true,
  });
  if (!check.ok) {
    console.error('OFFICIAL_VALIDATION_FAIL', check.errors);
    process.exit(1);
  }

  const paths = writeArtifacts(args.outDir, manifest, filtered.objectInfo);
  console.log(
    JSON.stringify(
      {
        ok: true,
        capture_status: CAPTURE_STATUS_OFFICIAL,
        lock_sha256: allowlist.lockSha256,
        docker_image: dockerImage,
        source,
        raw_node_count: Object.keys(raw).length,
        node_count: Object.keys(filtered.objectInfo).length,
        custom_node_dirs_included: manifest.catalog.custom_node_dirs_included,
        excluded_node_count: filtered.excludedNodeCount,
        ...paths,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
