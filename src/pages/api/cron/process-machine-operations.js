import { processMachineOperationBatch } from '@/lib/infrastructure/machine-operation-worker';
import { logProjectionVerifyTrace } from '@/lib/infrastructure/projection-verify-trace';
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
    const limit = Number(req.query?.limit ?? req.body?.limit ?? 5);
    const resolvedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 20) : 5;

    logProjectionVerifyTrace('process-machine-operations ENTER', null, {
      limit: resolvedLimit,
      method: req.method,
      note: 'recovery_only',
    });

    const result = await processMachineOperationBatch(supabaseAdmin, {
      limit: resolvedLimit,
    });

    return res.status(200).json({
      ok: true,
      processed: result.processed,
      prepared: result.prepared,
      batch: result.batch ?? null,
    });
  } catch (err) {
    console.error('[cron/process-machine-operations]', err);
    return res.status(500).json({ error: err.message || 'Machine operation worker failed.' });
  }
}
