/**
 * Shared rent-candidate walk for marketplace GPU providers (Clore, Vast, Salad, RunPod).
 *
 * Contract: before trying the next host after a failed rent, the provider MUST
 * cancel any instance/order that may have been created for the failed offer.
 * Walking without cancel leaves multiple live GPUs for one user start.
 *
 * If orphan cancel fails, the walk MUST stop (no second rent). Prefer one failed
 * start over two billed GPUs.
 */

/**
 * Best-effort orphan destroy. Never throws to the caller — returns whether
 * cleanup succeeded so the walk can refuse a second rent.
 *
 * @param {{
 *   providerId: string;
 *   offerId: string | number;
 *   cancelOrphan: () => Promise<void>;
 *   log?: (message: string, detail?: unknown) => void;
 * }} input
 */
export async function cancelOrphanBeforeNextHost(input) {
  const providerId = String(input.providerId || 'provider');
  const offerId = input.offerId;
  const log =
    input.log ??
    ((message, detail) => {
      if (detail !== undefined) console.warn(message, detail);
      else console.warn(message);
    });

  if (typeof input.cancelOrphan !== 'function') {
    log(
      `[${providerId}/rent] cancelOrphan missing — refusing to walk to next host without cleanup hook`,
      { offerId },
    );
    return { cancelled: false, skipped: true };
  }

  try {
    await input.cancelOrphan();
    return { cancelled: true, skipped: false };
  } catch (error) {
    log(
      `[${providerId}/rent] Orphan cancel failed for offer ${offerId} before next candidate`,
      error instanceof Error ? error.message : error,
    );
    return { cancelled: false, skipped: false, error };
  }
}

/**
 * True when the walk may safely try another host (orphan cleanup ok or skipped).
 * @param {{ cancelled?: boolean; skipped?: boolean; error?: unknown }} result
 */
export function canWalkToNextHostAfterCancel(result) {
  if (result?.skipped) return false;
  if (result?.error) return false;
  return Boolean(result?.cancelled);
}

/**
 * Walk ranked offers: rent one -> on failure cancel orphan -> decide continue/throw/break.
 *
 * @template T
 * @param {{
 *   providerId: string;
 *   sourceLabel?: string;
 *   candidates: unknown[];
 *   getOfferId: (candidate: unknown) => string | number | null | undefined;
 *   shouldSkip?: (candidate: unknown, offerId: string) => boolean | Promise<boolean>;
 *   rentOne: (candidate: unknown, offerId: string) => Promise<T>;
 *   cancelOrphan: (candidate: unknown, offerId: string, error: unknown) => Promise<void>;
 *   afterFailure: (ctx: {
 *     candidate: unknown;
 *     offerId: string;
 *     error: unknown;
 *     triedCount: number;
 *     sourceLabel: string;
 *   }) => Promise<'continue' | 'throw' | 'break'> | 'continue' | 'throw' | 'break';
 *   onBeforeRent?: (candidate: unknown, offerId: string) => void | Promise<void>;
 *   log?: (message: string, detail?: unknown) => void;
 * }} input
 * @returns {Promise<{ result: T | null; lastError: Error | null; triedCount: number }>}
 */
export async function walkRentCandidates(input) {
  const providerId = String(input.providerId || 'provider');
  const sourceLabel = String(input.sourceLabel || 'initial');
  const tried = new Set();
  /** @type {Error | null} */
  let lastError = null;
  const log =
    input.log ??
    ((message, detail) => {
      if (detail !== undefined) console.warn(message, detail);
      else console.warn(message);
    });

  if (typeof input.cancelOrphan !== 'function') {
    throw new Error(
      `[${providerId}/rent] walkRentCandidates requires cancelOrphan — ` +
        'providers must destroy any created instance before trying the next host',
    );
  }

  for (const candidate of input.candidates ?? []) {
    const rawId = input.getOfferId(candidate);
    if (rawId == null || rawId === '') continue;
    const offerId = String(rawId);
    if (tried.has(offerId)) continue;

    if (typeof input.shouldSkip === 'function') {
      const skip = await input.shouldSkip(candidate, offerId);
      if (skip) continue;
    }

    tried.add(offerId);

    try {
      if (typeof input.onBeforeRent === 'function') {
        await input.onBeforeRent(candidate, offerId);
      }
      const result = await input.rentOne(candidate, offerId);
      return { result, lastError: null, triedCount: tried.size };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const cancelResult = await cancelOrphanBeforeNextHost({
        providerId,
        offerId,
        cancelOrphan: () => input.cancelOrphan(candidate, offerId, error),
        log,
      });

      if (!canWalkToNextHostAfterCancel(cancelResult)) {
        log(
          `[${providerId}/rent] Aborting candidate walk after offer ${offerId} — ` +
            'orphan cancel did not succeed; refusing a second rent',
          cancelResult.error instanceof Error
            ? cancelResult.error.message
            : cancelResult.error ?? 'cancel skipped or failed',
        );
        break;
      }

      const actionRaw = await input.afterFailure({
        candidate,
        offerId,
        error,
        triedCount: tried.size,
        sourceLabel,
      });
      const action = actionRaw === 'throw' || actionRaw === 'break' ? actionRaw : 'continue';

      if (action === 'throw') throw error;
      if (action === 'break') break;

      log(
        `[${providerId}/rent] Offer ${offerId} unavailable (${sourceLabel}), trying next...`,
        lastError.message,
      );
    }
  }

  return { result: null, lastError, triedCount: tried.size };
}