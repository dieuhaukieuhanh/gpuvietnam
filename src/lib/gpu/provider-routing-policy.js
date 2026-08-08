/**
 * Provider routing policy — single source of truth (Admin → Hạ tầng).
 *
 * Scope: NEW rents / Start attempts only. Running customer sessions are untouched.
 *
 * Storage: Supabase `provider_routing_policy` (id=1), JSON file fallback for VPS.
 * Cache: short TTL so Admin "Lưu" applies to the next Start within seconds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

/** @typedef {'vast'|'clore'|'salad'} ProviderId */

/** @typedef {{
 *   providers: Record<ProviderId, boolean>;
 *   priority: ProviderId[];
 *   updatedAt?: string | null;
 *   updatedBy?: string | null;
 *   source?: 'supabase'|'file'|'default'|'cache';
 * }} ProviderRoutingPolicy */

export const PROVIDER_IDS = /** @type {const} */ (['vast', 'clore', 'salad']);

export const PROVIDER_ROUTING_POLICY_PATH = path.resolve(
  process.env.PROVIDER_ROUTING_POLICY_PATH || 'tmp/provider-routing-policy.json',
);

/** Default matches current prod ops: Vast-only Start. */
export const DEFAULT_PROVIDER_ROUTING_POLICY = /** @type {ProviderRoutingPolicy} */ ({
  providers: { vast: true, clore: false, salad: false },
  priority: ['vast', 'clore', 'salad'],
  updatedAt: null,
  updatedBy: null,
  source: 'default',
});

const CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.PROVIDER_ROUTING_POLICY_CACHE_MS ?? 5_000),
);

/** @type {{ policy: ProviderRoutingPolicy; loadedAt: number } | null} */
let cache = null;

let _supabase = null;

function getSupabaseAdmin() {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    _supabase = createClient(url, key, { auth: { persistSession: false } });
    return _supabase;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {ProviderRoutingPolicy}
 */
export function normalizeProviderRoutingPolicy(raw) {
  const base = {
    providers: { ...DEFAULT_PROVIDER_ROUTING_POLICY.providers },
    priority: [...DEFAULT_PROVIDER_ROUTING_POLICY.priority],
    updatedAt: null,
    updatedBy: null,
    source: 'default',
  };
  if (raw == null || typeof raw !== 'object') return base;

  const obj = /** @type {Record<string, unknown>} */ (raw);
  const providersIn =
    obj.providers && typeof obj.providers === 'object' && !Array.isArray(obj.providers)
      ? /** @type {Record<string, unknown>} */ (obj.providers)
      : {};
  /** @type {Record<ProviderId, boolean>} */
  const providers = { vast: false, clore: false, salad: false };
  for (const id of PROVIDER_IDS) {
    providers[id] = providersIn[id] === true;
  }
  // Safety: never allow all-off — fall back to Vast.
  if (!providers.vast && !providers.clore && !providers.salad) {
    providers.vast = true;
  }

  let priority = Array.isArray(obj.priority)
    ? obj.priority.map((p) => String(p).toLowerCase()).filter((p) => PROVIDER_IDS.includes(/** @type {ProviderId} */ (p)))
    : [];
  // Ensure every known id appears once (enabled or not — attempt filters later).
  for (const id of PROVIDER_IDS) {
    if (!priority.includes(id)) priority.push(id);
  }
  priority = priority.filter((id, i) => priority.indexOf(id) === i);

  return {
    providers,
    priority: /** @type {ProviderId[]} */ (priority),
    updatedAt:
      obj.updatedAt != null
        ? String(obj.updatedAt)
        : obj.updated_at != null
          ? String(obj.updated_at)
          : null,
    updatedBy:
      obj.updatedBy != null
        ? String(obj.updatedBy)
        : obj.updated_by != null
          ? String(obj.updated_by)
          : null,
    source: typeof obj.source === 'string' ? obj.source : 'default',
  };
}

/** @returns {ProviderRoutingPolicy} */
function readPolicyFromFile() {
  try {
    if (!fs.existsSync(PROVIDER_ROUTING_POLICY_PATH)) {
      return { ...normalizeProviderRoutingPolicy(null), source: 'default' };
    }
    const parsed = JSON.parse(fs.readFileSync(PROVIDER_ROUTING_POLICY_PATH, 'utf8'));
    return { ...normalizeProviderRoutingPolicy(parsed), source: 'file' };
  } catch (err) {
    console.warn(
      '[provider-policy] file read failed:',
      err instanceof Error ? err.message : String(err),
    );
    return { ...normalizeProviderRoutingPolicy(null), source: 'default' };
  }
}

/**
 * Sync snapshot for resolveProviderAttemptOrder (cache or default).
 * @returns {ProviderRoutingPolicy}
 */
export function getProviderRoutingPolicySync() {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return { ...cache.policy, source: 'cache' };
  }
  if (cache) return { ...cache.policy, source: 'cache' };
  const fromFile = readPolicyFromFile();
  cache = { policy: fromFile, loadedAt: Date.now() };
  return fromFile;
}

/**
 * Refresh from Supabase (SoT), then JSON. Call before new rent / Start.
 * @returns {Promise<ProviderRoutingPolicy>}
 */
export async function loadProviderRoutingPolicyAsync() {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return { ...cache.policy, source: 'cache' };
  }

  const admin = getSupabaseAdmin();
  if (admin) {
    try {
      const { data, error } = await admin
        .from('provider_routing_policy')
        .select('providers, priority, updated_at, updated_by')
        .eq('id', 1)
        .maybeSingle();
      if (!error && data) {
        const policy = normalizeProviderRoutingPolicy({
          providers: data.providers,
          priority: data.priority,
          updated_at: data.updated_at,
          updated_by: data.updated_by,
          source: 'supabase',
        });
        cache = { policy, loadedAt: Date.now() };
        // Best-effort mirror for VPS local tools.
        try {
          writePolicyFile(policy);
        } catch {
          /* ignore */
        }
        return policy;
      }
    } catch (err) {
      console.warn(
        '[provider-policy] supabase read failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const fromFile = readPolicyFromFile();
  cache = { policy: fromFile, loadedAt: Date.now() };
  return fromFile;
}

/** @param {ProviderRoutingPolicy} policy */
function writePolicyFile(policy) {
  const dir = path.dirname(PROVIDER_ROUTING_POLICY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    providers: policy.providers,
    priority: policy.priority,
    updatedAt: policy.updatedAt,
    updatedBy: policy.updatedBy,
  };
  const tmp = PROVIDER_ROUTING_POLICY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, PROVIDER_ROUTING_POLICY_PATH);
}

/**
 * @param {ProviderRoutingPolicy} policy
 * @param {{ updatedBy?: string | null }} [meta]
 * @returns {Promise<ProviderRoutingPolicy>}
 */
export async function writeProviderRoutingPolicyAsync(policy, meta = {}) {
  const normalized = normalizeProviderRoutingPolicy(policy);
  const updatedAt = new Date().toISOString();
  const updatedBy = meta.updatedBy != null ? String(meta.updatedBy) : null;
  const toStore = { ...normalized, updatedAt, updatedBy, source: 'supabase' };

  const admin = getSupabaseAdmin();
  let supabaseOk = false;
  if (admin) {
    const { error } = await admin.from('provider_routing_policy').upsert(
      {
        id: 1,
        providers: toStore.providers,
        priority: toStore.priority,
        updated_at: updatedAt,
        updated_by: updatedBy,
      },
      { onConflict: 'id' },
    );
    if (error) {
      throw new Error(`provider_routing_policy upsert failed: ${error.message}`);
    }
    supabaseOk = true;
  }

  try {
    writePolicyFile(toStore);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (supabaseOk || process.env.VERCEL) {
      console.warn('[provider-policy] JSON write non-fatal:', msg);
    } else {
      throw err instanceof Error ? err : new Error(msg);
    }
  }

  cache = { policy: toStore, loadedAt: Date.now() };
  return toStore;
}

/** @internal */
export function _resetProviderRoutingPolicyCacheForTests() {
  cache = null;
}

/**
 * @param {ProviderRoutingPolicy} policy
 * @param {ProviderId} id
 */
export function isProviderEnabledInPolicy(policy, id) {
  return policy?.providers?.[id] === true;
}
