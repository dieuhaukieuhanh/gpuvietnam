/**
 * Persist provision progress by subscriptionId (JSON + optional DB jsonb).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

const DEFAULT_STORE_REL = 'tmp/provision-progress.json';

/** @type {Map<string, Record<string, unknown>>} */
const memory = new Map();
let loaded = false;

function storePath() {
  const rel = process.env.PROVISION_PROGRESS_STORE_FILE || DEFAULT_STORE_REL;
  if (isAbsolute(rel)) return rel;
  // Vercel/Lambda: cwd is read-only; only /tmp is writable.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return join('/tmp', rel.replace(/^tmp[\\/]/, ''));
  }
  return join(process.cwd(), rel);
}

export function loadProvisionProgressStore() {
  if (loaded) return;
  loaded = true;
  try {
    const file = storePath();
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    for (const row of entries) {
      if (!row?.subscriptionId) continue;
      memory.set(String(row.subscriptionId), row);
    }
  } catch (error) {
    console.warn(
      '[provision-progress] load failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

function persist() {
  try {
    const file = storePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          entries: Array.from(memory.values()),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (error) {
    console.warn(
      '[provision-progress] persist failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Merge disk → memory by updatedAt so poll handlers see writes from other
 * request workers / cold starts (load-once was leaving UI stuck on step 1).
 */
function mergeStoreFromDisk() {
  try {
    const file = storePath();
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    for (const row of entries) {
      if (!row?.subscriptionId) continue;
      const id = String(row.subscriptionId);
      const existing = memory.get(id);
      const rowUpdated = Number(row.updatedAt) || 0;
      const existingUpdated = Number(existing?.updatedAt) || 0;
      if (!existing || rowUpdated >= existingUpdated) {
        memory.set(id, row);
      }
    }
  } catch {
    /* ignore corrupt / race */
  }
}

/**
 * @param {string} subscriptionId
 * @returns {Record<string, unknown> | null}
 */
export function getProvisionProgressRecord(subscriptionId) {
  loadProvisionProgressStore();
  mergeStoreFromDisk();
  const key = String(subscriptionId ?? '').trim();
  if (!key) return null;
  return memory.get(key) ?? null;
}

/**
 * @param {string} subscriptionId
 * @param {Record<string, unknown>} record
 */
export function putProvisionProgressRecord(subscriptionId, record) {
  loadProvisionProgressStore();
  const key = String(subscriptionId ?? '').trim();
  if (!key) return;
  memory.set(key, { ...record, subscriptionId: key });
  persist();
}

/**
 * @param {string} subscriptionId
 */
export function clearProvisionProgressRecord(subscriptionId) {
  loadProvisionProgressStore();
  const key = String(subscriptionId ?? '').trim();
  if (!key) return;
  memory.delete(key);
  persist();
}

export function resetProvisionProgressStoreForTests() {
  memory.clear();
  loaded = false;
  try {
    const file = storePath();
    if (existsSync(file)) {
      // Avoid reloading stale RUNNING rows that block stage advances in tests.
      writeFileSync(file, JSON.stringify({ entries: [] }), 'utf8');
    }
  } catch {
    /* ignore */
  }
}


/**
 * Best-effort write to subscriptions.provisioning_progress jsonb.
 * @param {import('@supabase/supabase-js').SupabaseClient | null | undefined} supabaseAdmin
 * @param {string} subscriptionId
 * @param {Record<string, unknown> | null} record
 */
export async function persistProvisionProgressToDb(supabaseAdmin, subscriptionId, record) {
  if (!supabaseAdmin || !subscriptionId) return false;
  try {
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ provisioning_progress: record })
      .eq('id', String(subscriptionId));
    if (error) {
      console.warn(
        '[provision-progress] DB persist failed:',
        error.message || error,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      '[provision-progress] DB persist exception:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Load DB row without clobbering a newer in-memory/file snapshot.
 * @param {import('@supabase/supabase-js').SupabaseClient | null | undefined} supabaseAdmin
 * @param {string} subscriptionId
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function loadProvisionProgressFromDb(supabaseAdmin, subscriptionId) {
  if (!supabaseAdmin || !subscriptionId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('provisioning_progress')
      .eq('id', String(subscriptionId))
      .maybeSingle();
    if (error || !data?.provisioning_progress) return null;
    const row =
      typeof data.provisioning_progress === 'object'
        ? /** @type {Record<string, unknown>} */ (data.provisioning_progress)
        : null;
    if (!row) return null;

    const key = String(subscriptionId);
    const existing = getProvisionProgressRecord(key);
    const rowUpdated = Number(row.updatedAt) || 0;
    const existingUpdated = Number(existing?.updatedAt) || 0;
    if (!existing || rowUpdated >= existingUpdated) {
      putProvisionProgressRecord(key, row);
      return row;
    }
    return existing;
  } catch {
    return null;
  }
}