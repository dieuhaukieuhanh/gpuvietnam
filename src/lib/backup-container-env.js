import crypto from 'crypto';
import { getBackupIntervalsForPlan } from './backup-auto-policy.js';
import { resolvePublicApiBaseUrl } from './machine-backup-token.js';

/**
 * Random secret for stop-time HTTP flush (Authorization: Bearer …).
 */
export function createBackupFlushSecret() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Inject backup-related env into container env map (no R2 secrets).
 * @param {Record<string, string>} env
 * @param {{
 *   userId?: string | null;
 *   machineId?: string | null;
 *   backupToken?: string | null;
 *   presignUrl?: string | null;
 *   skipModels?: boolean;
 *   flushSecret?: string | null;
 *   planKey?: string | null;
 *   intervalsByPlan?: import('./backup-auto-policy.js').BackupPlanIntervals extends never
 *     ? never
 *     : Record<string, { outputsSec: number; workflowsSec: number }> | null;
 *   outputsIntervalSec?: number | null;
 *   workflowsIntervalSec?: number | null;
 * }} [options]
 * @returns {Record<string, string>}
 */
export function injectBackupContainerEnv(env, options = {}) {
  const out = env && typeof env === 'object' ? env : {};

  if (options.backupToken && options.presignUrl) {
    out.GPUVIETNAM_BACKUP_TOKEN = String(options.backupToken);
    out.GPUVIETNAM_PRESIGN_URL = String(options.presignUrl);
    try {
      const u = new URL(String(options.presignUrl));
      u.pathname = '/api/storage/backup-report';
      u.search = '';
      u.hash = '';
      out.GPUVIETNAM_BACKUP_REPORT_URL = u.toString();
    } catch {
      /* ignore */
    }

    const intervals = getBackupIntervalsForPlan(options.planKey, options.intervalsByPlan ?? null);
    const outputsSec =
      options.outputsIntervalSec != null && Number.isFinite(Number(options.outputsIntervalSec))
        ? Math.max(30, Math.floor(Number(options.outputsIntervalSec)))
        : intervals.outputsSec;
    const workflowsSec =
      options.workflowsIntervalSec != null && Number.isFinite(Number(options.workflowsIntervalSec))
        ? Math.max(30, Math.floor(Number(options.workflowsIntervalSec)))
        : intervals.workflowsSec;
    out.GPUVIETNAM_BACKUP_OUTPUTS_INTERVAL = String(outputsSec);
    out.GPUVIETNAM_BACKUP_WORKFLOWS_INTERVAL = String(workflowsSec);
  }
  if (options.userId) {
    out.GPUVIETNAM_USER_ID = String(options.userId);
  }
  if (options.machineId) {
    out.GPUVIETNAM_MACHINE_ID = String(options.machineId);
  }
  if (options.skipModels) {
    out.GPUVIETNAM_BACKUP_SKIP_MODELS = '1';
  }
  if (options.flushSecret) {
    out.GPUVIETNAM_BACKUP_FLUSH_SECRET = String(options.flushSecret);
  }

  const publicApi = resolvePublicApiBaseUrl();
  // Fallback: container must be able to reach the app to send boot events.
  // Vercel prod may not always set GPUVIETNAM_PUBLIC_API_URL explicitly.
  out.GPUVIETNAM_PUBLIC_API_URL = publicApi || 'https://gpuvietnam.com';

  return out;
}