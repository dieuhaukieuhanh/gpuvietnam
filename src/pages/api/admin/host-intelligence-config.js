/**
 * Admin API: Host Intelligence Config — GET/PUT runtime config.
 *
 * GET  → returns { config, summary } where summary = getHostIntelligenceSummary()
 * PUT  → body { enabled, targetPerLine, providers } — validates + writes JSON file
 */
import { requireAdmin } from '@/lib/admin-auth';
import {
  getHostIntelligenceSummary,
} from '@/lib/gpu/host-reputation/index.js';
import {
  readHostIntelligenceConfig,
  writeHostIntelligenceConfig,
  HOST_INTELLIGENCE_CONFIG_PATH,
} from '@/lib/gpu/host-reputation/host-reputation-config.js';
import fs from 'fs';
import path from 'path';

const VALID_GPU_LINES = ['rtx3090', 'rtx4090_1x', 'rtx5090_1x'];
const VALID_PROVIDERS = ['vast', 'clore'];

function validateConfig(body) {
  const errors = [];
  if (body == null || typeof body !== 'object') {
    return ['Body must be a JSON object'];
  }

  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  if (body.targetPerLine !== undefined) {
    if (typeof body.targetPerLine !== 'object' || Array.isArray(body.targetPerLine)) {
      errors.push('targetPerLine must be an object');
    } else {
      for (const [key, value] of Object.entries(body.targetPerLine)) {
        if (!VALID_GPU_LINES.includes(key)) {
          errors.push(`targetPerLine.${key}: invalid GPU line (valid: ${VALID_GPU_LINES.join(', ')})`);
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 20) {
          errors.push(`targetPerLine.${key}: must be a number 0-20`);
        }
      }
    }
  }

  if (body.providers !== undefined) {
    if (typeof body.providers !== 'object' || Array.isArray(body.providers)) {
      errors.push('providers must be an object');
    } else {
      for (const [key, value] of Object.entries(body.providers)) {
        if (!VALID_PROVIDERS.includes(key)) {
          errors.push(`providers.${key}: invalid provider (valid: ${VALID_PROVIDERS.join(', ')})`);
        }
        if (typeof value !== 'boolean') {
          errors.push(`providers.${key}: must be a boolean`);
        }
      }
    }
  }

  return errors;
}

export default async function handler(req, res) {
  // Auth
  const adminCtx = await requireAdmin(req, res);
  if (!adminCtx) return;

  if (req.method === 'GET') {
    try {
      const config = readHostIntelligenceConfig();
      const summary = getHostIntelligenceSummary();
      return res.status(200).json({ config, summary });
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to read config',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (req.method === 'PUT') {
    const errors = validateConfig(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }

    try {
      const current = readHostIntelligenceConfig();
      const updated = {
        ...current,
        ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
        ...(req.body.targetPerLine !== undefined ? {
          targetPerLine: { ...current.targetPerLine, ...req.body.targetPerLine },
        } : {}),
        ...(req.body.providers !== undefined ? {
          providers: { ...current.providers, ...req.body.providers },
        } : {}),
      };
      writeHostIntelligenceConfig(updated);
      const summary = getHostIntelligenceSummary();
      return res.status(200).json({ config: updated, summary });
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to write config',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
