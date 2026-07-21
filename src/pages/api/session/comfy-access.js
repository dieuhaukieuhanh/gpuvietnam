import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  isComfyProxyEnabled,
  resolveComfyProxyBaseUrl,
  issueComfyAccessToken,
} from '@/lib/comfy-proxy';
import { buildConsumerEndpoint } from '@/lib/endpoint-utils';
import { getActiveMachineForUser } from '@/lib/machines';
import { isProjectionTrafficReady } from '@/lib/scb-read-path';

/**
 * POST /api/session/comfy-access
 * Mint a short-lived brand-domain work URL (Level C proxy). Upstream never returned.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isComfyProxyEnabled()) {
    return res.status(503).json({
      error: 'Comfy proxy chưa bật.',
      code: 'COMFY_PROXY_DISABLED',
    });
  }

  if (!resolveComfyProxyBaseUrl()) {
    return res.status(503).json({
      error: 'COMFY_PROXY_BASE_URL chưa cấu hình.',
      code: 'COMFY_PROXY_BASE_MISSING',
    });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const machine = await getActiveMachineForUser(supabaseAdmin, user.id);
    if (!machine) {
      return res.status(404).json({ error: 'Không có máy đang chạy.' });
    }

    const healthOk = isProjectionTrafficReady(machine);
    const endpoint = buildConsumerEndpoint(machine, healthOk);
    if (!endpoint.comfyUrl) {
      return res.status(409).json({
        error: 'ComfyUI chưa sẵn sàng. Thử lại sau vài giây.',
        code: 'COMFY_NOT_READY',
      });
    }

    const issued = await issueComfyAccessToken(supabaseAdmin, {
      userId: user.id,
      machineId: String(machine.id),
      upstreamUrl: endpoint.comfyUrl,
    });

    return res.status(200).json({
      workUrl: issued.workUrl,
      expiresAt: issued.expiresAt,
    });
  } catch (error) {
    console.error('[session/comfy-access]', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Không tạo được link ComfyUI.',
    });
  }
}
