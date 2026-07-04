import { checkAutoStop } from '@/lib/gpu/auto-stop';
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
    const { data: machines, error } = await supabaseAdmin
      .from('machines')
      .select('id')
      .eq('status', 'running');

    if (error) throw error;

    if (!machines?.length) {
      return res.status(200).json({ checked: 0, stopped: 0, warned: 0, results: [] });
    }

    /** @type {Array<Record<string, unknown>>} */
    const results = [];
    let stopped = 0;
    let warned = 0;

    for (const machine of machines) {
      try {
        const result = await checkAutoStop(supabaseAdmin, String(machine.id));
        results.push({ machineId: machine.id, ...result });
        if (result.action === 'stopped') stopped += 1;
        if (result.action === 'warned') warned += 1;
      } catch (err) {
        console.error(`[cron/check-idle] machine ${machine.id}:`, err);
        results.push({
          machineId: machine.id,
          action: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return res.status(200).json({
      checked: machines.length,
      stopped,
      warned,
      results,
    });
  } catch (err) {
    console.error('[cron/check-idle]', err);
    return res.status(500).json({ error: err.message || 'Cron idle check failed.' });
  }
}
