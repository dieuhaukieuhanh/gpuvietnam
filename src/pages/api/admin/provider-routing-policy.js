/**
 * Admin API: Provider routing policy (Hạ tầng SoT).
 *
 * GET → { policy }
 * PUT → body { providers, priority } — applies to NEW Start/rent only
 */
import { requireAdmin } from '@/lib/admin-auth';
import {
  PROVIDER_IDS,
  loadProviderRoutingPolicyAsync,
  writeProviderRoutingPolicyAsync,
  normalizeProviderRoutingPolicy,
} from '@/lib/gpu/provider-routing-policy.js';

function validateBody(body) {
  const errors = [];
  if (body == null || typeof body !== 'object') {
    return ['Body must be a JSON object'];
  }
  if (body.providers !== undefined) {
    if (typeof body.providers !== 'object' || Array.isArray(body.providers)) {
      errors.push('providers must be an object');
    } else {
      for (const [key, value] of Object.entries(body.providers)) {
        if (!PROVIDER_IDS.includes(key)) {
          errors.push(`providers.${key}: invalid (valid: ${PROVIDER_IDS.join(', ')})`);
        }
        if (typeof value !== 'boolean') {
          errors.push(`providers.${key}: must be boolean`);
        }
      }
    }
  }
  if (body.priority !== undefined) {
    if (!Array.isArray(body.priority)) {
      errors.push('priority must be an array');
    } else {
      for (const p of body.priority) {
        if (!PROVIDER_IDS.includes(String(p))) {
          errors.push(`priority: invalid provider ${p}`);
        }
      }
    }
  }
  return errors;
}

export default async function handler(req, res) {
  const adminCtx = await requireAdmin(req, res);
  if (!adminCtx) return;

  if (req.method === 'GET') {
    try {
      const policy = await loadProviderRoutingPolicyAsync();
      return res.status(200).json({
        policy,
        note: 'Áp dụng từ phiên Start / thuê máy tiếp theo — không cắt khách đang chạy.',
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to read provider routing policy',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (req.method === 'PUT') {
    const errors = validateBody(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    try {
      const current = await loadProviderRoutingPolicyAsync();
      const merged = normalizeProviderRoutingPolicy({
        providers: { ...current.providers, ...(req.body.providers ?? {}) },
        priority: req.body.priority ?? current.priority,
      });
      const enabledCount = PROVIDER_IDS.filter((id) => merged.providers[id]).length;
      if (enabledCount === 0) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: ['Phải bật ít nhất một provider'],
        });
      }
      const updatedBy =
        adminCtx?.user?.email || adminCtx?.email || adminCtx?.userId || 'admin';
      const policy = await writeProviderRoutingPolicyAsync(merged, { updatedBy });
      return res.status(200).json({
        policy,
        note: 'Đã lưu. Có hiệu lực từ lần Start / thuê máy mới — phiên đang chạy không đổi.',
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to save provider routing policy',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
}
