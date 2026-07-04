import {
  executeReconciliation,
} from '@/lib/infrastructure/reconciliation-run';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function isAuthorizedCron(req) {
  if (req.headers['x-vercel-cron']) return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

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
    const repair = req.query?.repair === 'true' || req.body?.repair === true;

    const result = await executeReconciliation(supabaseAdmin, {
      repair,
      persist: true,
    });

    return res.status(200).json({
      ok: true,
      runId: result.runId,
      repair: result.repair,
      driftCount: result.driftCount,
      counts: result.counts,
      health: result.health,
    });
  } catch (err) {
    console.error('[cron/reconcile-infrastructure]', err);
    return res.status(500).json({ error: err.message || 'Reconciliation cron failed.' });
  }
}
