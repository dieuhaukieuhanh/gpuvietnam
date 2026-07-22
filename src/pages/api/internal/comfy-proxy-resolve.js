import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  isComfyProxyEnabled,
  resolveComfyProxySharedSecret,
  resolveComfyAccessToken,
} from '@/lib/comfy-proxy';

/**
 * GET /api/internal/comfy-proxy-resolve?token=...
 * Worker to origin lookup. Auth: Bearer COMFY_PROXY_SECRET.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isComfyProxyEnabled()) {
    return res.status(503).json({ error: 'disabled' });
  }

  const secret = resolveComfyProxySharedSecret();
  if (!secret) {
    return res.status(503).json({ error: 'secret not configured' });
  }

  const auth = String(req.headers.authorization ?? '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!bearer || !timingSafeEqualString(bearer, secret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const token = String(req.query.token ?? '').trim();
  if (!token) {
    return res.status(400).json({ error: 'missing token' });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const resolved = await resolveComfyAccessToken(supabaseAdmin, token);
    if (!resolved) {
      return res.status(404).json({ error: 'not found' });
    }

    return res.status(200).json({
      upstreamUrl: resolved.upstreamUrl,
      userId: resolved.userId,
      machineId: resolved.machineId,
      expiresAt: resolved.expiresAt,
      mode: resolved.mode,
    });
  } catch (error) {
    console.error('[internal/comfy-proxy-resolve]', error);
    return res.status(500).json({ error: 'resolve failed' });
  }
}

/**
 * @param {string} a
 * @param {string} b
 */
function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}