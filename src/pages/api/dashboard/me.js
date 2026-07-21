import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { repairUserBillingState, getGpuService, getGpuServiceForMachine } from '@/lib/gpu';
import { createCorrelationId } from '@/lib/scb-correlation';
import { getActiveMachineForUser, pickPreferredActiveSubscription } from '@/lib/machines';
import { toSyncShape } from '@/lib/machines-drift';
import { runReadPathProjectionFirst, subscriptionPrefetchFromDashboardRow } from '@/lib/machines-drift-projection';
import { snapshotToMachineRecord, resolveMachineSessionView } from '@/lib/gpu/machine-session-view';
import { resolveBillingSessionView } from '@/lib/gpu/billing-session-view';
import { logArchitectureFreezeStartup } from '@/lib/scb-read-path';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { syncUserPlanInventory, grantsPrefetchForInventorySync } from '@/lib/user-plan-inventory';
import { billablePlansFromInventoryRows, fetchOrderedBillablePlansForUser } from '@/lib/gpu/billing';
import { withProf, profStart, profEnd, renderProfTree } from '@/lib/prof';
import { decideResumeFromLoadedState } from '@/lib/session-resume/index.js';



const ACTIVE_STATUSES = ['active', 'provisioning', 'pending_payment'];



export default async function handler(req, res) {

  return withProf('Dashboard request', async () => {

  logArchitectureFreezeStartup();

  if (req.method !== 'GET') {

    return res.status(405).json({ error: 'Method not allowed' });

  }



  try {

    const authSpan = profStart('Load auth user');
    const user = await getAuthUserFromRequest(req);
    profEnd(authSpan);

    if (!user) return unauthorized(res);



    const supabaseAdmin = getSupabaseAdmin();



    const batchSpan = profStart('Supabase parallel batch (profile/subscription/grants)');
    const [{ data: profile }, { data: activeSubscriptions }, { data: expiredSubscription }, { count: trialCount }, { data: hourGrantsRaw }] =

      await Promise.all([

        supabaseAdmin

          .from('users')

          .select('email, phone, phone_verified, full_name, wallet_balance')

          .eq('id', user.id)

          .maybeSingle(),

        supabaseAdmin

          .from('subscriptions')

          .select('*')

          .eq('user_id', user.id)

          .in('status', ACTIVE_STATUSES)

          .order('created_at', { ascending: false })

          .limit(20),

        supabaseAdmin

          .from('subscriptions')

          .select('*')

          .eq('user_id', user.id)

          .eq('status', 'expired')

          .order('expires_at', { ascending: false })

          .limit(1)

          .maybeSingle(),

        supabaseAdmin

          .from('subscriptions')

          .select('id', { count: 'exact', head: true })

          .eq('user_id', user.id)

          .eq('is_trial', true),

        supabaseAdmin

          .from('manual_hour_grants')

          .select('id, hours_granted, hours_used, expires_at, customer_note, status, gpu_plan, created_at, updated_at')

          .eq('user_id', user.id)

          .eq('status', 'active')

          .order('created_at', { ascending: false }),

      ]);

    profEnd(batchSpan);



    const now = Date.now();

    const activeHourGrants = (hourGrantsRaw ?? []).filter((grant) => {

      const remaining = Math.max(0, Number(grant.hours_granted) - Number(grant.hours_used ?? 0));

      if (remaining <= 0) return false;

      if (!grant.expires_at) return true;

      return new Date(grant.expires_at).getTime() > now;

    });

    const totalGrantedHoursRemaining = activeHourGrants.reduce(

      (sum, grant) => sum + Math.max(0, Number(grant.hours_granted) - Number(grant.hours_used ?? 0)),

      0,

    );

    const nearestGrantExpiry = activeHourGrants

      .filter((g) => g.expires_at)

      .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())[0]?.expires_at ?? null;

    const grantNotes = activeHourGrants.map((g) => g.customer_note).filter(Boolean);

    const grantsRecentlyUpdated = activeHourGrants.some(

      (g) =>

        g.updated_at &&

        g.created_at &&

        new Date(g.updated_at).getTime() - new Date(g.created_at).getTime() > 60_000,

    );



    const grantItems = activeHourGrants.map((grant) => {

      const hoursRemaining = Math.max(0, Number(grant.hours_granted) - Number(grant.hours_used ?? 0));

      return {

        id: grant.id,

        hoursRemaining,

        gpuPlan: grant.gpu_plan ?? 'pro',

        expiresAt: grant.expires_at,

        customerNote: grant.customer_note,

        recentlyUpdated:

          grant.updated_at &&

          grant.created_at &&

          new Date(grant.updated_at).getTime() - new Date(grant.created_at).getTime() > 60_000,

      };

    });



    const displayName =

      profile?.full_name?.trim() ||

      profile?.email?.split('@')[0] ||

      user.user_metadata?.phone ||

      user.email?.split('@')[0] ||

      'bạn';



    const machineSpanEarly = profStart('getActiveMachineForUser (early)');
    const activeMachineEarly = await getActiveMachineForUser(supabaseAdmin, user.id);
    profEnd(machineSpanEarly);

    const activeSubscription = pickPreferredActiveSubscription(
      activeSubscriptions ?? [],
      activeMachineEarly,
    );
    const subscription = activeSubscription ?? null;
    let driftSync = null;

    if (subscription) {
      const repairSpan = profStart('repairUserBillingState');
      const repair = await repairUserBillingState(supabaseAdmin, user.id);
      profEnd(repairSpan);
      if (repair.closed > 0 || repair.clearedBootBilling > 0) {
        const invSpan = profStart('syncUserPlanInventory');
        await syncUserPlanInventory(supabaseAdmin, user.id);
        profEnd(invSpan);
      }
      const correlationId = createCorrelationId();
      const syncSpan = profStart('runReadPathProjectionFirst (call)');
      driftSync = toSyncShape(
        await runReadPathProjectionFirst(supabaseAdmin, user.id, {
          correlationId,
          source: 'dashboard_me',
          subscription: subscriptionPrefetchFromDashboardRow(subscription),
          machine: activeMachineEarly,
        }),
      );
      profEnd(syncSpan);
    }

    const refreshSpan = profStart('Refresh subscription');
    const { data: refreshedSubscription } = subscription
      ? await supabaseAdmin
          .from('subscriptions')
          .select('*')
          .eq('id', subscription.id)
          .maybeSingle()
      : { data: null };
    profEnd(refreshSpan);

    const syncedSubscription = (() => {
      const base = refreshedSubscription ?? subscription;
      if (driftSync?.changed && driftSync.subscription) {
        return base ? { ...base, ...driftSync.subscription } : driftSync.subscription;
      }
      return base;
    })();



    const billingType =

      syncedSubscription?.billing === 'hourly'

        ? 'hourly'

        : syncedSubscription && ['combo1', 'combo2'].includes(syncedSubscription.billing)

          ? 'combo'

          : null;

    const machineSpan = profStart('getActiveMachineForUser (call)');
    let activeMachine = activeMachineEarly ?? (await getActiveMachineForUser(supabaseAdmin, user.id));
    if (driftSync?.changed && driftSync.machine) {
      activeMachine = driftSync.machine;
    } else if (
      driftSync?.changed &&
      !driftSync.machine &&
      activeMachineEarly &&
      ['creating', 'starting', 'running'].includes(String(activeMachineEarly.status ?? ''))
    ) {
      // Keep the live session visible if drift falsely nulled it (wrong offline subscription).
      activeMachine = activeMachineEarly;
    }
    profEnd(machineSpan);
    let inventoryRows = null;
    let billablePlans = undefined;
    if (syncedSubscription) {
      if (!activeMachine) {
        const invSpan = profStart('syncUserPlanInventory (idle)');
        inventoryRows = await syncUserPlanInventory(supabaseAdmin, user.id, {
          grants: grantsPrefetchForInventorySync(hourGrantsRaw),
        });
        profEnd(invSpan);
        billablePlans = billablePlansFromInventoryRows(inventoryRows);
      } else {
        const plansSpan = profStart('fetchOrderedBillablePlansForUser');
        billablePlans = await fetchOrderedBillablePlansForUser(supabaseAdmin, user.id);
        profEnd(plansSpan);
      }
    }

    const machineRecord = snapshotToMachineRecord(syncedSubscription, activeMachine, user.id);
    const machineSessionView = resolveMachineSessionView(machineRecord, {
      envName: syncedSubscription?.env_name,
      billingStarted: Boolean(activeMachine?.billing_started_at),
    });

    const billingView = await resolveBillingSessionView(supabaseAdmin, user.id, {
      machine: activeMachine,
      machineSessionPhase: machineSessionView?.phase ?? 'idle',
      walletBalance: Number(profile?.wallet_balance ?? 0),
      gpuService: activeMachine ? getGpuServiceForMachine(activeMachine) : getGpuService(),
      billablePlans: billablePlans,
      subscriptionPackageHours: syncedSubscription?.hours_total ?? null,
      tryOpenBillableSession: Boolean(
        activeMachine &&
          String(activeMachine.status ?? '') === 'running' &&
          activeMachine.instance_id,
      ),
    });

    const remaining =
      billingView.remainingHours != null
        ? {
            remainingHours: billingView.remainingHours,
            totalEntitlementHours: billingView.totalEntitlementHours,
            currentSessionElapsedHours: billingView.currentSessionElapsedHours,
            settledSessionUsageHours: billingView.settledSessionUsageHours,
            primaryPlanType: billingView.primaryPlanType,
            walletBalance: billingView.walletBalance,
          }
        : null;

    const resumeDecision = decideResumeFromLoadedState({
      subscription: syncedSubscription,
      machine: activeMachine,
      liveStatus: null,
      sessionStatus: null,
    });

    return res.status(200).json({

      user: {

        id: user.id,

        email: profile?.email ?? user.email,

        phone: profile?.phone ?? user.user_metadata?.phone ?? null,

        phoneVerified: profile?.phone_verified ?? false,

        fullName: profile?.full_name ?? null,

        displayName,

        walletBalance: Number(profile?.wallet_balance ?? 0),

      },

      subscription: syncedSubscription,

      expiredSubscription: activeSubscription ? null : expiredSubscription ?? null,

      billingType,

      billing: syncedSubscription?.billing ?? null,

      hasUsedTrial: (trialCount ?? 0) > 0,

      hourGrants: {

        totalHoursRemaining: totalGrantedHoursRemaining,

        nearestExpiry: nearestGrantExpiry,

        notes: grantNotes,

        recentlyUpdated: grantsRecentlyUpdated,

        items: grantItems,

      },

      remaining,

      machineSessionView,

      billingView,

      sessionResume: {
        shouldResume: resumeDecision.shouldResume,
        allowNewProvision: resumeDecision.allowNewProvision,
        duplicateStartPrevented: resumeDecision.duplicateStartPrevented,
        currentState: resumeDecision.currentState,
        progressStep: resumeDecision.progressStep,
        reason: resumeDecision.reason,
        machineId: activeMachine?.id != null ? String(activeMachine.id) : null,
        instanceId: activeMachine?.instance_id != null ? String(activeMachine.instance_id) : null,
        provider: activeMachine?.provider != null ? String(activeMachine.provider) : null,
        gpuType: activeMachine?.gpu_type ?? activeMachine?.gpu_line ?? syncedSubscription?.gpu_label ?? null,
        lease: syncedSubscription
          ? {
              leaseId: syncedSubscription.provisioning_lease_id ?? null,
              expiresAt: syncedSubscription.provisioning_lease_expires_at ?? null,
              heartbeatAt: syncedSubscription.provisioning_heartbeat_at ?? null,
              owner: syncedSubscription.provisioning_lease_owner ?? null,
              startedAt: syncedSubscription.provisioning_started_at ?? null,
            }
          : null,
      },

    });

  } catch (err) {

    return res.status(500).json({ error: err.message || 'Không tải được dashboard.' });

  } finally {

    console.log('[prof]\n' + renderProfTree());

  }

  });

}

