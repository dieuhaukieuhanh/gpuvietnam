/**
 * Where durable user_start_provision may execute.
 *
 * P0-A: only the VPS lifecycle worker should rent GPUs.
 * Vercel/serverless must enqueue only — otherwise it races the worker and
 * often rents Vast (no GPU_CLORE_ONLY) while the op row still says provider=clore.
 */

/**
 * @returns {boolean}
 */
export function canExecuteUserStartProvisionInThisProcess() {
  if (process.env.GPUVIETNAM_LIFECYCLE_WORKER === '1') return true;
  const allow = String(process.env.SCB_ALLOW_SERVERLESS_USER_START ?? '')
    .replace(/\r/g, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .toLowerCase();
  return allow === 'true' || allow === '1';
}
