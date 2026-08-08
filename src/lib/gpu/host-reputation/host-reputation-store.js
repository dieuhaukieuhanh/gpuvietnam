/**
 * Host reputation store — Supabase persistence with in-memory cache.
 *
 * On Vercel serverless, JSON files in /tmp are ephemeral (lost on cold-start / deploy).
 * Supabase (PostgreSQL) is the durable source of truth.
 *
 * Fallback: JSON file (tmp/host-reputation.json) if SUPABASE_SERVICE_ROLE_KEY is unset.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { HOST_REPUTATION } from './host-reputation-config.js';
import { applyTimeRecovery } from './host-reputation-score.js';
import { logHostReputationEvent } from './host-reputation-log.js';

// ── In-memory cache (always used, regardless of persistence backend) ────
/** @type {Map<string, import('./host-reputation-score.js').HostReputationRecord>} */
const memory = new Map();
let loaded = false;

// ── Supabase client (lazy) ────────────────────────────────────────────────
/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let _supabaseAdmin = null;

function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    // Dynamic import to avoid bundling supabase-js on cold paths
    const { createClient } = require('@supabase/supabase-js');
    _supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
    return _supabaseAdmin;
  } catch {
    return null;
  }
}

/** Whether we're using Supabase (vs JSON file fallback). */
function useSupabase() {
  // Also check that the table exists — if migration hasn't run yet, fall back
  return getSupabaseAdmin() != null;
}

// ── JSON fallback (existing behavior) ──────────────────────────────────────
function storePath() {
  const rel = process.env.HOST_REP_STORE_FILE || HOST_REPUTATION.storeFile || 'tmp/host-reputation.json';
  return isAbsolute(rel) ? rel : join(process.cwd(), rel);
}

function prune(now = Date.now()) {
  const maxAge = HOST_REPUTATION.pruneAfterMs;
  for (const [key, row] of memory.entries()) {
    if (!row) { memory.delete(key); continue; }
    const blacklistActive = Number(row.blacklistUntil || 0) > now;
    const age = now - Number(row.lastSeen || 0);
    if (!blacklistActive && age > maxAge) memory.delete(key);
  }
}

// ── Supabase load ──────────────────────────────────────────────────────────
async function loadFromSupabase() {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { data, error } = await admin.from('host_reputation').select('*');
    if (error) { console.warn('[host-reputation] Supabase load error:', error.message); return false; }
    const now = Date.now();
    for (const row of (data || [])) {
      if (!row || !row.host_key) continue;
      memory.set(row.host_key, {
        hostKey: row.host_key,
        provider: row.provider ?? undefined,
        hostId: row.host_id ?? undefined,
        serverId: row.server_id ?? undefined,
        region: row.region ?? undefined,
        gpuType: row.gpu_type ?? undefined,
        gpuLine: row.gpu_line ?? undefined,
        lastSeen: row.last_seen ?? undefined,
        reputationScore: row.reputation_score ?? 50,
        failureCount: row.failure_count ?? 0,
        successCount: row.success_count ?? 0,
        lastFailureReason: row.last_failure_reason ?? undefined,
        lastFailureCategory: row.last_failure_category ?? undefined,
        blacklistUntil: row.blacklist_until ?? undefined,
        consecutiveFailures: row.consecutive_failures ?? 0,
        lastReadyLatencyMs: row.last_ready_latency_ms ?? undefined,
        gpuName: row.gpu_name ?? undefined,
        vramGb: row.vram_gb ?? undefined,
        driverVersion: row.driver_version ?? undefined,
        cudaVersion: row.cuda_version ?? undefined,
        lastVerified: row.last_verified ?? undefined,
        verificationCount: row.verification_count ?? 0,
        passRate: row.pass_rate ?? undefined,
        avgBootSec: row.avg_boot_sec ?? undefined,
        avgLatencyMs: row.avg_latency_ms ?? undefined,
        benchmarkScore: row.benchmark_score ?? undefined,
        lastFailureAt: row.last_failure_at ?? undefined,
        cooldownUntil: row.cooldown_until ?? undefined,
      });
    }
    prune(now);
    return true;
  } catch (err) {
    console.warn('[host-reputation] Supabase load exception:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ── JSON fallback load ─────────────────────────────────────────────────────
function loadFromJsonFile() {
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
    console.warn('[host-reputation] JSON load failed:', error instanceof Error ? error.message : error);
  }
}

// ── Persist ────────────────────────────────────────────────────────────────
async function persistToSupabase() {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  for (const record of memory.values()) {
    if (!record?.hostKey) continue;
    try {
      await admin.from('host_reputation').upsert({
        host_key: record.hostKey,
        provider: record.provider ?? null,
        host_id: record.hostId ?? null,
        server_id: record.serverId ?? null,
        region: record.region ?? null,
        gpu_type: record.gpuType ?? null,
        gpu_line: record.gpuLine ?? null,
        last_seen: record.lastSeen ?? null,
        reputation_score: record.reputationScore ?? 50,
        failure_count: record.failureCount ?? 0,
        success_count: record.successCount ?? 0,
        last_failure_reason: record.lastFailureReason ?? null,
        last_failure_category: record.lastFailureCategory ?? null,
        blacklist_until: record.blacklistUntil ?? null,
        consecutive_failures: record.consecutiveFailures ?? 0,
        last_ready_latency_ms: record.lastReadyLatencyMs ?? null,
        gpu_name: record.gpuName ?? null,
        vram_gb: record.vramGb ?? null,
        driver_version: record.driverVersion ?? null,
        cuda_version: record.cudaVersion ?? null,
        last_verified: record.lastVerified ?? null,
        verification_count: record.verificationCount ?? 0,
        pass_rate: record.passRate ?? null,
        avg_boot_sec: record.avgBootSec ?? null,
        avg_latency_ms: record.avgLatencyMs ?? null,
        benchmark_score: record.benchmarkScore ?? null,
        last_failure_at: record.lastFailureAt ?? null,
        cooldown_until: record.cooldownUntil ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'host_key' });
    } catch (err) {
      console.warn('[host-reputation] Supabase persist error for', record.hostKey, ':', err instanceof Error ? err.message : String(err));
    }
  }
}

function persistToJsonFile() {
  try {
    prune();
    const file = storePath();
    const tmp = file + '.tmp';
    mkdirSync(dirname(file), { recursive: true });
    const payload = JSON.stringify({ updatedAt: new Date().toISOString(), entries: Array.from(memory.values()) }, null, 2);
    writeFileSync(tmp, payload, 'utf8');
    const backup = file.replace(/\.json$/, '.backup.json');
    try { if (existsSync(file)) writeFileSync(backup, readFileSync(file, 'utf8'), 'utf8'); } catch { /* best-effort */ }
    renameSync(tmp, file);
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
  } catch (error) {
    console.warn('[host-reputation] JSON persist failed:', error instanceof Error ? error.message : error);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function loadHostReputationStore() {
  if (loaded) return;
  loaded = true;

  if (useSupabase()) {
    // We initiate the async load but loadFromJsonFile synchronously below as fallback
    loadFromSupabase().then((ok) => {
      if (!ok) loadFromJsonFile();
    });
  }
  // Always load from JSON as immediate fallback (so sync callers get data)
  loadFromJsonFile();
}

/** Async version — waits for Supabase load. Use in API routes. */
export async function loadHostReputationStoreAsync() {
  if (loaded) return;
  loaded = true;
  if (useSupabase()) {
    const ok = await loadFromSupabase();
    if (!ok) loadFromJsonFile();
  } else {
    loadFromJsonFile();
  }
}

export function persistHostReputationStore() {
  if (useSupabase()) {
    // Fire-and-forget async persist — don't block the caller
    persistToSupabase().catch((err) => {
      console.warn('[host-reputation] persist async error:', err instanceof Error ? err.message : String(err));
    });
  }
  // Also write JSON backup (best-effort)
  persistToJsonFile();
}

export function recoverHostReputationStoreFromBackup() {
  // Supabase is the primary store now — backup recovery is JSON-only
  const file = storePath();
  const backup = file.replace(/\.json$/, '.backup.json');
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      if (raw && (Array.isArray(raw?.entries) || Array.isArray(raw))) return true;
    } catch { /* corrupt */ }
  }
  if (existsSync(backup)) {
    try {
      const raw = JSON.parse(readFileSync(backup, 'utf8'));
      if (raw && (Array.isArray(raw?.entries) || Array.isArray(raw))) {
        writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
        console.warn('[host-reputation] Recovered from backup file');
        return true;
      }
    } catch { /* ignore */ }
  }
  return false;
}

export function getHostReputationRecord(hostKey, now = Date.now()) {
  loadHostReputationStore();
  const key = String(hostKey ?? '').trim();
  if (!key) return null;
  const row = memory.get(key);
  if (!row) return null;
  const recovery = applyTimeRecovery(row, now);
  let next = recovery.record;
  if (next.blacklistUntil && next.blacklistUntil <= now) {
    next = { ...next, blacklistUntil: null };
  }
  if (recovery.recovered) {
    logHostReputationEvent('HOST_RECOVERY', {
      provider: next.provider, hostId: next.hostId, serverId: next.serverId,
      gpuType: next.gpuType, gpuLine: next.gpuLine, reason: 'exponential_idle_recovery',
      oldScore: recovery.oldScore, newScore: recovery.newScore,
      blacklistUntil: next.blacklistUntil ? new Date(next.blacklistUntil).toISOString() : null,
    }, 'Host reputation recovered toward neutral');
    memory.set(key, next);
    persistHostReputationStore();
  } else {
    memory.set(key, next);
  }
  return next;
}

export function putHostReputationRecord(record) {
  loadHostReputationStore();
  if (!record?.hostKey) return;
  memory.set(String(record.hostKey), record);
  persistHostReputationStore();
}

export function listHostReputationRecords() {
  loadHostReputationStore();
  prune();
  return Array.from(memory.values());
}

export function resetHostReputationStoreForTests() {
  memory.clear();
  loaded = false;
  _supabaseAdmin = null;
}
