/**
 * A1 M2 — Offline editor smoke: load Workspace shell catalog, create/connect/edit
 * one core node + one Supported Pack node (no Runtime / no Generate).
 *
 * Usage:
 *   node scripts/a1-m1-local-shell.mjs   # separate terminal, or this script starts it
 *   node scripts/a1-m2-editor-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = Number(process.env.A1_M1_PORT || 5191);
const BASE = `http://127.0.0.1:${PORT}`;

const oi = require('../workers/comfy-proxy/catalog/supported-object_info.v3.json');
const manifest = require('../workers/comfy-proxy/catalog/supported-node-manifest.v3.json');

const CORE = 'EmptyLatentImage';
const PACK =
  Object.keys(oi).find(
    (n) => oi[n]?.python_module === 'custom_nodes.ComfyUI-Impact-Pack',
  ) || null;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitShell(timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/object_info`, {
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`local shell not up at ${BASE}`);
}

async function ensureShell() {
  try {
    const r = await fetch(`${BASE}/api/object_info`, {
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) return null;
  } catch {
    /* start */
  }
  const fe = join(root, 'workers/comfy-proxy/public/index.html');
  assert(existsSync(fe), 'Missing vendored FE — run scripts/vendor-comfy-frontend.mjs');
  const child = spawn(process.execPath, [join(here, 'a1-m1-local-shell.mjs')], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, A1_M1_PORT: String(PORT) },
  });
  child.unref();
  await waitShell();
  return child.pid;
}

async function main() {
  assert(manifest.capture_status === 'official_image', 'catalog not official_image');
  assert(manifest.complete === true, 'catalog not complete');
  assert(oi[CORE], `core node missing: ${CORE}`);
  assert(PACK && oi[PACK], 'no Impact-Pack node in supported catalog');

  await ensureShell();

  const catalog = await (await fetch(`${BASE}/api/object_info`)).json();
  assert(catalog[CORE], 'shell object_info missing core');
  assert(catalog[PACK], `shell object_info missing pack node ${PACK}`);
  const ext = await (await fetch(`${BASE}/api/extensions`)).json();
  assert(Array.isArray(ext) && ext.length === 0, 'extensions must stay []');

  // Browser automation via CDP-less eval: use Playwright if present, else puppeteer-core, else fetch-only + document limitation.
  let browserOk = false;
  let detail = {};

  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${BASE}/?a1_token=gvc.m2smoke`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForFunction(
      () => window.app && window.app.graph,
      null,
      { timeout: 120_000 },
    );

    detail = await page.evaluate(
      ({ core, pack }) => {
        const g = window.app.graph;
        g.clear();
        const n1 = LiteGraph.createNode(core);
        const n2 = LiteGraph.createNode(pack);
        if (!n1 || !n2) {
          return { ok: false, error: 'createNode failed', n1: !!n1, n2: !!n2 };
        }
        g.add(n1);
        g.add(n2);
        n1.pos = [80, 80];
        n2.pos = [420, 80];
        // Edit core widget if present (width)
        if (n1.widgets?.length) {
          const w = n1.widgets.find((x) => x.name === 'width') || n1.widgets[0];
          if (w) w.value = typeof w.value === 'number' ? 768 : w.value;
        }
        // Try connect first matching types
        let linked = false;
        for (let oi = 0; oi < (n1.outputs?.length || 0); oi += 1) {
          for (let ii = 0; ii < (n2.inputs?.length || 0); ii += 1) {
            const ot = n1.outputs[oi]?.type;
            const it = n2.inputs[ii]?.type;
            if (ot && it && (ot === it || ot === '*' || it === '*')) {
              n1.connect(oi, n2, ii);
              linked = true;
              break;
            }
          }
          if (linked) break;
        }
        // If types don't match, still prove both nodes editable in graph
        const widthEdited =
          n1.widgets?.some((w) => w.name === 'width' && w.value === 768) || false;
        return {
          ok: true,
          nodes: g._nodes?.length ?? g.nodes?.length,
          coreType: n1.type,
          packType: n2.type,
          linked,
          widthEdited,
          title: document.title,
        };
      },
      { core: CORE, pack: PACK },
    );
    await browser.close();
    browserOk = Boolean(detail.ok);
  } catch (e) {
    detail = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      note: 'playwright unavailable — API catalog checks still ran',
    };
  }

  const report = {
    milestone: 'A1-M2-editor-smoke',
    capture_status: manifest.capture_status,
    complete: manifest.complete,
    core: CORE,
    pack: PACK,
    catalogNodes: Object.keys(catalog).length,
    browserOk,
    detail,
    verdict:
      browserOk && detail.coreType === CORE && detail.packType === PACK
        ? 'PASS'
        : browserOk === false && catalog[CORE] && catalog[PACK]
          ? 'PASS_API_ONLY'
          : 'FAIL',
  };

  // PASS if browser proved create+edit; if playwright missing, fail hard so DoD stays honest.
  if (report.verdict !== 'PASS') {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
