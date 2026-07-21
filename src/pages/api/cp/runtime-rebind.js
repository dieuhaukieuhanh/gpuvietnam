import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rebindComfyProxyToRuntime } from '@/lib/cp-runtime/runtime-rebind';

/**
 * B2.3 — Rebind work.* / proxy to new Runtime upstream.
 * POST /api/cp/runtime-rebind
 * { machineId, nextUpstreamUrl, previousUpstreamUrl?, runtimeId? }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const machineId = String(body.machineId ?? '').trim();
  const nextUpstreamUrl = String(body.nextUpstreamUrl ?? body.upstreamUrl ?? '').trim();

  if (!machineId || !nextUpstreamUrl) {
    return res.status(400).json({ error: 'Thiếu machineId hoặc nextUpstreamUrl.' });
  }

  try {
    const result = await rebindComfyProxyToRuntime(getSupabaseAdmin(), {
      userId: user.id,
      machineId,
      nextUpstreamUrl,
      previousUpstreamUrl: body.previousUpstreamUrl ?? null,
      runtimeId: body.runtimeId ?? null,
      ttlSeconds: body.ttlSeconds,
    });

    return res.status(200).json({
      workUrl: result.workUrl,
      expiresAt: result.expiresAt,
      mode: result.mode,
      plan: {
        changed: result.plan.changed,
        nextUpstreamUrl: result.plan.nextUpstreamUrl,
        previousUpstreamUrl: result.plan.previousUpstreamUrl,
        proxyEnabled: result.plan.proxyEnabled,
      },
      // Never echo raw upstream to client when proxy mode — workUrl is brand URL.
      tokenIssued: Boolean(result.token),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/cp/runtime-rebind]', message);
    return res.status(500).json({ error: message || 'Rebind thất bại.' });
  }
}
