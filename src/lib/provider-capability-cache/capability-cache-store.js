import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { CAPABILITY_CACHE } from './capability-cache-config.js';

/** @type {Map<string, Record<string, unknown>>} */
const memory = new Map();
let loaded = false;

function storePath() {
  const rel = process.env.PROVIDER_CAP_CACHE_FILE || CAPABILITY_CACHE.storeFile;
  return isAbsolute(rel) ? rel : join(process.cwd(), rel);
}

export function loadCapabilityCacheStore() {
  if (loaded) return;
  loaded = true;
  try {
    const file = storePath();
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    for (const row of entries) {
      if (!row?.key) continue;
      memory.set(String(row.key), row);
    }
  } catch (error) {
    console.warn(
      '[capability-cache] load failed:',
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
      '[capability-cache] persist failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * @param {string} key
 */
export function getCapabilityCacheEntry(key) {
  loadCapabilityCacheStore();
  return memory.get(String(key)) ?? null;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} entry
 */
export function putCapabilityCacheEntry(key, entry) {
  loadCapabilityCacheStore();
  memory.set(String(key), { ...entry, key: String(key) });
  persist();
}

/**
 * @param {string | null | undefined} [keyPrefix]
 */
export function invalidateCapabilityCacheEntries(keyPrefix = null) {
  loadCapabilityCacheStore();
  if (!keyPrefix) {
    memory.clear();
    persist();
    return;
  }
  const prefix = String(keyPrefix).toLowerCase();
  for (const key of [...memory.keys()]) {
    if (key === prefix || key.startsWith(prefix)) memory.delete(key);
  }
  persist();
}

export function resetCapabilityCacheStoreForTests() {
  memory.clear();
  loaded = true;
  try {
    const file = storePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ updatedAt: new Date().toISOString(), entries: [] }, null, 2),
      'utf8',
    );
  } catch {
    /* ignore */
  }
}