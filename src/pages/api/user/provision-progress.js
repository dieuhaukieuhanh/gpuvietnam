import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { bindRequestActors, getLogContext, resolveRequestId, withApiLogging } from '@/lib/logging';
import { getProvisionProgress } from '@/lib/provision-progress/index.js';
import { decideResumeFromLoadedState } from '@/lib/session-resume/index.js';
import { getActiveMachineForUser } from '@/lib/machines.js';

async function provisionProgressHandler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = getLogContext().requestId ?? resolveRequestId(req);
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);
  bindRequestActors({ userId: user.id, requestId, operation: 'user.provisionProgress' });

  const supabaseAdmin = getSupabaseAdmin();
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select(
      'id, server_status, provisioning_started_at, provisioning_lease_id, provisioning_lease_expires_at, provisioning_heartbeat_at, provisioning_progress',
    )
    .eq('user_id', user.id)
    .in('status', ['active', 'provisioning'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const machine = await getActiveMachineForUser(supabaseAdmin, user.id);
  const resume = decideResumeFromLoadedState({
    subscription,
    machine,
  });

  const subscriptionId = subscription?.id != null ? String(subscription.id) : null;
  const machineStatus =
    machine?.status != null
      ? String(machine.status)
      : machine?.server_status != null
        ? String(machine.server_status)
        : null;
  const progress = subscriptionId
    ? await getProvisionProgress(subscriptionId, {
        supabaseAdmin,
        // Always pass resume state — needed to unstick timeline when machine is already up.
        resumeState: resume.currentState ?? null,
        machineStatus,
      })
    : await getProvisionProgress('', {});

  return res.status(200).json({
    success: true,
    subscriptionId,
    progress,
    resumeState: resume.currentState,
    shouldResume: resume.shouldResume,
    requestId,
  });
}

export default withApiLogging(provisionProgressHandler, {
  operation: 'user.provisionProgress',
});