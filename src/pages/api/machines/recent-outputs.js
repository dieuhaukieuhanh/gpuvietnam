import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { buildConsumerEndpoint, isEndpointReadyForTraffic } from '@/lib/endpoint-utils';
import { fetchRecentOutputImages } from '@/lib/gpu/metrics';
import { getActiveMachineForUser } from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const limit = Math.min(6, Math.max(1, Number.parseInt(String(req.query.limit ?? '6'), 10) || 6));
    const supabaseAdmin = getSupabaseAdmin();
    const machine = await getActiveMachineForUser(supabaseAdmin, user.id);

    if (!machine || machine.status !== 'running') {
      return res.status(200).json({ images: [] });
    }

    const healthOk = true;
    if (!isEndpointReadyForTraffic(machine, healthOk)) {
      return res.status(200).json({ images: [] });
    }

    const { ip, port } = buildConsumerEndpoint(machine, healthOk);
    if (!ip || port == null) {
      return res.status(200).json({ images: [] });
    }

    const images = await fetchRecentOutputImages(ip, port, limit);
    return res.status(200).json({ images });
  } catch (err) {
    console.error('[machines/recent-outputs]', err);
    return res.status(500).json({ error: err.message || 'Không tải được ảnh gần đây.' });
  }
}
