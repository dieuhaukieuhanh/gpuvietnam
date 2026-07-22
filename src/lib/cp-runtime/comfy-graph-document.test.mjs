import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countLiteGraphNodes,
  decodeComfyCpBootstrapHash,
  encodeComfyCpBootstrapHash,
  isComfyPromptDocument,
  isLiteGraphDocument,
  normalizeCpWorkflowDocument,
  shouldInjectDocumentIntoComfy,
  shouldRejectEmptyDocumentOverwrite,
  toComfySyncPayload,
} from './comfy-graph-document.js';
import { upsertCpWorkflowDocument } from './workflow-sot.js';

describe('comfy-graph-document contract', () => {
  it('normalizes and round-trips LiteGraph-shaped documents', () => {
    const graph = {
      last_node_id: 2,
      last_link_id: 1,
      nodes: [
        { id: 1, type: 'EmptyLatentImage', pos: [0, 0], size: [140, 80], flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: [] },
      ],
      links: [],
      groups: [],
      config: {},
      extra: {},
      version: 0.4,
    };
    const normalized = normalizeCpWorkflowDocument(graph);
    assert.equal(isLiteGraphDocument(normalized), true);
    assert.equal(shouldInjectDocumentIntoComfy(normalized), true);
    assert.deepEqual(normalized.nodes[0].type, 'EmptyLatentImage');
  });

  it('detects Comfy API prompt maps but does not mark them injectable', () => {
    const prompt = {
      '1': { class_type: 'EmptyImage', inputs: { width: 64, height: 64 } },
      '2': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } },
    };
    assert.equal(isComfyPromptDocument(prompt), true);
    assert.equal(isLiteGraphDocument(prompt), false);
    assert.equal(shouldInjectDocumentIntoComfy(prompt), false);
  });

  it('skips empty documents for inject', () => {
    assert.equal(shouldInjectDocumentIntoComfy({}), false);
    assert.equal(shouldInjectDocumentIntoComfy(null), false);
    assert.equal(shouldInjectDocumentIntoComfy({ nodes: [], links: [], version: 0.4 }), false);
  });

  it('rejects empty LiteGraph overwrite of non-empty SoT', () => {
    const existing = { nodes: [{ id: 1, type: 'Note' }], version: 0.4 };
    assert.equal(countLiteGraphNodes(existing), 1);
    assert.equal(
      shouldRejectEmptyDocumentOverwrite(existing, { nodes: [], links: [], version: 0.4 }),
      true,
    );
    assert.equal(shouldRejectEmptyDocumentOverwrite(existing, {}), true);
    assert.equal(
      shouldRejectEmptyDocumentOverwrite(existing, {
        nodes: [{ id: 1, type: 'Note' }],
        version: 0.4,
      }),
      false,
    );
    assert.equal(
      shouldRejectEmptyDocumentOverwrite({ nodes: [] }, { nodes: [], version: 0.4 }),
      false,
    );
  });

  it('encodes and decodes bootstrap hash', () => {
    const hash = encodeComfyCpBootstrapHash({
      token: 'gvc.testtoken',
      workflowId: 'wf-1',
      apiBase: 'https://app.example.com/',
      revision: 3,
    });
    assert.match(hash, /^gvn_cp=/);
    const decoded = decodeComfyCpBootstrapHash(hash);
    assert.equal(decoded?.token, 'gvc.testtoken');
    assert.equal(decoded?.workflowId, 'wf-1');
    assert.equal(decoded?.apiBase, 'https://app.example.com');
    assert.equal(decoded?.revision, 3);
  });

  it('toComfySyncPayload sets inject only when LiteGraph has nodes', () => {
    const empty = toComfySyncPayload({
      id: 'wf-1',
      project_id: 'p1',
      name: 'Demo',
      document: { nodes: [], links: [], version: 0.4 },
      settings: {},
      revision: 2,
      status: 'draft',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(empty.schema, 'cp.comfy_sync.v1');
    assert.equal(empty.workflowId, 'wf-1');
    assert.equal(empty.inject, false);

    const withNodes = toComfySyncPayload({
      id: 'wf-1',
      document: { nodes: [{ id: 1, type: 'Note' }], version: 0.4 },
      revision: 3,
    });
    assert.equal(withNodes.inject, true);
  });
});

describe('upsertCpWorkflowDocument revision conflict', () => {
  function createSupabaseMock(initial) {
    const store = new Map([[initial.id, { ...initial }]]);
    return {
      from() {
        let filters = {};
        let op = 'select';
        let payload = null;
        const api = {
          select() {
            return api;
          },
          update(row) {
            op = 'update';
            payload = row;
            return api;
          },
          eq(col, val) {
            filters[col] = val;
            return api;
          },
          async single() {
            return api.maybeSingle();
          },
          async maybeSingle() {
            if (op === 'update') {
              for (const [id, row] of store) {
                if (filters.id && id !== filters.id) continue;
                if (filters.user_id && row.user_id !== filters.user_id) continue;
                const next = { ...row, ...payload };
                store.set(id, next);
                return { data: next, error: null };
              }
              return { data: null, error: { message: 'not found' } };
            }
            for (const [id, row] of store) {
              if (filters.id && id !== filters.id) continue;
              if (filters.user_id && row.user_id !== filters.user_id) continue;
              return { data: row, error: null };
            }
            return { data: null, error: null };
          },
        };
        return api;
      },
    };
  }

  it('rejects mismatched expectedRevision', async () => {
    const sb = createSupabaseMock({
      id: 'wf-1',
      user_id: 'u1',
      document: { nodes: [] },
      settings: {},
      revision: 2,
      name: 'A',
    });
    await assert.rejects(
      () =>
        upsertCpWorkflowDocument(sb, {
          workflowId: 'wf-1',
          userId: 'u1',
          document: { nodes: [{ id: 1 }] },
          expectedRevision: 1,
        }),
      (err) => err?.code === 'REVISION_CONFLICT',
    );
  });

  it('bumps revision when document changes with matching expectedRevision', async () => {
    const sb = createSupabaseMock({
      id: 'wf-1',
      user_id: 'u1',
      document: { nodes: [] },
      settings: {},
      revision: 2,
      name: 'A',
    });
    const row = await upsertCpWorkflowDocument(sb, {
      workflowId: 'wf-1',
      userId: 'u1',
      document: { nodes: [{ id: 1 }], version: 0.4 },
      expectedRevision: 2,
    });
    assert.equal(row.revision, 3);
    assert.equal(row.document.nodes[0].id, 1);
  });
});
