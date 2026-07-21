import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { bindRequestActors, getLogContext, resolveRequestId, withApiLogging } from '@/lib/logging';
import { buildSessionResumeSnapshot } from '@/lib/session-resume/index.js';

async function sessionResumeHandler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = getLogContext().requestId ?? resolveRequestId(req);
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  bindRequestActors({ userId: user.id, requestId, operation: 'user.sessionResume' });

  const supabaseAdmin = getSupabaseAdmin();
  const snapshot = await buildSessionResumeSnapshot(supabaseAdmin, user.id, {
    requestId,
    source: 'session-resume-api',
  });

  return res.status(200).json(snapshot);
}

export default withApiLogging(sessionResumeHandler, { operation: 'user.sessionResume' });