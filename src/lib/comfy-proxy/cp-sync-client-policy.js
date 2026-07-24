/**
 * A1 M3 — CP sync contract helpers (conflict policy, no second SoT).
 * Keeps Workspace extension behavior testable without a browser.
 */

/**
 * Decide how Workspace should react to a comfy-sync PATCH response.
 * @param {{ status: number; data?: any }} result
 * @returns {{
 *   action: 'saved' | 'skipped_empty' | 'conflict_take_server' | 'error';
 *   overwriteServerWithoutExpected: boolean;
 * }}
 */
export function resolveComfySyncPatchOutcome(result) {
  const status = Number(result?.status ?? 0);
  const data = result?.data && typeof result.data === 'object' ? result.data : {};

  if (data.skipped === 'empty_document_overwrite') {
    return {
      action: 'skipped_empty',
      overwriteServerWithoutExpected: false,
    };
  }

  if (status === 409 && data.code === 'REVISION_CONFLICT') {
    // M3 DoD: never silently overwrite a newer CP revision.
    return {
      action: 'conflict_take_server',
      overwriteServerWithoutExpected: false,
    };
  }

  if (status >= 200 && status < 300 && data.ok !== false) {
    return {
      action: 'saved',
      overwriteServerWithoutExpected: false,
    };
  }

  return {
    action: 'error',
    overwriteServerWithoutExpected: false,
  };
}

/** Offline Workspace may ship only the CP sync client (not full custom packs). */
export const WORKSPACE_OFFLINE_EXTENSIONS = Object.freeze([
  '/extensions/gpuvietnam_cp_sync/cp_sync.js',
]);

/** HTTP statuses that mean Runtime/upstream is gone (not a soft blip). */
export const RUNTIME_UNREACHABLE_STATUSES = Object.freeze([
  426, 502, 503, 504, 521, 522, 523, 530,
]);

/**
 * Classify a /system_stats (or /api/system_stats) probe for UX banner.
 * @param {{ ok?: boolean; status?: number; body?: any; networkError?: boolean }} probe
 * @returns {{ online: boolean | null; kind: string }}
 *   online true = Runtime up; false = treat as lost; null = inconclusive
 */
export function classifyRuntimeProbe(probe) {
  if (probe?.networkError) {
    return { online: false, kind: 'network' };
  }
  const status = Number(probe?.status ?? 0);
  if (!probe?.ok) {
    if (RUNTIME_UNREACHABLE_STATUSES.includes(status)) {
      return { online: false, kind: 'unreachable' };
    }
    return { online: null, kind: 'unknown_http' };
  }
  const body = probe?.body && typeof probe.body === 'object' ? probe.body : {};
  if (body?.a1?.runtimeOnline === false || body?.a1?.mode === 'editor') {
    return { online: false, kind: 'workspace_offline' };
  }
  return { online: true, kind: 'ok' };
}

/**
 * beforeunload should fire only when the graph has unsaved local edits.
 * @param {{ dirty?: boolean; syncReady?: boolean }} state
 */
export function shouldWarnBeforeUnload(state) {
  return Boolean(state?.syncReady && state?.dirty);
}
