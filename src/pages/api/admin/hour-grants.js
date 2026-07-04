import { verifyAdmin } from '@/lib/admin-auth';
import { notifyHourGrant } from '@/lib/user-notifications';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const VALID_GPU_PLANS = new Set(['starter', 'pro', 'studio']);
const VALID_ACTIONS = new Set(['add', 'reduce', 'revoke', 'extend']);
const VALID_LOG_TYPES = new Set(['grant', 'add', 'reduce', 'revoke', 'extend']);

function resolveAdminId(adminCtx) {
  if (adminCtx?.mode === 'auth' && adminCtx.user?.id) {
    return adminCtx.user.id;
  }
  return null;
}

function isGrantActive(grant) {
  if (grant.status !== 'active') return false;
  if (!grant.expires_at) return true;
  return new Date(grant.expires_at).getTime() > Date.now();
}

function unusedHours(grant) {
  return Math.max(0, Number(grant.hours_granted) - Number(grant.hours_used ?? 0));
}

async function fetchUserMap(supabaseAdmin, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, phone')
    .in('id', ids);

  if (error) {
    console.warn('[hour-grants] users query:', error.message);
    return new Map();
  }

  return new Map((data ?? []).map((u) => [u.id, u]));
}

async function getActiveGrantsForUser(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('manual_hour_grants')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).filter(isGrantActive).map((grant) => ({
    ...grant,
    hours_remaining: unusedHours(grant),
  }));
}

async function getHistory(supabaseAdmin, query) {
  const type = typeof query.type === 'string' ? query.type : 'all';
  const userId = typeof query.userId === 'string' ? query.userId : null;
  const date = typeof query.date === 'string' ? query.date : null;
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(query.limit ?? '10'), 10) || 10));
  const offset = (page - 1) * limit;

  let grantIdsFilter = null;
  if (userId) {
    const { data: userGrants, error: grantErr } = await supabaseAdmin
      .from('manual_hour_grants')
      .select('id')
      .eq('user_id', userId);

    if (grantErr) throw grantErr;
    grantIdsFilter = (userGrants ?? []).map((g) => g.id);
    if (!grantIdsFilter.length) {
      return { items: [], total: 0, page, limit };
    }
  }

  let logsQuery = supabaseAdmin
    .from('hour_grant_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (type !== 'all' && VALID_LOG_TYPES.has(type)) {
    logsQuery = logsQuery.eq('action_type', type);
  }
  if (grantIdsFilter) {
    logsQuery = logsQuery.in('grant_id', grantIdsFilter);
  }
  if (date) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    if (!Number.isNaN(dayStart.getTime())) {
      logsQuery = logsQuery.gte('created_at', dayStart.toISOString()).lte('created_at', dayEnd.toISOString());
    }
  }

  const { data: logs, error, count } = await logsQuery.range(offset, offset + limit - 1);
  if (error) throw error;

  const grantIds = [...new Set((logs ?? []).map((l) => l.grant_id).filter(Boolean))];
  const adminIds = [...new Set((logs ?? []).map((l) => l.admin_id).filter(Boolean))];

  const { data: grants } = grantIds.length
    ? await supabaseAdmin.from('manual_hour_grants').select('id, user_id, gpu_plan').in('id', grantIds)
    : { data: [] };

  const grantUserIds = (grants ?? []).map((g) => g.user_id);
  const userMap = await fetchUserMap(supabaseAdmin, [...grantUserIds, ...adminIds]);
  const grantMap = new Map((grants ?? []).map((g) => [g.id, g]));

  const items = (logs ?? []).map((log) => {
    const grant = grantMap.get(log.grant_id);
    const customer = grant ? userMap.get(grant.user_id) : null;
    const admin = log.admin_id ? userMap.get(log.admin_id) : null;

    return {
      id: log.id,
      grantId: log.grant_id,
      actionType: log.action_type,
      amount: log.amount,
      reason: log.reason,
      createdAt: log.created_at,
      gpuPlan: grant?.gpu_plan ?? 'pro',
      customer: customer
        ? {
            id: customer.id,
            name: customer.full_name || customer.email?.split('@')[0] || 'Khách hàng',
            email: customer.email,
          }
        : null,
      admin: admin
        ? {
            id: admin.id,
            name: admin.full_name || admin.email?.split('@')[0] || 'Admin',
            email: admin.email,
          }
        : null,
    };
  });

  return { items, total: count ?? items.length, page, limit };
}

async function createGrant(supabaseAdmin, adminCtx, body) {
  const { userId, hours, expiresAt, internalNote, customerNote, gpuPlan } = body ?? {};
  const adminId = resolveAdminId(adminCtx);

  if (!userId) {
    return { status: 400, body: { error: 'Thiếu userId.' } };
  }

  const hoursNum = Number(hours);
  if (!Number.isFinite(hoursNum) || hoursNum <= 0 || !Number.isInteger(hoursNum)) {
    return { status: 400, body: { error: 'Số giờ tặng không hợp lệ.' } };
  }

  const plan = gpuPlan && VALID_GPU_PLANS.has(gpuPlan) ? gpuPlan : 'pro';

  const { data: targetUser, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (userErr) throw userErr;
  if (!targetUser) {
    return { status: 404, body: { error: 'Không tìm thấy khách hàng.' } };
  }

  const { data: grant, error: insertErr } = await supabaseAdmin
    .from('manual_hour_grants')
    .insert({
      admin_id: adminId,
      user_id: userId,
      hours_granted: hoursNum,
      hours_used: 0,
      expires_at: expiresAt || null,
      internal_note: internalNote?.trim() || null,
      customer_note: customerNote?.trim() || null,
      gpu_plan: plan,
      status: 'active',
    })
    .select('*')
    .single();

  if (insertErr) throw insertErr;

  const { error: logErr } = await supabaseAdmin.from('hour_grant_logs').insert({
    grant_id: grant.id,
    admin_id: adminId,
    action_type: 'grant',
    amount: hoursNum,
    reason: internalNote?.trim() || customerNote?.trim() || null,
  });

  if (logErr) throw logErr;

  await notifyHourGrant(supabaseAdmin, {
    userId,
    hours: hoursNum,
    gpuPlan: plan,
  });

  return {
    status: 201,
    body: {
      success: true,
      grant: { ...grant, hours_remaining: unusedHours(grant) },
    },
  };
}

async function adjustGrant(supabaseAdmin, adminCtx, body) {
  const { grantId, action, amount, reason } = body ?? {};
  const adminId = resolveAdminId(adminCtx);

  if (!grantId) {
    return { status: 400, body: { error: 'Thiếu grantId.' } };
  }
  if (!action || !VALID_ACTIONS.has(action)) {
    return { status: 400, body: { error: 'Hành động không hợp lệ.' } };
  }
  if (!reason?.trim()) {
    return { status: 400, body: { error: 'Vui lòng nhập lý do điều chỉnh.' } };
  }

  const { data: grant, error: fetchErr } = await supabaseAdmin
    .from('manual_hour_grants')
    .select('*')
    .eq('id', grantId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!grant) {
    return { status: 404, body: { error: 'Không tìm thấy gói tặng.' } };
  }
  if (grant.status !== 'active') {
    return { status: 400, body: { error: 'Gói tặng không còn active.' } };
  }

  const remaining = unusedHours(grant);
  const updates = {
    adjusted_by: adminId,
    adjustment_reason: reason.trim(),
    adjustment_type: action,
    updated_at: new Date().toISOString(),
  };
  let logAmount = Number(amount) || 0;
  let logAction = action;

  if (action === 'add') {
    if (!Number.isFinite(logAmount) || logAmount <= 0 || !Number.isInteger(logAmount)) {
      return { status: 400, body: { error: 'Số giờ thêm không hợp lệ.' } };
    }
    updates.hours_granted = Number(grant.hours_granted) + logAmount;
    updates.adjustment_amount = logAmount;
  } else if (action === 'reduce') {
    if (!Number.isFinite(logAmount) || logAmount <= 0 || !Number.isInteger(logAmount)) {
      return { status: 400, body: { error: 'Số giờ giảm không hợp lệ.' } };
    }
    if (logAmount > remaining) {
      return {
        status: 400,
        body: { error: `Chỉ có thể giảm tối đa ${remaining} giờ chưa dùng.` },
      };
    }
    updates.hours_granted = Number(grant.hours_granted) - logAmount;
    updates.adjustment_amount = logAmount;
  } else if (action === 'revoke') {
    if (remaining <= 0) {
      return { status: 400, body: { error: 'Khách đã dùng hết giờ tặng — không thể thu hồi.' } };
    }
    logAmount = remaining;
    updates.hours_granted = Number(grant.hours_used ?? 0);
    updates.status = 'revoked';
    updates.adjustment_amount = remaining;
  } else if (action === 'extend') {
    const days = Number(amount);
    if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days)) {
      return { status: 400, body: { error: 'Số ngày gia hạn không hợp lệ.' } };
    }
    const base = grant.expires_at ? new Date(grant.expires_at) : new Date();
    const extended = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    updates.expires_at = extended.toISOString();
    logAmount = days;
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('manual_hour_grants')
    .update(updates)
    .eq('id', grantId)
    .select('*')
    .single();

  if (updateErr) throw updateErr;

  const { error: logErr } = await supabaseAdmin.from('hour_grant_logs').insert({
    grant_id: grantId,
    admin_id: adminId,
    action_type: logAction,
    amount: logAmount,
    reason: reason.trim(),
  });

  if (logErr) throw logErr;

  return {
    status: 200,
    body: {
      success: true,
      grant: { ...updated, hours_remaining: unusedHours(updated) },
    },
  };
}

export default async function handler(req, res) {
  const adminCtx = await verifyAdmin(req, res);
  if (!adminCtx) return;

  const supabaseAdmin = getSupabaseAdmin();

  try {
    if (req.method === 'GET') {
      const scope = typeof req.query.scope === 'string' ? req.query.scope : null;
      const userId = typeof req.query.userId === 'string' ? req.query.userId : null;

      if (scope === 'active' && userId) {
        const grants = await getActiveGrantsForUser(supabaseAdmin, userId);
        return res.status(200).json({ grants });
      }

      const history = await getHistory(supabaseAdmin, req.query);
      return res.status(200).json(history);
    }

    if (req.method === 'POST') {
      const result = await createGrant(supabaseAdmin, adminCtx, req.body);
      return res.status(result.status).json(result.body);
    }

    if (req.method === 'PUT') {
      const result = await adjustGrant(supabaseAdmin, adminCtx, req.body);
      return res.status(result.status).json(result.body);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/hour-grants]', err);
    return res.status(500).json({ error: err.message || 'Xử lý tặng giờ thất bại.' });
  }
}
