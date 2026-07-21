import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCpWorkflow,
  upsertCpWorkflowDocument,
  toWorkflowClientSyncPayload,
} from './workflow-sot.js';
import {
  saveProjectSnapshot,
  restoreProjectSnapshot,
  listProjectSnapshots,
} from './project-snapshot.js';

/**
 * Minimal Supabase mock for cp_workflows / projects / project_snapshots.
 */
function createSupabaseMock() {
  /** @type {Map<string, object>} */
  const tables = new Map([
    ['cp_workflows', new Map()],
    ['projects', new Map()],
    ['project_snapshots', new Map()],
  ]);

  function from(table) {
    const store = tables.get(table);
    if (!store) throw new Error(`unknown table ${table}`);

    /** @type {Record<string, unknown>} */
    let filters = {};
    let op = 'select';
    let payload = null;
    let limitN = null;
    let orderAsc = true;

    const api = {
      select() {
        op = op === 'insert' || op === 'update' ? op : 'select';
        return api;
      },
      insert(row) {
        op = 'insert';
        payload = row;
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
      order() {
        return api;
      },
      limit(n) {
        limitN = n;
        return api;
      },
      async single() {
        const r = await api.maybeSingle();
        if (!r.data) return { data: null, error: { message: 'not found' } };
        return r;
      },
      async maybeSingle() {
        if (op === 'insert') {
          const id = payload.id || `${table}_${store.size + 1}`;
          const row = { id, ...payload };
          store.set(id, row);
          return { data: row, error: null };
        }
        if (op === 'update') {
          for (const [id, row] of store) {
            let ok = true;
            for (const [k, v] of Object.entries(filters)) {
              if (row[k] !== v && !(k === 'id' && id === v)) ok = false;
            }
            if (filters.id && id !== filters.id) ok = false;
            if (filters.user_id && row.user_id !== filters.user_id) ok = false;
            if (!ok) continue;
            const next = { ...row, ...payload };
            store.set(id, next);
            return { data: next, error: null };
          }
          return { data: null, error: { message: 'not found' } };
        }
        // select
        for (const [id, row] of store) {
          let ok = true;
          for (const [k, v] of Object.entries(filters)) {
            if (k === 'id' && id !== v) ok = false;
            else if (k !== 'id' && row[k] !== v) ok = false;
          }
          if (ok) return { data: row, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve, reject) {
        // thenable for await on list queries
        return (async () => {
          if (op === 'insert') {
            const id = `${table}_${store.size + 1}`;
            const row = { id, ...payload };
            store.set(id, row);
            return { data: [row], error: null };
          }
          const rows = [];
          for (const [id, row] of store) {
            let ok = true;
            for (const [k, v] of Object.entries(filters)) {
              if (k === 'id' && id !== v) ok = false;
              else if (k !== 'id' && row[k] !== v) ok = false;
            }
            if (ok) rows.push(row);
          }
          const sliced = limitN != null ? rows.slice(0, limitN) : rows;
          return { data: sliced, error: null };
        })().then(resolve, reject);
      },
    };
    return api;
  }

  return {
    from,
    _tables: tables,
    seed(table, id, row) {
      tables.get(table).set(id, { id, ...row });
    },
  };
}

describe('cp-runtime B2.1 + B2.2.5 with mock DB', () => {
  it('creates and upserts workflow document with revision bump', async () => {
    const db = createSupabaseMock();
    const created = await createCpWorkflow(db, {
      userId: 'u1',
      projectId: 'p1',
      name: 'A',
      document: { a: 1 },
    });
    assert.equal(created.revision, 1);

    const updated = await upsertCpWorkflowDocument(db, {
      workflowId: created.id,
      userId: 'u1',
      document: { a: 2 },
    });
    assert.equal(updated.revision, 2);
    assert.deepEqual(updated.document, { a: 2 });

    const sync = toWorkflowClientSyncPayload(updated);
    assert.equal(sync.revision, 2);
  });

  it('save + restore project snapshot reapplies document', async () => {
    const db = createSupabaseMock();
    db.seed('projects', 'p1', { user_id: 'u1', name: 'Proj', metadata: {} });
    const wf = await createCpWorkflow(db, {
      userId: 'u1',
      projectId: 'p1',
      name: 'WF',
      document: { v: 1 },
      settings: { s: true },
    });

    const snap = await saveProjectSnapshot(db, {
      userId: 'u1',
      projectId: 'p1',
      cpWorkflowId: wf.id,
      label: 'Checkpoint',
    });
    assert.equal(snap.label, 'Checkpoint');

    await upsertCpWorkflowDocument(db, {
      workflowId: wf.id,
      userId: 'u1',
      document: { v: 99 },
    });

    const restored = await restoreProjectSnapshot(db, {
      userId: 'u1',
      snapshotId: snap.id,
    });
    assert.deepEqual(restored.workflow.document, { v: 1 });

    const listed = await listProjectSnapshots(db, 'u1', 'p1');
    assert.equal(listed.length, 1);
  });
});
