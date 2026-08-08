/**
 * GET|POST /api/cron/sepay-reconcile
 *
 * Pull recent Sepay transactions to catch missed webhooks.
 * Vercel Cron every 5 minutes + manual Bearer CRON_SECRET.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { listSepayTransactions, processSepayWebhook } from '@/lib/sepay';

function isAuthorizedCron(req) {
  if (req.headers['x-vercel-cron']) return true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const headerSecret = req.headers['x-cron-secret'];
  if (headerSecret && headerSecret === cronSecret) return true;

  const querySecret = req.query?.secret;
  if (querySecret && querySecret === cronSecret) return true;

  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorizedCron(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: lastTx } = await supabaseAdmin
      .from('sepay_transactions')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sinceId = lastTx?.id || undefined;

    const result = await listSepayTransactions({ sinceId, limit: 100 });
    if (result.error) {
      console.error('[sepay-reconcile] Pull error:', result.error);
      return res.status(502).json({ error: result.error });
    }

    const transactions = result.transactions || [];
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const tx of transactions) {
      if (tx.transferType && tx.transferType !== 'in') {
        skipped++;
        continue;
      }

      try {
        const outcome = await processSepayWebhook(supabaseAdmin, tx);
        if (outcome.processed) processed++;
        else if (outcome.reason === 'error') errors++;
        else skipped++;
      } catch (err) {
        errors++;
        console.error('[sepay-reconcile] Process error:', err);
      }
    }

    return res.status(200).json({
      success: true,
      pulled: transactions.length,
      processed,
      skipped,
      errors,
      sinceId: sinceId || null,
    });
  } catch (error) {
    console.error('[sepay-reconcile] Error:', error);
    return res.status(500).json({ error: 'Reconciliation failed.' });
  }
}
