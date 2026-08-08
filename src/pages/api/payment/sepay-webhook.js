/**
 * POST /api/payment/sepay-webhook
 *
 * Receives Sepay webhook when a bank transfer is detected.
 * Auto-matches and approves pending payments.
 *
 * Security: HMAC-SHA256 signature verification.
 * Idempotent: dedup by Sepay transaction ID.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { verifySepayWebhook, processSepayWebhook } from '@/lib/sepay';

// Sepay expects raw body for HMAC verification.
// Next.js Pages Router: disable bodyParser to get raw body.
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Read raw request body as string.
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Read raw body for HMAC verification
    const rawBody = await readRawBody(req);

    // 2. Verify HMAC signature (SePay: sha256=HMAC(secret, `${timestamp}.${rawBody}`))
    const signature = req.headers['x-sepay-signature'] || '';
    const timestamp = req.headers['x-sepay-timestamp'] || '';
    const isValid = verifySepayWebhook(rawBody, signature, timestamp);

    if (!isValid) {
      console.warn('[sepay-webhook] Invalid HMAC signature');
      // Still return 200 to prevent Sepay retry storms, but don't process
      return res.status(200).json({ success: false, reason: 'invalid_signature' });
    }

    // 3. Parse payload
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Only process incoming transfers
    if (payload.transferType && payload.transferType !== 'in') {
      return res.status(200).json({ success: true, skipped: 'not_incoming' });
    }

    // 4. Process
    const supabaseAdmin = getSupabaseAdmin();
    const result = await processSepayWebhook(supabaseAdmin, {
      id: payload.id,
      gateway: payload.gateway,
      accountNumber: payload.accountNumber,
      transferAmount: payload.transferAmount,
      transferType: payload.transferType,
      code: payload.code,
      content: payload.content,
      transactionDate: payload.transactionDate,
    });

    // 5. Always return 200 quickly (Sepay retries on non-200)
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[sepay-webhook] Unexpected error:', error);
    // Still return 200 — Sepay will retry if we error, but we log for reconciliation
    return res.status(200).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
