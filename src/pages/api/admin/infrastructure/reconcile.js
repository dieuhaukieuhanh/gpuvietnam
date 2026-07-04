import { verifyAdmin } from '@/lib/admin-auth';
import {
  executeReconciliation,
  fetchDriftItems,
  fetchReconciliationRuns,
} from '@/lib/infrastructure/reconciliation-run';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req, res);
  if (!admin) return undefined;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    if (req.method === 'GET') {
      const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
      const [runs, drifts] = await Promise.all([
        fetchReconciliationRuns(supabaseAdmin, { limit: 20 }),
        fetchDriftItems(supabaseAdmin, {
          runId,
          limit: 100,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
        }),
      ]);

      const openDriftCount = drifts.filter((d) => d.status === 'open').length;

      return res.status(200).json({
        runs,
        drifts,
        summary: {
          runCount: runs.length,
          driftCount: drifts.length,
          openDriftCount,
          lastRun: runs[0] ?? null,
        },
      });
    }

    if (req.method === 'POST') {
      const repair = req.body?.repair === true;
      const preview = req.body?.preview === true;

      const result = await executeReconciliation(supabaseAdmin, {
        repair: preview ? false : repair,
        persist: true,
        limit: Number(req.body?.limit) || 50,
      });

      return res.status(200).json({
        ok: true,
        preview,
        repair: result.repair,
        runId: result.runId,
        driftCount: result.driftCount,
        drifts: result.drifts,
        counts: result.counts,
        repairs: result.repairs,
        health: result.health,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/infrastructure/reconcile]', err);
    return res.status(500).json({ error: err.message || 'Reconciliation failed.' });
  }
}
