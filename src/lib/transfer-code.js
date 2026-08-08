/**
 * Bank transfer payment codes (SePay).
 * Format: NV + 4 digits (e.g. NV4821) — 6 chars, unique among pending rows.
 * Kept free of Node-only / heavy server imports so client UI can share parse helpers.
 */

export const SEPAY_PREFIX = 'NV';
const CODE_LENGTH = 4;
const CODE_CHARS = '0123456789';

/**
 * Generate a random transfer code: NV + 4 digits.
 * @returns {string}
 */
export function generateTransferCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return `${SEPAY_PREFIX}${code}`;
}

/**
 * Parse transfer code from bank content / SePay payload.
 * Primary: NV + 4 digits. Legacy: GD + 2 alphanumeric.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function parseTransferCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase();
  const nv = cleaned.match(/NV\d{4}/);
  if (nv) return nv[0];
  const gd = cleaned.match(/GD[A-Z0-9]{2}/);
  return gd ? gd[0] : null;
}

function shortLegacySuffix(transactionId) {
  return String(transactionId).replace(/-/g, '').slice(0, 2).toUpperCase();
}

/**
 * Resolve deposit transfer code from pending wallet row (or legacy UUID id).
 * @param {{ id?: string, description?: string|null }|string|null|undefined} transactionOrId
 */
export function extractDepositTransferCode(transactionOrId) {
  if (!transactionOrId) return null;
  if (typeof transactionOrId === 'string') {
    return `GD${shortLegacySuffix(transactionOrId)}`;
  }
  const fromDesc = parseTransferCode(transactionOrId.description);
  if (fromDesc) return fromDesc;
  if (transactionOrId.id) {
    return `GD${shortLegacySuffix(transactionOrId.id)}`;
  }
  return null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} transferCode
 */
async function isTransferCodeInUse(supabaseAdmin, transferCode) {
  const code = String(transferCode || '').toUpperCase();
  if (!code) return true;

  const [wallet, subs, renews] = await Promise.all([
    supabaseAdmin
      .from('wallet_transactions')
      .select('id, description')
      .eq('status', 'pending_deposit')
      .eq('type', 'deposit')
      .order('created_at', { ascending: false })
      .limit(80),
    supabaseAdmin
      .from('subscriptions')
      .select('id, transfer_note')
      .eq('status', 'pending_payment')
      .ilike('transfer_note', `%${code}%`)
      .limit(5),
    supabaseAdmin
      .from('plan_renew_requests')
      .select('id, transfer_note')
      .eq('status', 'pending')
      .ilike('transfer_note', `%${code}%`)
      .limit(5),
  ]);

  if (subs.data?.length || renews.data?.length) return true;

  for (const tx of wallet.data || []) {
    if (extractDepositTransferCode(tx) === code) return true;
  }
  return false;
}

/**
 * Allocate an NV code not currently used by pending wallet / GPU / renew rows.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {number} [maxAttempts]
 */
export async function allocateTransferCode(supabaseAdmin, maxAttempts = 48) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateTransferCode();
    const inUse = await isTransferCodeInUse(supabaseAdmin, code);
    if (!inUse) return code;
  }
  return generateTransferCode();
}

/**
 * Nội dung CK = mã NVxxxx. Không kèm tên khách.
 * @param {string} [transferCodeOrName]
 * @param {string} [maybeCode]
 */
export function buildTransferDescription(transferCodeOrName, maybeCode) {
  const fromSecond = parseTransferCode(maybeCode);
  if (fromSecond) return fromSecond;
  const fromFirst = parseTransferCode(transferCodeOrName);
  if (fromFirst) return fromFirst;
  if (maybeCode && /^NV\d{4}$/i.test(String(maybeCode).trim())) {
    return String(maybeCode).trim().toUpperCase();
  }
  if (transferCodeOrName && /^NV\d{4}$/i.test(String(transferCodeOrName).trim())) {
    return String(transferCodeOrName).trim().toUpperCase();
  }
  return generateTransferCode();
}
