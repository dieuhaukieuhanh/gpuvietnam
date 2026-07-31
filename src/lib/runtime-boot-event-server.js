/**
 * Server-side boot event writer — used by the worker to record events
 * during provisioning without depending on container outbound HTTP.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   machineId: string;
 *   gpuSessionId?: string | null;
 *   stage: string;
 *   idempotencyKey: string;
 *   payload?: Record<string, unknown> | null;
 * }} params
 */
export async function insertBootEvent(supabaseAdmin, params) {
  const { machineId, gpuSessionId = null, stage, idempotencyKey, payload = null } = params;
  if (!machineId || !stage || !idempotencyKey) return null;

  try {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('runtime_boot_events')
      .upsert(
        {
          machine_id: machineId,
          gpu_session_id: gpuSessionId ?? null,
          stage,
          idempotency_key: idempotencyKey,
          recorded_at: now,
          payload: payload ?? {},
        },
        {
          onConflict: 'machine_id, idempotency_key',
          ignoreDuplicates: false,
        },
      )
      .select('id, machine_id, stage, recorded_at')
      .single();

    if (error) {
      console.warn('[boot-event-server] upsert failed:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn(
      '[boot-event-server] insert failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
