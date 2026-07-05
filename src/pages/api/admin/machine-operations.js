import { verifyAdmin } from '@/lib/admin-auth';
import {
  getMachineOperationById,
  listMachineOperations,
} from '@/lib/infrastructure/machine-operation-admin';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req, res);
  if (!admin) return undefined;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const operationId = typeof req.query.id === 'string' ? req.query.id : undefined;

    if (operationId) {
      const operation = await getMachineOperationById(supabaseAdmin, operationId);
      if (!operation) {
        return res.status(404).json({ error: 'Operation not found' });
      }
      return res.status(200).json({ operation });
    }

    const result = await listMachineOperations(supabaseAdmin, {
      view: typeof req.query.view === 'string' ? req.query.view : undefined,
      state: typeof req.query.state === 'string' ? req.query.state : undefined,
      userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
      machineId: typeof req.query.machineId === 'string' ? req.query.machineId : undefined,
      correlationId:
        typeof req.query.correlationId === 'string' ? req.query.correlationId : undefined,
      operation: typeof req.query.operation === 'string' ? req.query.operation : undefined,
      limit: Number(req.query.limit) || 50,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[admin/machine-operations]', err);
    return res.status(500).json({ error: err.message || 'Failed to list machine operations.' });
  }
}
