import { isR2Configured, createPresignedDownloadUrl } from '@/lib/r2-client';
import {
  buildStockModelR2Key,
  sanitizeStockModelRelativeKey,
} from '@/lib/stock-models';

/**
 * GET /api/storage/stock/models/checkpoints/....safetensors
 * → 302 to short-lived R2 presigned GET (allowlisted stock only).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!isR2Configured()) {
      return res.status(503).json({ error: 'R2 chưa được cấu hình.' });
    }

    const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path];
    const relative = parts.filter(Boolean).join('/');
    const sanitized = sanitizeStockModelRelativeKey(relative);
    if (!sanitized.ok) {
      return res.status(400).json({ error: sanitized.error });
    }

    const { downloadUrl, expiresIn } = await createPresignedDownloadUrl(
      buildStockModelR2Key(sanitized.key),
      { expiresIn: 900 },
    );

    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Stock-Model-Expires-In', String(expiresIn));
    return res.redirect(302, downloadUrl);
  } catch (err) {
    console.error('[storage/stock/models]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Không tạo được URL tải model.',
    });
  }
}
