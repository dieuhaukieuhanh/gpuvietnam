/**
 * Persistent JSON store for host reputation records.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { HOST_REPUTATION } from './host-reputation-config.js';
import { applyTimeRecovery } from './host-reputation-score.js';
import { logHostReputationEvent } from './host-reputation-log.js';

/** @type {Map<string, import('./host-reputation-score.js').HostReputationRecord>} */
const memory = new Map();
let loaded = false;

function storePath() {
  const rel = process.env.HOST_REP_STORE_FILE || HOST_REPUTATION.storeFile || 'tmp/host-reputation.json';
  return isAbsolute(rel) ? rel : join(process.cwd(), rel);
}

function prune(now = Date.now()) {
  const maxAge = HOST_REPUTATION.pruneAfterMs;
  for (const [key, row] of memory.entries()) {
    if (!row) {
      memory.delete(key);
      continue;
    }
    const blacklistActive = Number(row.blacklistUntil || 0) > now;
    const age = now - Number(row.lastSeen || 0);
    if (!blacklistActive && age > maxAge) memory.delete(key);
  }
}

export function loadHostReputationStore() {
  if (loaded) return;
  loaded = true;
  try {
    const file = storePath();
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const entries = Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw) ? raw : [];
    const now = Date.now();
    for (const row of entries) {
      if (!row || typeof row !== 'object') continue;
      const hostKey = String(row.hostKey ?? '').trim();
      if (!hostKey) continue;
      memory.set(hostKey, /** @type {any} */ (row));
    }
    prune(now);
  } catch (error) {
    console.warn(
      '[host-reputation] load failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

export function persistHostReputationStore() {
  try {
    prune();
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
      '[host-reputation] persist failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * @param {string} hostKey
 * @param {number} [now]
 */
export function getHostReputationRecord(hostKey, now = Date.now()) {
  loadHostReputationStore();
  const key = String(hostKey ?? '').trim();
  if (!key) return null;
  const row = memory.get(key);
  if (!row) return null;
  const recovery = applyTimeRecovery(row, now);
  /** @type {import('./host-reputation-score.js').HostReputationRecord} */
  let next = recovery.record;
  if (next.blacklistUntil && next.blacklistUntil <= now) {
    next = { ...next, blacklistUntil: null };
  }
  if (recovery.recovered) {
    logHostReputationEvent(
      'HOST_RECOVERY',
      {
        provider: next.provider,
        hostId: next.hostId,
        serverId: next.serverId,
        gpuType: next.gpuType,
        gpuLine: next.gpuLine,
        reason: 'exponential_idle_recovery',
        oldScore: recovery.oldScore,
        newScore: recovery.newScore,
        blacklistUntil: next.blacklistUntil
          ? new Date(next.blacklistUntil).toISOString()
          : null,
      },
      'Host reputation recovered toward neutral',
    );
    // Persist soft recovery so idle progress is not lost across restarts
    memory.set(key, next);
    persistHostReputationStore();
  } else {
    memory.set(key, next);
  }
  return next;
}

/**
 * @param {import('./host-reputation-score.js').HostReputationRecord} record
 */
export function putHostReputationRecord(record) {
  loadHostReputationStore();
  if (!record?.hostKey) return;
  memory.set(String(record.hostKey), record);
  persistHostReputationStore();
}

/** @returns {import('./host-reputation-score.js').HostReputationRecord[]} */
export function listHostReputationRecords() {
  loadHostReputationStore();
  prune();
  return Array.from(memory.values());
}

/** Test helper */
export function resetHostReputationStoreForTests() {
  memory.clear();
  loaded = false;
}