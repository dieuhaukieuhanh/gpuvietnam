import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createCorrelationId } from '@/lib/scb-correlation';
import { handleMachinesStatusProjectionFirst } from '@/lib/machines-status-projection';
import { logArchitectureFreezeStartup } from '@/lib/scb-read-path';

function scbDbg(label, payload) {
  console.log('[SCB-DBG][api/status]', label, JSON.stringify(payload));
}

export default async function handler(req, res) {
  const scbReqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const correlationId = createCorrelationId();
  scbDbg('ENTER', { id: scbReqId, correlationId, ts: new Date().toISOString(), method: req.method });
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    logArchitectureFreezeStartup();
    const user = await getAuthUserFromRequest(req);
    if (!user) {
      scbDbg('EXIT unauthorized', { id: scbReqId });
      return unauthorized(res);
    }

    const supabaseAdmin = getSupabaseAdmin();

    return handleMachinesStatusProjectionFirst(req, res, {
      user,
      supabaseAdmin,
      correlationId,
      scbReqId,
    });
  } catch (err) {
    console.error('[SCB-DBG][api/status] EXIT error-throw', err instanceof Error ? err.message : String(err));
    console.error('❌ message:', err instanceof Error ? err.message : String(err));
    console.error('❌ stack:', err instanceof Error ? err.stack : '(no stack)');
    console.error('[machines/status]', err);
    return res.status(500).json({ error: err.message || 'Không lấy được trạng thái máy.' });
  }
}
