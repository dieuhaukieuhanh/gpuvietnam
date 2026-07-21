import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getActiveMachineForUser } from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  classifyUserWorkspace,
  restoreWorkspaceLevel1,
  WORKSPACE_RESTORE_TICK,
} from '@/lib/workspace-restore/index.js';
import { setProvisionProgress, PROVISION_STAGE } from '@/lib/provision-progress/index.js';

export default async function handler(req, res) {
  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();

    if (req.method === 'GET') {
      const classification = await classifyUserWorkspace(user.id);
      return res.status(200).json({
        ok: true,
        classification,
        ticks: WORKSPACE_RESTORE_TICK,
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const action = String(req.body?.action ?? '').trim().toLowerCase();
    if (action !== 'continue' && action !== 'fresh') {
      return res.status(400).json({
        error: 'action phải là "continue" hoặc "fresh".',
      });
    }

    const machine = await getActiveMachineForUser(supabaseAdmin, user.id);
    if (!machine || machine.status !== 'running') {
      return res.status(400).json({
        error: 'Máy đang tắt. Hãy bật máy trước khi khôi phục Workspace.',
      });
    }

    const subscriptionId =
      machine.subscription_id != null ? String(machine.subscription_id) : null;

    const setTick = async (tick, message) => {
      if (!subscriptionId) return;
      await setProvisionProgress(subscriptionId, {
        stage: PROVISION_STAGE.RUNNING,
        tick,
        message,
        supabaseAdmin,
      });
    };

    if (action === 'fresh') {
      await setTick(
        WORKSPACE_RESTORE_TICK.SKIPPED,
        'Đang dùng phiên mới (Backup vẫn giữ trên cloud)',
      );
      return res.status(200).json({
        ok: true,
        action: 'fresh',
        message: 'Đã mở phiên mới. Dữ liệu trên Backup vẫn giữ nguyên.',
      });
    }

    await setTick(WORKSPACE_RESTORE_TICK.RESTORING, 'Đang khôi phục Workspace...');
    try {
      const result = await restoreWorkspaceLevel1(supabaseAdmin, user.id, machine);
      const failedAll =
        result.restored === 0 &&
        result.total > 0 &&
        Array.isArray(result.errors) &&
        result.errors.length > 0;
      if (failedAll) {
        await setTick(
          WORKSPACE_RESTORE_TICK.FAILED,
          'Khôi phục Workspace thất bại — vẫn vào được ComfyUI',
        );
        return res.status(200).json({
          ok: true,
          action: 'failed',
          result,
          message:
            'Khôi phục Workspace thất bại. Bạn có thể thử lại hoặc mở ComfyUI ngay.',
        });
      }
      await setTick(WORKSPACE_RESTORE_TICK.READY, 'Workspace sẵn sàng');
      return res.status(200).json({
        ok: true,
        action: 'continue',
        result,
        message: `Đã khôi phục ${result.restored}/${result.total} mục Workspace.`,
      });
    } catch (restoreErr) {
      await setTick(
        WORKSPACE_RESTORE_TICK.FAILED,
        'Khôi phục Workspace thất bại — vẫn vào được ComfyUI',
      );
      throw restoreErr;
    }
  } catch (err) {
    console.error('[session/workspace-restore]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Workspace restore thất bại.',
    });
  }
}
