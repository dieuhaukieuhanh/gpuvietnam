import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '../../.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  let v = t.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  process.env[t.slice(0, i).trim()] = v;
}

const token = readFileSync(join(here, '../../tmp/a05-token.txt'), 'utf8').trim();
const WORKFLOW_ID = 'f287ec3d-f268-4ddb-a0cd-460deec8e5bf';
const MARKER = `a05-browser-reload-${Date.now()}`;
const document = {
  last_node_id: 3,
  last_link_id: 1,
  nodes: [
    {
      id: 1,
      type: 'EmptyLatentImage',
      pos: [120, 200],
      size: [270, 106],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [1], slot_index: 0 }],
      properties: {},
      widgets_values: [768, 512, 1],
    },
    {
      id: 2,
      type: 'KSampler',
      pos: [480, 180],
      size: [270, 262],
      flags: {},
      order: 2,
      mode: 0,
      inputs: [
        { name: 'model', type: 'MODEL', link: null },
        { name: 'positive', type: 'CONDITIONING', link: null },
        { name: 'negative', type: 'CONDITIONING', link: null },
        { name: 'latent_image', type: 'LATENT', link: 1 },
      ],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: null }],
      properties: {},
      widgets_values: [0, 'randomize', 20, 8, 'euler', 'simple', 1],
    },
    {
      id: 3,
      type: 'CLIPTextEncode',
      pos: [480, 40],
      size: [400, 200],
      flags: {},
      order: 1,
      mode: 0,
      inputs: [{ name: 'clip', type: 'CLIP', link: null }],
      outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: null }],
      properties: {},
      widgets_values: ['a05 offline edit ok'],
    },
  ],
  links: [[1, 1, 0, 2, 3, 'LATENT']],
  groups: [],
  config: {},
  extra: { a05: MARKER },
  version: 0.4,
};

const patch = await fetch('http://127.0.0.1:5190/lab/cp/api/cp/comfy-sync', {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ workflowId: WORKFLOW_ID, document }),
});
const saved = await patch.json();
const out = {
  status: patch.status,
  revision: saved.workflow?.revision,
  marker: MARKER,
  types: saved.workflow?.document?.nodes?.map((n) => n.type),
};
writeFileSync(join(here, 'results/browser-cp-save.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
