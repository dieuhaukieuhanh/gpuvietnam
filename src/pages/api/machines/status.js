import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { handleMachinesStatusProjectionFirst } from '@/lib/machines-status-projection';
import { logArchitectureFreezeStartup } from '@/lib/scb-read-path';
import {
  bindRequestActors,
  getLogContext,
  logger,
  resolveRequestId,
  withApiLogging,
} from '@/lib/logging';

async function machinesStatusHandler(req, res) {
  const requestId = getLogContext().requestId ?? resolveRequestId(req);
  const log = logger('api');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    logArchitectureFreezeStartup();
    const user = await getAuthUserFromRequest(req);
    if (!user) {
      log.warn({ operation: 'machines.status', phase: 'FAILURE' }, 'unauthorized');
      return unauthorized(res);
    }

    bindRequestActors({ userId: user.id, requestId, operation: 'machines.status' });
    const supabaseAdmin = getSupabaseAdmin();

    return handleMachinesStatusProjectionFirst(req, res, {
      user,
      supabaseAdmin,
      correlationId: requestId,
      scbReqId: requestId,
    });
  } catch (err) {
    log.error(
      {
        operation: 'machines.status',
        phase: 'FAILURE',
        err: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      },
      'machines status failed',
    );
    return res.status(500).json({
      error: err.message || 'Không lấy được trạng thái máy.',
      requestId,
    });
  }
}

export default withApiLogging(machinesStatusHandler, {
  operation: 'machines.status',
  channel: 'api',
});
