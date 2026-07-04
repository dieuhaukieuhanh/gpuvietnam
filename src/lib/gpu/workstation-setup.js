/**
 * Restart-only architecture: workspace switching is NOT done at runtime.
 * Workflows are applied at container boot via setup-workstation.sh + GPUVIETNAM_* env vars.
 *
 * SSH helpers in this module are retained for maintenance / manual ops only.
 * Production SSH for backup/restore lives in machine-backup.js + machine-ssh.js.
 */

import fs from 'fs';
import path from 'path';
import { VastClient } from '@/lib/gpu/providers/vast/vast-client.js';
import {
  getWorkflowFilesForSlug,
  resolveEnvName,
  resolveWorkstationSlug,
  WORKSTATION_STOCK_FILES,
} from '@/lib/workstation-env';
import {
  isSshConfigured,
  resolveSshTargetFromVast,
  sshExec,
  sshWriteFile,
} from '@/lib/machine-ssh';

const WORKFLOWS_DIR = path.join(process.cwd(), 'workflows');
const REMOTE_WORKFLOWS_DIR = '/app/ComfyUI/user/default/workflows';
const REMOTE_MARKER = '/app/ComfyUI/user/default/gpuvietnam-env.txt';
const REMOTE_SETUP_SCRIPT = '/app/setup-workstation.sh';

/**
 * @param {string} filename
 */
function readWorkflowFile(filename) {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, filename), 'utf8');
}

/**
 * Apply workstation workflows on a running GPU instance via SSH (maintenance only).
 * Not used for workspace switching — Restart-only architecture uses container boot env.
 *
 * @deprecated Not called by API routes. Use setup-workstation.sh at container boot instead.
 * @param {Record<string, unknown>} machine
 * @param {string | null | undefined} envName
 */
export async function ensureWorkstationApplied(machine, envName) {
  const resolvedName = resolveEnvName(envName ?? machine.template);
  const slug = resolveWorkstationSlug(resolvedName);

  if (!isSshConfigured()) {
    return { applied: false, reason: 'ssh_not_configured', envName: resolvedName, slug };
  }

  const instanceId = String(machine.instance_id ?? '');
  if (!instanceId) {
    return { applied: false, reason: 'missing_instance_id', envName: resolvedName, slug };
  }

  try {
    const client = new VastClient();
    const vastInstance = await client.getInstance(instanceId);

    const sshTarget = resolveSshTargetFromVast(vastInstance);
    if (!sshTarget) {
      return { applied: false, reason: 'no_ssh_target', envName: resolvedName, slug };
    }

    try {
      const markerResult = await sshExec(
        sshTarget,
        `cat "${REMOTE_MARKER}" 2>/dev/null || true`,
      );
      if (markerResult.stdout.trim() === resolvedName) {
        return { applied: true, cached: true, via: 'marker', envName: resolvedName, slug };
      }
    } catch {
      // Continue with apply.
    }

    try {
      await sshExec(sshTarget, `test -x "${REMOTE_SETUP_SCRIPT}"`);
      await sshExec(
        sshTarget,
        `GPUVIETNAM_WORKSTATION=${slug} GPUVIETNAM_ENV_NAME='${resolvedName.replace(/'/g, `'\\''`)}' "${REMOTE_SETUP_SCRIPT}"`,
      );
      return { applied: true, via: 'setup_script', envName: resolvedName, slug };
    } catch {
      // Fall back to copying workflow JSON files directly.
    }

    for (const stockFile of WORKSTATION_STOCK_FILES) {
      try {
        await sshExec(sshTarget, `rm -f "${REMOTE_WORKFLOWS_DIR}/${stockFile}"`);
      } catch {
        // Ignore missing files.
      }
    }

    for (const filename of getWorkflowFilesForSlug(slug)) {
      const content = readWorkflowFile(filename);
      await sshWriteFile(sshTarget, content, `${REMOTE_WORKFLOWS_DIR}/${filename}`);
    }

    await sshWriteFile(sshTarget, resolvedName, REMOTE_MARKER);

    console.info('[workstation-setup] Applied workstation via SSH (maintenance)', {
      machineId: machine.id,
      envName: resolvedName,
      slug,
    });

    return { applied: true, via: 'ssh_copy', envName: resolvedName, slug };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[workstation-setup] Failed to apply workstation:', message);
    return { applied: false, reason: message, envName: resolvedName, slug };
  }
}
