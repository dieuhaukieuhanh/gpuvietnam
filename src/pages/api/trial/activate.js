import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import {
  computeExpiresAt,
  getGpuLabel,
  TRIAL_HOURS,
  TRIAL_VALIDITY_DAYS,
} from '@/lib/plan-hours';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { env, icon, desc, workstation } = req.body ?? {};
    const envName = env || workstation || 'ComfyUI — Character & Art';
    const now = new Date().toISOString();
    const expiresAt = computeExpiresAt(TRIAL_VALIDITY_DAYS);

    const supabaseAdmin = getSupabaseAdmin();

    const { data: existing } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_trial', true)
      .in('status', ['active', 'provisioning'])
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Bạn đã có gói dùng thử đang hoạt động.' });
    }

    await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'replaced' })
      .eq('user_id', user.id)
      .in('status', ['active', 'pending', 'provisioning', 'pending_payment']);

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan: 'Starter',
        billing: 'hourly',
        env_name: envName,
        env_icon: icon ?? '👤',
        env_desc: desc ?? null,
        gpu_label: getGpuLabel('Starter'),
        hours_total: TRIAL_HOURS,
        hours_used: 0,
        status: 'active',
        server_status: 'offline',
        is_trial: true,
        expires_at: expiresAt,
        activated_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      subscription: data,
      message: 'Dùng thử 3 giờ đã được kích hoạt.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không kích hoạt được dùng thử.' });
  }
}
