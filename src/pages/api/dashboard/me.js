import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getGpuService, repairUserBillingState, readRemainingForMachine } from '@/lib/gpu';
import { mapRemainingStatusFields } from '@/lib/gpu/api-scb';
import { REMAINING_STATE_OK } from '@/lib/gpu/remaining-time';
import {
  getActiveMachineForUser,
  syncSubscriptionWithMachineState,
} from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { syncUserPlanInventory } from '@/lib/user-plan-inventory';



const ACTIVE_STATUSES = ['active', 'provisioning', 'pending_payment'];



export default async function handler(req, res) {

  if (req.method !== 'GET') {

    return res.status(405).json({ error: 'Method not allowed' });

  }



  try {

    const user = await getAuthUserFromRequest(req);

    if (!user) return unauthorized(res);



    const supabaseAdmin = getSupabaseAdmin();



    const [{ data: profile }, { data: activeSubscription }, { data: expiredSubscription }, { count: trialCount }, { data: hourGrantsRaw }] =

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

          .limit(1)

          .maybeSingle(),

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



    const subscription = activeSubscription ?? null;

    if (subscription) {
      const repair = await repairUserBillingState(supabaseAdmin, user.id);
      if (repair.closed > 0 || repair.clearedBootBilling > 0) {
        await syncUserPlanInventory(supabaseAdmin, user.id);
      }
      await syncSubscriptionWithMachineState(supabaseAdmin, getGpuService(), user.id);
    }

    const { data: refreshedSubscription } = subscription
      ? await supabaseAdmin
          .from('subscriptions')
          .select('*')
          .eq('id', subscription.id)
          .maybeSingle()
      : { data: null };

    const syncedSubscription = refreshedSubscription ?? subscription;



    const billingType =

      syncedSubscription?.billing === 'hourly'

        ? 'hourly'

        : syncedSubscription && ['combo1', 'combo2'].includes(syncedSubscription.billing)

          ? 'combo'

          : null;

    const activeMachine = await getActiveMachineForUser(supabaseAdmin, user.id);
    const remainingRead = activeMachine
      ? await readRemainingForMachine(supabaseAdmin, user.id, activeMachine)
      : { remaining: null, walletBalance: null };
    const remainingFields = mapRemainingStatusFields(remainingRead);

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

      remaining: remainingRead.remaining?.state === REMAINING_STATE_OK
        ? {
            ...remainingFields,
            primaryPlanType: remainingRead.remaining.primaryPlanType,
            walletBalance: remainingRead.walletBalance,
          }
        : null,

    });

  } catch (err) {

    return res.status(500).json({ error: err.message || 'Không tải được dashboard.' });

  }

}

