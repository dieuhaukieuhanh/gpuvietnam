/**
 * Sepay integration — automated bank transfer verification.
 *
 * - verifySepayWebhook(): HMAC signature verification
 * - matchSepayTransaction(): find pending payment by transfer code
 * - processSepayWebhook(): full webhook handler (dedup → match → approve)
 * - generateVietQR(): VietQR image URL (qr.sepay.vn)
 * - listSepayTransactions(): pull missed webhooks (API v1)
 * - allocateTransferCode(): unique NV + 4 digits among pending rows
 */

import crypto from 'node:crypto';
import { extractDepositTransferCode, WALLET_BANK_INFO } from './wallet-deposit.js';

// ── Config ────────────────────────────────────────────────────────

/** Tiền tố mã CK — khớp cấu hình SePay (Công ty → Cấu trúc mã thanh toán). */
export const SEPAY_PREFIX = 'NV';
const CODE_LENGTH = 4;
const CODE_CHARS = '0123456789';
/** Reject webhooks whose timestamp drifts more than 5 minutes (SePay anti-replay). */
const WEBHOOK_MAX_SKEW_SEC = 300;

export function getSepayConfig() {
  return {
    apiToken: process.env.SEPAY_API_TOKEN || '',
    webhookSecret: process.env.SEPAY_WEBHOOK_SECRET || '',
    /** Bank API v1 — numeric transaction ids (matches webhook `id` integer). */
    apiBase: process.env.SEPAY_API_BASE || 'https://my.sepay.vn/userapi',
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER || '888666369',
    /** VietQR bank slug — MB Bank personal account. */
    bankCode: process.env.SEPAY_BANK_CODE || 'MBBank',
    accountName: process.env.SEPAY_ACCOUNT_NAME || WALLET_BANK_INFO.accountName,
  };
}

export function isSepayConfigured() {
  const config = getSepayConfig();
  return Boolean(config.webhookSecret && config.accountNumber);
}

// ── Transfer code generation ──────────────────────────────────────

/**
 * Generate a random transfer code: NV + 4 digits.
 * Example: NV4821
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
 * Primary: NV + 4 digits. Legacy: GD + 2 alphanumeric (pending cũ).
 */
export function parseTransferCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase();
  const nv = cleaned.match(/NV\d{4}/);
  if (nv) return nv[0];
  const gd = cleaned.match(/GD[A-Z0-9]{2}/);
  return gd ? gd[0] : null;
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
  // Extremely unlikely — fall back to random even if collision check failed.
  return generateTransferCode();
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

// ── HMAC verification ─────────────────────────────────────────────

/**
 * Verify Sepay webhook HMAC-SHA256 signature (per SePay docs).
 * Headers: X-SePay-Signature = sha256={hex}, X-SePay-Timestamp = unix seconds
 * Signed payload: `${timestamp}.${raw_body}`
 *
 * @param {string} rawBody
 * @param {string} signature
 * @param {string|number} timestamp
 */
export function verifySepayWebhook(rawBody, signature, timestamp) {
  const config = getSepayConfig();
  if (!config.webhookSecret) {
    console.warn('[sepay] SEPAY_WEBHOOK_SECRET not configured');
    return false;
  }
  if (!signature || timestamp === undefined || timestamp === null || timestamp === '') {
    return false;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > WEBHOOK_MAX_SKEW_SEC) {
    console.warn('[sepay] Webhook timestamp outside allowed skew');
    return false;
  }

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', config.webhookSecret)
      .update(`${ts}.${rawBody}`)
      .digest('hex');

  try {
    const sigBuf = Buffer.from(String(signature));
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

// ── Transaction matching ───────────────────────────────────────────

/**
 * Find a pending wallet deposit by transfer code.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} transferCode
 */
async function findPendingWalletDeposit(supabaseAdmin, transferCode) {
  const code = String(transferCode || '').toUpperCase();
  const { data, error } = await supabaseAdmin
    .from('wallet_transactions')
    .select('*')
    .eq('status', 'pending_deposit')
    .eq('type', 'deposit')
    .order('created_at', { ascending: false })
    .limit(80);

  if (error || !data?.length) return null;

  for (const tx of data) {
    if (extractDepositTransferCode(tx) === code) {
      return { type: 'wallet_deposit', row: tx, expectedAmount: Number(tx.amount) };
    }
  }
  return null;
}

/**
 * Find a pending GPU plan subscription by NV code in transfer_note.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} transferCode
 */
async function findPendingGpuPlan(supabaseAdmin, transferCode) {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('status', 'pending_payment')
    .ilike('transfer_note', `%${transferCode}%`)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !data?.length) return null;

  const row =
    data.find((r) => parseTransferCode(r.transfer_note) === transferCode) || data[0];

  let expectedAmount = null;
  try {
    const { getPlanPurchaseAmount } = await import('./gpu-pricing.js');
    const { ensureGpuPricingLoaded } = await import('./gpu-pricing-config.js');
    await ensureGpuPricingLoaded(supabaseAdmin);
    const billing = String(row.billing || 'hourly');
    const hours = billing === 'hourly' ? Number(row.hours_total) || null : null;
    expectedAmount = getPlanPurchaseAmount(row.plan, billing, hours);
  } catch (err) {
    console.warn('[sepay] gpu plan amount lookup failed:', err);
  }

  return {
    type: 'gpu_plan',
    row,
    expectedAmount: expectedAmount != null && Number.isFinite(expectedAmount) ? expectedAmount : null,
  };
}

/**
 * Find a pending plan renew by NV code in transfer_note.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} transferCode
 */
async function findPendingPlanRenew(supabaseAdmin, transferCode) {
  const { data, error } = await supabaseAdmin
    .from('plan_renew_requests')
    .select('*')
    .eq('status', 'pending')
    .ilike('transfer_note', `%${transferCode}%`)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !data?.length) return null;

  const row =
    data.find((r) => parseTransferCode(r.transfer_note) === transferCode) || data[0];

  return {
    type: 'plan_renew',
    row,
    expectedAmount: Number(row.transfer_amount || 0),
  };
}

/**
 * Match a Sepay webhook payload to a pending payment.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ code?: string|null, content?: string|null, transferAmount: number }} tx
 */
export async function matchSepayTransaction(supabaseAdmin, tx) {
  const code =
    parseTransferCode(tx.code) || parseTransferCode(tx.content) || null;
  if (!code) return { match: null, reason: 'no_code' };

  const walletMatch = await findPendingWalletDeposit(supabaseAdmin, code);
  if (walletMatch) {
    const ok = tx.transferAmount >= walletMatch.expectedAmount;
    return {
      match: walletMatch,
      code,
      amountOk: ok,
      reason: ok ? 'matched' : 'amount_mismatch',
    };
  }

  const planMatch = await findPendingGpuPlan(supabaseAdmin, code);
  if (planMatch) {
    const expected = planMatch.expectedAmount;
    const ok = expected == null || tx.transferAmount >= expected;
    return {
      match: planMatch,
      code,
      amountOk: ok,
      reason: ok ? 'matched' : 'amount_mismatch',
    };
  }

  const renewMatch = await findPendingPlanRenew(supabaseAdmin, code);
  if (renewMatch) {
    const ok = tx.transferAmount >= renewMatch.expectedAmount;
    return {
      match: renewMatch,
      code,
      amountOk: ok,
      reason: ok ? 'matched' : 'amount_mismatch',
    };
  }

  return { match: null, code, reason: 'no_match' };
}

// ── Auto-approval ──────────────────────────────────────────────────

/**
 * Auto-approve a matched transaction.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ type: string, row: Record<string, unknown>, expectedAmount?: number|null }} matched
 */
export async function autoApproveMatchedTransaction(supabaseAdmin, matched) {
  switch (matched.type) {
    case 'wallet_deposit': {
      const { approveWalletDeposit } = await import('./wallet-deposit.js');
      const result = await approveWalletDeposit(supabaseAdmin, String(matched.row.id));
      if (result?.error) return result;
      try {
        const { notifyWalletDepositApproved } = await import('./user-notifications.js');
        await notifyWalletDepositApproved(supabaseAdmin, {
          userId: result.userId,
          amount: result.amount,
          newBalance: result.newBalance,
        });
      } catch (err) {
        console.warn('[sepay] notifyWalletDepositApproved failed:', err);
      }
      return result;
    }
    case 'plan_renew': {
      const { approvePlanRenewRequest } = await import('./plan-renew-request.js');
      return approvePlanRenewRequest(supabaseAdmin, String(matched.row.id));
    }
    case 'gpu_plan': {
      const now = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'active',
          server_status: 'offline',
          activated_at: now,
        })
        .eq('id', matched.row.id)
        .eq('status', 'pending_payment');

      if (updateError) return { error: updateError.message };

      const { syncUserPlanInventory } = await import('./user-plan-inventory.js');
      await syncUserPlanInventory(supabaseAdmin, String(matched.row.user_id));

      try {
        const { notifyPaymentSuccess } = await import('./user-notifications.js');
        await notifyPaymentSuccess(supabaseAdmin, {
          userId: String(matched.row.user_id),
          planName: matched.row.plan,
        });
      } catch (err) {
        console.warn('[sepay] notifyPaymentSuccess failed:', err);
      }

      return { success: true, subscriptionId: matched.row.id };
    }
    default:
      return { error: `Unknown match type: ${matched.type}` };
  }
}

// ── Webhook processing ─────────────────────────────────────────────

/**
 * Full Sepay webhook / reconcile handler.
 * 1. Dedup check
 * 2. Match transaction
 * 3. Auto-approve if matched
 * 4. Log to sepay_transactions
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   id: number|string,
 *   gateway?: string,
 *   accountNumber?: string,
 *   transferAmount: number,
 *   transferType?: string,
 *   code?: string,
 *   content?: string,
 *   transactionDate?: string,
 * }} payload
 */
export async function processSepayWebhook(supabaseAdmin, payload) {
  const sepayId = Number(payload.id);
  if (!Number.isFinite(sepayId)) {
    return { processed: false, reason: 'invalid_id' };
  }

  const { data: existing } = await supabaseAdmin
    .from('sepay_transactions')
    .select('id, status')
    .eq('id', sepayId)
    .maybeSingle();

  if (existing) {
    return { processed: false, reason: 'duplicate', existingStatus: existing.status };
  }

  const { match, code, amountOk, reason } = await matchSepayTransaction(supabaseAdmin, {
    code: payload.code,
    content: payload.content,
    transferAmount: Number(payload.transferAmount) || 0,
  });

  let approveResult = null;
  let status =
    reason === 'matched' && amountOk
      ? 'processed'
      : reason === 'no_match'
        ? 'no_match'
        : reason === 'amount_mismatch'
          ? 'amount_mismatch'
          : reason === 'no_code'
            ? 'no_match'
            : 'error';

  if (match && amountOk) {
    try {
      approveResult = await autoApproveMatchedTransaction(supabaseAdmin, match);
      if (approveResult?.error) {
        status = 'error';
      }
    } catch (err) {
      status = 'error';
      approveResult = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const logEntry = {
    id: sepayId,
    gateway: payload.gateway || null,
    account_number: payload.accountNumber || null,
    transfer_amount: Number(payload.transferAmount) || 0,
    transfer_type: payload.transferType || 'in',
    code: code || payload.code || null,
    content: payload.content || null,
    transaction_date: payload.transactionDate || null,
    matched_type: match?.type || null,
    matched_id: match?.row?.id || null,
    matched_amount: match?.expectedAmount ?? null,
    status,
    raw_payload: payload,
    error_message: approveResult?.error || null,
  };

  const { error: insertError } = await supabaseAdmin
    .from('sepay_transactions')
    .insert(logEntry);

  if (insertError) {
    console.error('[sepay] Failed to log transaction:', insertError);
  }

  return {
    processed: status === 'processed',
    reason: status,
    matchType: match?.type || null,
    approveResult,
  };
}

// ── VietQR Generation ──────────────────────────────────────────────

/**
 * Build a public VietQR image URL (no API token required).
 * Docs: https://developer.sepay.vn/en/tien-ich-khac/tao-qr-code
 *
 * @param {{ amount: number, description: string }} params
 */
export function buildVietQrUrl({ amount, description } = {}) {
  const config = getSepayConfig();
  const params = new URLSearchParams({
    acc: config.accountNumber,
    bank: config.bankCode,
    amount: String(Math.max(0, Math.floor(Number(amount) || 0))),
    des: String(description || '').slice(0, 100),
    // qronly = chỉ mã QR (không banner SePay/NH cao) — fit modal nạp ví
    template: 'qronly',
  });
  return `https://qr.sepay.vn/img?${params.toString()}`;
}

/**
 * Generate a VietQR code for bank transfer.
 * Prefers public qr.sepay.vn image URL; optionally fetches as data URL when requested.
 *
 * @param {{ amount: number, description: string, asDataUrl?: boolean }} params
 */
export async function generateVietQR({ amount, description, asDataUrl = false } = {}) {
  const config = getSepayConfig();
  if (!config.accountNumber) {
    return { error: 'SEPAY_ACCOUNT_NUMBER not configured' };
  }

  const qrUrl = buildVietQrUrl({ amount, description });

  if (!asDataUrl) {
    return { success: true, qrUrl, qrDataUrl: null };
  }

  try {
    const response = await fetch(qrUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return { success: true, qrUrl, qrDataUrl: null, warning: `QR fetch ${response.status}` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString('base64');
    const contentType = response.headers.get('content-type') || 'image/png';
    return {
      success: true,
      qrUrl,
      qrDataUrl: `data:${contentType};base64,${base64}`,
    };
  } catch (err) {
    // Still return URL — browser <img> can load it directly.
    return {
      success: true,
      qrUrl,
      qrDataUrl: null,
      warning: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Nội dung CK = mã 6 ký tự NVxxxx (xxxx = số). Không kèm tên khách.
 * @param {string} [transferCodeOrName]
 * @param {string} [maybeCode] nếu gọi kiểu cũ (fullName, code) thì lấy code
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

/**
 * Build bank transfer info block for API responses / UI.
 * @param {{ amount: number, transferCode: string, description?: string|null }} params
 */
export function buildSepayTransferInfo({ amount, transferCode, description }) {
  const config = getSepayConfig();
  const code =
    parseTransferCode(transferCode) ||
    parseTransferCode(description) ||
    transferCode;
  const content = buildTransferDescription(code);
  return {
    bankName: WALLET_BANK_INFO.bankName,
    accountNumber: config.accountNumber,
    accountName: config.accountName,
    amount: Number(amount) || 0,
    transferCode: content,
    transferContent: content,
    expectedMinutes: 5,
    expectedLabel: '~1–5 phút (tự động)',
    qrUrl: buildVietQrUrl({ amount, description: content }),
  };
}

// ── Reconciliation ─────────────────────────────────────────────────

/**
 * Normalize a v1 list transaction into webhook-shaped payload.
 * @param {Record<string, unknown>} tx
 */
export function normalizeSepayListTransaction(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const id = tx.id ?? tx.transaction_id;
  if (id == null) return null;
  return {
    id: Number(id),
    gateway: tx.gateway || tx.bank_brand_name || null,
    accountNumber: tx.accountNumber || tx.account_number || null,
    transferAmount: Number(tx.transferAmount ?? tx.amount_in ?? tx.amount ?? 0),
    transferType: tx.transferType || tx.transfer_type || 'in',
    code: tx.code || null,
    content: tx.content || tx.transaction_content || tx.description || null,
    transactionDate: tx.transactionDate || tx.transaction_date || null,
  };
}

/**
 * Pull recent transactions from Sepay API v1.
 * Used by cron to catch missed webhooks.
 *
 * @param {{ sinceId?: number, limit?: number }} [opts]
 */
export async function listSepayTransactions({ sinceId, limit = 100 } = {}) {
  const config = getSepayConfig();
  if (!config.apiToken) {
    return { error: 'SEPAY_API_TOKEN not configured' };
  }

  try {
    const params = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Number(limit) || 100))),
    });
    if (sinceId) params.set('since_id', String(sinceId));

    const response = await fetch(`${config.apiBase}/transactions/list?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { error: `Sepay API error: ${response.status} ${text}` };
    }

    const data = await response.json();
    const rawList = data.transactions || data.data || [];
    const transactions = (Array.isArray(rawList) ? rawList : [])
      .map(normalizeSepayListTransaction)
      .filter(Boolean);

    return { success: true, transactions };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
