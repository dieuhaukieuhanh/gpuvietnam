/**
 * Smart Restore Level 1 — config.
 * Restore: workflows + settings + outputs only (no models / custom nodes).
 */

/** R2 prefixes included in Level 1 workspace continuity. */
export const WORKSPACE_RESTORE_PREFIXES = Object.freeze(['workflows', 'outputs', 'settings']);

/**
 * Below this total size (bytes) of Level-1 prefixes → auto restore without asking.
 * Override: WORKSPACE_RESTORE_SMALL_BYTES
 */
export const WORKSPACE_RESTORE_SMALL_BYTES_DEFAULT = 200 * 1024 * 1024;

/** Max individual R2 files to pull on fallback restore (periodic layout). */
export const WORKSPACE_RESTORE_MAX_FILES = 400;

export function resolveWorkspaceRestoreSmallBytes() {
  const rawEnv = String(process.env.WORKSPACE_RESTORE_SMALL_BYTES ?? '').trim();
  if (!rawEnv) return WORKSPACE_RESTORE_SMALL_BYTES_DEFAULT;
  const raw = Number(rawEnv);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return WORKSPACE_RESTORE_SMALL_BYTES_DEFAULT;
}

/** Dest paths on the GPU container. */
export const WORKSPACE_RESTORE_DEST = Object.freeze({
  workflows: '/app/ComfyUI/user/default/workflows',
  outputs: '/app/ComfyUI/output',
  settings: '/app/ComfyUI/user/default',
});

export const WORKSPACE_RESTORE_TICK = Object.freeze({
  IDLE: 'workspace_idle',
  RESTORING: 'workspace_restoring',
  READY: 'workspace_ready',
  CHOICE: 'workspace_choice',
  SKIPPED: 'workspace_skipped',
  FAILED: 'workspace_failed',
});
