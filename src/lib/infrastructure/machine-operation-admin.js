/**
 * SCB 2.1 Phase 2.5 — Admin inspection service for machine_operations.
 */

/** @typedef {'pending'|'running'|'retry'|'dead_letter'|'completed'|'all'} AdminQueueView */

/**
 * @param {string|null|undefined} view
 * @returns {string[]|null}
 */
export function resolveAdminStateFilter(view) {
  switch (view) {
    case 'pending':
      return ['pending'];
    case 'running':
      return ['leased', 'running'];
    case 'retry':
      return ['retry_scheduled'];
    case 'dead_letter':
      return ['dead_letter'];
    case 'completed':
      return ['completed'];
    case 'all':
    default:
      return null;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   view?: AdminQueueView;
 *   state?: string;
 *   userId?: string;
 *   machineId?: string;
 *   correlationId?: string;
 *   operation?: string;
 *   limit?: number;
 * }} [filters]
 */
export async function listMachineOperations(supabaseAdmin, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  let query = supabaseAdmin
    .from('machine_operations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  const states = filters.state
    ? [filters.state]
    : resolveAdminStateFilter(filters.view ?? 'all');

  if (states?.length) {
    query = query.in('state', states);
  }

  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.machineId) query = query.eq('machine_id', filters.machineId);
  if (filters.correlationId) query = query.eq('correlation_id', filters.correlationId);
  if (filters.operation) query = query.eq('operation', filters.operation);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const summary = {
    total: rows.length,
    pending: rows.filter((r) => r.state === 'pending').length,
    running: rows.filter((r) => ['leased', 'running'].includes(String(r.state))).length,
    retry: rows.filter((r) => r.state === 'retry_scheduled').length,
    dead_letter: rows.filter((r) => r.state === 'dead_letter').length,
    completed: rows.filter((r) => r.state === 'completed').length,
  };

  return { operations: rows, summary };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} operationId
 */
export async function getMachineOperationById(supabaseAdmin, operationId) {
  const { data, error } = await supabaseAdmin
    .from('machine_operations')
    .select('*')
    .eq('id', operationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
