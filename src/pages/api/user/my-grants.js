import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function unusedHours(grant) {
  return Math.max(0, Number(grant.hours_granted) - Number(grant.hours_used ?? 0));
}

function isGrantActive(grant) {
  if (grant.status !== 'active') return false;
  if (!grant.expires_at) return true;
  return new Date(grant.expires_at).getTime() > Date.now();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from('manual_hour_grants')
      .select(
        'id, hours_granted, hours_used, expires_at, customer_note, status, gpu_plan, created_at, updated_at',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const activeGrants = (data ?? [])
      .filter(isGrantActive)
      .map((grant) => ({
        id: grant.id,
        hoursGranted: grant.hours_granted,
        hoursUsed: grant.hours_used ?? 0,
        hoursRemaining: unusedHours(grant),
        expiresAt: grant.expires_at,
        customerNote: grant.customer_note,
        gpuPlan: grant.gpu_plan ?? 'pro',
        createdAt: grant.created_at,
        updatedAt: grant.updated_at,
        recentlyUpdated:
          grant.updated_at &&
          grant.created_at &&
          new Date(grant.updated_at).getTime() - new Date(grant.created_at).getTime() > 60_000,
      }))
      .filter((g) => g.hoursRemaining > 0);

    const totalHoursRemaining = activeGrants.reduce((sum, g) => sum + g.hoursRemaining, 0);
    const nearestExpiry = activeGrants
      .filter((g) => g.expiresAt)
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0]?.expiresAt ?? null;
    const notes = activeGrants.map((g) => g.customerNote).filter(Boolean);
    const recentlyUpdated = activeGrants.some((g) => g.recentlyUpdated);

    return res.status(200).json({
      grants: activeGrants,
      summary: {
        totalHoursRemaining,
        nearestExpiry,
        notes,
        recentlyUpdated,
        items: activeGrants.map((g) => ({
          id: g.id,
          hoursRemaining: g.hoursRemaining,
          gpuPlan: g.gpuPlan,
          expiresAt: g.expiresAt,
          customerNote: g.customerNote,
          recentlyUpdated: g.recentlyUpdated,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không tải được giờ tặng.' });
  }
}
