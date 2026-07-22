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
