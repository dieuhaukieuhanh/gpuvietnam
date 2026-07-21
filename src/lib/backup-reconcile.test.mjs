import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { upsertBackupStorageFiles } from './backup-reconcile.js';

function createStorageMock(existing = []) {
  const rows = existing.map((r) => ({ ...r }));
  return {
    rows,
    from(table) {
      assert.equal(table, 'storage_files');
      const state = { filters: [], patch: null, mode: null, insertRows: null };
      const builder = {
        select() {
          state.mode = 'select';
          return builder;
        },
        insert(data) {
          state.mode = 'insert';
          state.insertRows = data;
          return builder;
        },
        update(patch) {
          state.mode = 'update';
          state.patch = patch;
          return builder;
        },
        eq(col, val) {
          state.filters.push([col, val]);
          return builder;
        },
        then(resolve, reject) {
          try {
            if (state.mode === 'select') {
              let out = rows;
              for (const [col, val] of state.filters) {
                out = out.filter((r) => String(r[col]) === String(val));
              }
              resolve({ data: out, error: null });
              return;
            }
            if (state.mode === 'insert') {
              for (const row of state.insertRows) {
                rows.push({ id: `new-${rows.length}`, ...row });
              }
              resolve({ data: state.insertRows, error: null });
              return;
            }
            if (state.mode === 'update') {
              const idEq = state.filters.find((f) => f[0] === 'id');
              const row = rows.find((r) => r.id === idEq?.[1]);
              if (row) Object.assign(row, state.patch);
              resolve({ data: row, error: null });
              return;
            }
            resolve({ data: null, error: null });
          } catch (e) {
            reject(e);
          }
        },
      };
      return builder;
    },
  };
}

describe('upsertBackupStorageFiles', () => {
  it('inserts new backup paths', async () => {
    const sb = createStorageMock([]);
    const r = await upsertBackupStorageFiles(sb, 'u1', [
      { relativeKey: 'outputs/a.png', sizeBytes: 10 },
      { relativeKey: 'workflows/b.json', sizeBytes: 20 },
    ]);
    assert.equal(r.inserted, 2);
    assert.equal(r.updated, 0);
    assert.equal(sb.rows.length, 2);
    assert.equal(sb.rows[0].category, 'output');
    assert.equal(sb.rows[1].category, 'workflow');
  });

  it('updates size when path exists', async () => {
    const sb = createStorageMock([
      {
        id: '1',
        user_id: 'u1',
        file_path: 'outputs/a.png',
        file_size_bytes: 10,
        storage_type: 'backup',
      },
    ]);
    const r = await upsertBackupStorageFiles(sb, 'u1', [
      { relativeKey: 'outputs/a.png', sizeBytes: 99 },
    ]);
    assert.equal(r.inserted, 0);
    assert.equal(r.updated, 1);
    assert.equal(sb.rows[0].file_size_bytes, 99);
  });

  it('skips invalid keys', async () => {
    const sb = createStorageMock([]);
    const r = await upsertBackupStorageFiles(sb, 'u1', [
      { relativeKey: '../etc/passwd', sizeBytes: 1 },
      { relativeKey: 'secrets/x', sizeBytes: 1 },
    ]);
    assert.equal(r.inserted, 0);
  });
});
