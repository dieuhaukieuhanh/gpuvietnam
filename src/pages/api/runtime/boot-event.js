import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { verifyMachineBackupToken } from '@/lib/machine-backup-token';

/**
 * POST /api/runtime/boot-event
 * Records a boot-stage event from a container runtime.
 * Auth: Bearer backup token (machine-scoped).
 * Idempotent via (machine_id, idempotency_key) UNIQUE constraint.
 *
 * Body: { stage: string, idempotency_key: string, payload?: object }
 * recorded_at is always server-set; client cannot override it.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // --- Auth: reuse verifyMachineBackupToken ---
    const authHeader = req.headers.authorization ?? '';
    const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!rawToken) {
      return res.status(401).json({ error: 'Thiếu backup token.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const verified = await verifyMachineBackupToken(supabaseAdmin, rawToken);
    if (!verified) {
      return res.status(401).json({ error: 'Backup token không hợp lệ hoặc đã hết hạn.' });
    }

    const machineId = verified.machineId;
    if (!machineId) {
      return res.status(400).json({ error: 'Token không gắn với máy nào.' });
    }

    // --- Validate body ---
    const body = req.body ?? {};
    const stage = String(body.stage ?? '').trim();
    if (!stage) {
      return res.status(400).json({ error: 'Thiếu stage.' });
    }

    const idempotencyKey = String(body.idempotency_key ?? '').trim();
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Thiếu idempotency_key.' });
    }

    const payload = body.payload != null && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : {};

    // --- Resolve gpu_session_id from machines table ---
    let gpuSessionId = null;
    const { data: machineRow, error: machineErr } = await supabaseAdmin
      .from('machines')
      .select('gpu_session_id')
      .eq('id', machineId)
      .maybeSingle();

    if (machineErr) throw machineErr;
    if (machineRow?.gpu_session_id) {
      gpuSessionId = machineRow.gpu_session_id;
    }

    // --- UPSERT: server sets recorded_at, client cannot override ---
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('runtime_boot_events')
      .upsert(
        {
          machine_id: machineId,
          gpu_session_id: gpuSessionId,
          stage,
          idempotency_key: idempotencyKey,
          recorded_at: now,
          payload,
        },
        {
          onConflict: 'machine_id, idempotency_key',
          ignoreDuplicates: false,
        },
      )
      .select('id, machine_id, gpu_session_id, stage, idempotency_key, recorded_at')
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      event: data,
    });
  } catch (err) {
    console.error('[runtime/boot-event]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Không ghi nhận boot event được.',
    });
  }
}