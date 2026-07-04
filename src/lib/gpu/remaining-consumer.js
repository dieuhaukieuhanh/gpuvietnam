/**
 * M10 — Entitlement consumer wiring to M2 Remaining (read-only).
 */

import { readRemainingForUser } from './billing.js';
import { resolveScbRemainingHours } from './billing-projection.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function loadScbRemainingForUser(supabaseAdmin, userId) {
  const read = await readRemainingForUser(supabaseAdmin, userId);
  return {
    ...read,
    hoursRemaining: resolveScbRemainingHours(read.remaining),
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string[]} userIds
 */
export async function loadScbRemainingBatch(supabaseAdmin, userIds) {
  /** @type {Map<string, Awaited<ReturnType<typeof loadScbRemainingForUser>>>} */
  const map = new Map();

  await Promise.all(
    userIds.map(async (userId) => {
      map.set(userId, await loadScbRemainingForUser(supabaseAdmin, userId));
    }),
  );

  return map;
}
