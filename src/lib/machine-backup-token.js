import crypto from 'crypto';

export const BACKUP_TOKEN_PREFIX = 'gvb.';
export const BACKUP_TOKEN_SCOPE = 'backup_upload';
export const DEFAULT_BACKUP_TOKEN_TTL_SECONDS = 48 * 60 * 60;
export const ALLOWED_BACKUP_PREFIXES = Object.freeze([
  'outputs',
  'workflows',
  'models',
  'settings',
  'custom_nodes',
]);

/**
 * @param {string} rawToken
 */
export function hashBackupToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function generateRawBackupToken() {
  return `${BACKUP_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

/**
 * Public API base for container → app callbacks.
 * @returns {string | null}
 */
export function resolvePublicApiBaseUrl() {
  const raw =
    process.env.GPUVIETNAM_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    '';
  const base = String(raw).trim().replace(/\/$/, '');
  if (!base || /localhost|127\.0\.0\.1/i.test(base)) {
    // Allow localhost only when explicitly opted in (local docker compose).
    if (base && String(process.env.GPUVIETNAM_ALLOW_LOCAL_PRESIGN ?? '') === '1') {
      return base;
    }
    if (!base) return null;
    // Still return configured localhost for dev if set — containers on remote hosts cannot reach it.
    return base;
  }
  return base;
}

/**
 * @returns {string | null}
 */
export function resolvePresignUploadApiUrl() {
  const base = resolvePublicApiBaseUrl();
  if (!base) return null;
  return `${base}/api/storage/presign-upload`;
}

/**
 * Normalize and validate a relative object key under allowlisted folders.
 * @param {unknown} relativeKey
 * @returns {{ ok: true, key: string } | { ok: false, error: string }}
 */
export function sanitizeBackupObjectKey(relativeKey) {
  if (relativeKey == null || typeof relativeKey !== 'string') {
    return { ok: false, error: 'Thiếu key.' };
  }
  let key = relativeKey.trim().replace(/\\/g, '/');
  while (key.startsWith('/')) key = key.slice(1);
  if (!key || key.includes('\\0')) {
    return { ok: false, error: 'Key không hợp lệ.' };
  }
  if (key.includes('..') || key.split('/').some((part) => part === '..' || part === '')) {
    return { ok: false, error: 'Key không được chứa .. hoặc segment rỗng.' };
  }
  const first = key.split('/')[0];
  if (!ALLOWED_BACKUP_PREFIXES.includes(first)) {
    return {
      ok: false,
      error: `Key phải bắt đầu bằng ${ALLOWED_BACKUP_PREFIXES.join('|')}/`,
    };
  }
  if (key.length > 512) {
    return { ok: false, error: 'Key quá dài.' };
  }
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(key)) {
    return { ok: false, error: 'Key chứa ký tự không cho phép.' };
  }
  return { ok: true, key };
}

/**
 * @param {string} userId
 * @param {string} relativeKey
 */
export function buildUserBackupR2Key(userId, relativeKey) {
  return `users/${userId}/${relativeKey}`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   machineId?: string | null;
 *   subscriptionId?: string | null;
 *   ttlSeconds?: number;
 * }} input
 */
export async function issueMachineBackupToken(supabaseAdmin, input) {
  const userId = String(input.userId ?? '');
  if (!userId) throw new Error('issueMachineBackupToken: missing userId');

  const ttl = Math.max(
    300,
    Math.floor(Number(input.ttlSeconds ?? DEFAULT_BACKUP_TOKEN_TTL_SECONDS) || DEFAULT_BACKUP_TOKEN_TTL_SECONDS),
  );
  const rawToken = generateRawBackupToken();
  const tokenHash = hashBackupToken(rawToken);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('machine_backup_tokens')
    .insert({
      user_id: userId,
      machine_id: input.machineId ?? null,
      subscription_id: input.subscriptionId ?? null,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select('id, user_id, machine_id, subscription_id, expires_at')
    .single();

  if (error) throw error;

  return {
    id: data.id,
    token: rawToken,
    expiresAt: data.expires_at,
    userId: data.user_id,
    machineId: data.machine_id,
    subscriptionId: data.subscription_id,
    scope: BACKUP_TOKEN_SCOPE,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} tokenId
 * @param {string} machineId
 */
export async function attachBackupTokenToMachine(supabaseAdmin, tokenId, machineId) {
  if (!tokenId || !machineId) return;
  const { error } = await supabaseAdmin
    .from('machine_backup_tokens')
    .update({ machine_id: machineId })
    .eq('id', tokenId)
    .is('revoked_at', null);
  if (error) throw error;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} rawToken
 * @returns {Promise<{
 *   id: string;
 *   userId: string;
 *   machineId: string | null;
 *   subscriptionId: string | null;
 *   expiresAt: string;
 *   scope: string;
 * } | null>}
 */
export async function verifyMachineBackupToken(supabaseAdmin, rawToken) {
  const token = String(rawToken ?? '').trim();
  if (!token.startsWith(BACKUP_TOKEN_PREFIX)) return null;

  const tokenHash = hashBackupToken(token);
  const { data, error } = await supabaseAdmin
    .from('machine_backup_tokens')
    .select('id, user_id, machine_id, subscription_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.revoked_at) return null;

  const expiresMs = new Date(String(data.expires_at)).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return null;

  return {
    id: String(data.id),
    userId: String(data.user_id),
    machineId: data.machine_id ? String(data.machine_id) : null,
    subscriptionId: data.subscription_id ? String(data.subscription_id) : null,
    expiresAt: String(data.expires_at),
    scope: BACKUP_TOKEN_SCOPE,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} machineId
 */
export async function revokeBackupTokensForMachine(supabaseAdmin, machineId) {
  if (!machineId) return { revoked: 0 };
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('machine_backup_tokens')
    .update({ revoked_at: now })
    .eq('machine_id', machineId)
    .is('revoked_at', null)
    .select('id');
  if (error) throw error;
  return { revoked: data?.length ?? 0 };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} subscriptionId
 */
export async function revokeBackupTokensForSubscription(supabaseAdmin, subscriptionId) {
  if (!subscriptionId) return { revoked: 0 };
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('machine_backup_tokens')
    .update({ revoked_at: now })
    .eq('subscription_id', subscriptionId)
    .is('revoked_at', null)
    .select('id');
  if (error) throw error;
  return { revoked: data?.length ?? 0 };
}