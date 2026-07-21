import { processBackupRetentionCron } from '@/lib/backup-entitlement';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function isAuthorizedCron(req) {
  if (req.headers['x-vercel-cron']) return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (cronSecret && authHeader === 'Bearer ' + cronSecret) return true;

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
    const result = await processBackupRetentionCron(supabaseAdmin);
    return res.status(200).json({
      ok: true,
      synced: result.synced,
      purged: result.purged,
      purgeFailed: result.purgeFailed,
      purgeResults: result.purgeResults,
    });
  } catch (err) {
    console.error('[cron/backup-retention]', err);
    return res.status(500).json({ error: err.message || 'Backup retention cron failed.' });
  }
}