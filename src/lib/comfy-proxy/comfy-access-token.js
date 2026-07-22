import crypto from 'crypto';

import {
  COMFY_ACCESS_TOKEN_PREFIX,
  DEFAULT_COMFY_ACCESS_TTL_SECONDS,
  buildComfyWorkEnterUrl,
  isComfyProxyEnabled,
  resolveComfyProxyBaseUrl,
} from './comfy-proxy-config.js';

/**
 * @param {string} rawToken
 */
export function hashComfyAccessToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function generateRawComfyAccessToken() {
  return `${COMFY_ACCESS_TOKEN_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
}

/**
 * Normalize upstream Comfy base URL (no trailing slash).
 * @param {string} url
 * @returns {string | null}
 */
export function normalizeUpstreamComfyUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    parsed.search = '';
    let href = parsed.toString().replace(/\/$/, '');
    return href;
  } catch {
    return null;
  }
}

/**
 * Optional Cloudflare KV mirror for edge lookups.
 * @param {string} tokenHash
 * @param {{ upstream: string | null; userId: string; machineId: string | null; exp: number; mode: string }} payload
 * @param {number} ttlSeconds
 */
function resolveCloudflareApiToken() {
  return String(process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
}

async function mirrorTokenToCloudflareKv(tokenHash, payload, ttlSeconds) {
  const accountId = String(process.env.CF_ACCOUNT_ID ?? '').trim();
  const apiToken = resolveCloudflareApiToken();
  const namespaceId = String(process.env.CF_KV_NAMESPACE_ID ?? '').trim();
  if (!accountId || !apiToken || !namespaceId) return;

  const key = `comfy:${tokenHash}`;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}?expiration_ttl=${Math.max(60, ttlSeconds)}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn('[comfy-proxy] CF KV put failed', res.status);
    }
  } catch (error) {
    console.warn('[comfy-proxy] CF KV put error', error);
  }
}

/**
 * @param {string} tokenHash
 */
async function deleteTokenFromCloudflareKv(tokenHash) {
  const accountId = String(process.env.CF_ACCOUNT_ID ?? '').trim();
  const apiToken = resolveCloudflareApiToken();
  const namespaceId = String(process.env.CF_KV_NAMESPACE_ID ?? '').trim();
  if (!accountId || !apiToken || !namespaceId) return;

  const key = `comfy:${tokenHash}`;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiToken}` },
    });
  } catch (error) {
    console.warn('[comfy-proxy] CF KV delete error', error);
  }
}

/**
 * Mint a short-lived access token and return brand work URL.
 *
 * A1 M1: pass `mode: 'editor'` (or omit upstreamUrl) for Workspace without Runtime.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   machineId?: string | null;
 *   upstreamUrl?: string | null;
 *   mode?: 'runtime' | 'editor';
 *   ttlSeconds?: number;
 * }} input
 * @returns {Promise<{ token: string; workUrl: string; expiresAt: string; mode: 'runtime' | 'editor' }>}
 */
export async function issueComfyAccessToken(supabaseAdmin, input) {
  if (!isComfyProxyEnabled()) {
    throw new Error('Comfy proxy is disabled');
  }
  if (!resolveComfyProxyBaseUrl()) {
    throw new Error('COMFY_PROXY_BASE_URL is not configured');
  }

  const mode =
    input.mode === 'editor' || !String(input.upstreamUrl ?? '').trim()
      ? 'editor'
      : 'runtime';

  const upstream =
    mode === 'editor' ? null : normalizeUpstreamComfyUrl(input.upstreamUrl);
  if (mode === 'runtime' && !upstream) {
    throw new Error('Invalid upstream Comfy URL');
  }

  const machineId =
    mode === 'editor'
      ? null
      : String(input.machineId ?? '').trim() || null;
  if (mode === 'runtime' && !machineId) {
    throw new Error('machineId is required for runtime Comfy access tokens');
  }

  const ttlSeconds = Math.max(
    60,
    Number(input.ttlSeconds ?? DEFAULT_COMFY_ACCESS_TTL_SECONDS) || DEFAULT_COMFY_ACCESS_TTL_SECONDS,
  );
  const rawToken = generateRawComfyAccessToken();
  const tokenHash = hashComfyAccessToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const { error } = await supabaseAdmin.from('comfy_access_tokens').insert({
    user_id: input.userId,
    machine_id: machineId,
    token_hash: tokenHash,
    upstream_url: upstream,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(error.message || 'Failed to store comfy access token');
  }

  await mirrorTokenToCloudflareKv(
    tokenHash,
    {
      upstream,
      userId: input.userId,
      machineId,
      exp: Math.floor(new Date(expiresAt).getTime() / 1000),
      mode,
    },
    ttlSeconds,
  );

  const workUrl = buildComfyWorkEnterUrl(rawToken);
  if (!workUrl) {
    throw new Error('Failed to build work URL');
  }

  return { token: rawToken, workUrl, expiresAt, mode };
}

/**
 * Resolve a live token (Worker / internal API / CP sync auth).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} rawToken
 * @returns {Promise<{
 *   upstreamUrl: string | null;
 *   userId: string;
 *   machineId: string | null;
 *   expiresAt: string;
 *   mode: 'runtime' | 'editor';
 * } | null>}
 */
export async function resolveComfyAccessToken(supabaseAdmin, rawToken) {
  const token = String(rawToken ?? '').trim();
  if (!token.startsWith(COMFY_ACCESS_TOKEN_PREFIX)) return null;

  const tokenHash = hashComfyAccessToken(token);
  const { data, error } = await supabaseAdmin
    .from('comfy_access_tokens')
    .select('upstream_url, user_id, machine_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  const upstreamUrl = normalizeUpstreamComfyUrl(data.upstream_url);
  const mode = upstreamUrl ? 'runtime' : 'editor';

  return {
    upstreamUrl,
    userId: String(data.user_id),
    machineId: data.machine_id != null ? String(data.machine_id) : null,
    expiresAt: String(data.expires_at),
    mode,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} machineId
 */
export async function revokeComfyAccessTokensForMachine(supabaseAdmin, machineId) {
  const id = String(machineId ?? '').trim();
  if (!id) return { revoked: 0 };

  const { data: rows } = await supabaseAdmin
    .from('comfy_access_tokens')
    .select('token_hash')
    .eq('machine_id', id)
    .is('revoked_at', null);

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('comfy_access_tokens')
    .update({ revoked_at: now })
    .eq('machine_id', id)
    .is('revoked_at', null)
    .select('id');

  if (error) {
    console.warn('[comfy-proxy] revoke for machine failed', error.message);
    return { revoked: 0 };
  }

  for (const row of rows ?? []) {
    if (row?.token_hash) await deleteTokenFromCloudflareKv(String(row.token_hash));
  }

  return { revoked: Array.isArray(data) ? data.length : 0 };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function revokeComfyAccessTokensForUser(supabaseAdmin, userId) {
  const id = String(userId ?? '').trim();
  if (!id) return { revoked: 0 };

  const { data: rows } = await supabaseAdmin
    .from('comfy_access_tokens')
    .select('token_hash')
    .eq('user_id', id)
    .is('revoked_at', null);

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('comfy_access_tokens')
    .update({ revoked_at: now })
    .eq('user_id', id)
    .is('revoked_at', null)
    .select('id');

  if (error) {
    console.warn('[comfy-proxy] revoke for user failed', error.message);
    return { revoked: 0 };
  }

  for (const row of rows ?? []) {
    if (row?.token_hash) await deleteTokenFromCloudflareKv(String(row.token_hash));
  }

  return { revoked: Array.isArray(data) ? data.length : 0 };
}
