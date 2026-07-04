export const SUPPORT_SESSION_MS = 30 * 60 * 1000;

const OPEN_STATUSES = ['pending', 'active'];

function sessionRemainingMs(session) {
  if (session.status !== 'active' || !session.started_at) return null;
  const endsAt = new Date(session.started_at).getTime() + SUPPORT_SESSION_MS;
  return Math.max(0, endsAt - Date.now());
}

export function mapSupportSession(row) {
  if (!row) return null;
  const remainingMs = sessionRemainingMs(row);
  return {
    id: Number(row.id),
    userId: row.user_id,
    adminId: row.admin_id ?? null,
    status: row.status,
    initiatedBy: row.initiated_by ?? 'customer',
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    createdAt: row.created_at,
    remainingSeconds:
      remainingMs == null ? null : Math.ceil(remainingMs / 1000),
    expiresAt:
      row.status === 'active' && row.started_at
        ? new Date(new Date(row.started_at).getTime() + SUPPORT_SESSION_MS).toISOString()
        : null,
  };
}

export async function expireStaleSupportSessions(supabaseAdmin) {
  const cutoff = new Date(Date.now() - SUPPORT_SESSION_MS).toISOString();
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('support_sessions')
    .update({ status: 'ended', ended_at: now })
    .eq('status', 'active')
    .lt('started_at', cutoff);

  if (error) throw error;
}

async function endOpenSessionsForUser(supabaseAdmin, userId) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('support_sessions')
    .update({ status: 'ended', ended_at: now })
    .eq('user_id', userId)
    .in('status', OPEN_STATUSES);

  if (error) throw error;
}

export async function getOpenSupportSessionForUser(supabaseAdmin, userId) {
  await expireStaleSupportSessions(supabaseAdmin);

  const { data, error } = await supabaseAdmin
    .from('support_sessions')
    .select('*')
    .eq('user_id', userId)
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getSupportSessionById(supabaseAdmin, sessionId) {
  await expireStaleSupportSessions(supabaseAdmin);

  const { data, error } = await supabaseAdmin
    .from('support_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createAdminSupportRequest(supabaseAdmin, { userId, adminId }) {
  await endOpenSessionsForUser(supabaseAdmin, userId);

  const { data, error } = await supabaseAdmin
    .from('support_sessions')
    .insert({
      user_id: userId,
      admin_id: adminId,
      status: 'pending',
      initiated_by: 'admin',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function approveSupportSession(supabaseAdmin, { sessionId, userId }) {
  await expireStaleSupportSessions(supabaseAdmin);
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('support_sessions')
    .update({ status: 'active', started_at: now })
    .eq('id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('initiated_by', 'admin')
    .select('*')
    .single();

  if (error) throw error;
  if (!data) return { error: 'Không tìm thấy yêu cầu hỗ trợ hoặc đã hết hạn.' };
  return { data };
}

export async function rejectSupportSession(supabaseAdmin, { sessionId, userId }) {
  await expireStaleSupportSessions(supabaseAdmin);
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('support_sessions')
    .update({ status: 'ended', ended_at: now })
    .eq('id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('initiated_by', 'admin')
    .select('*')
    .single();

  if (error) throw error;
  if (!data) return { error: 'Không tìm thấy yêu cầu hỗ trợ hoặc đã hết hạn.' };
  return { data };
}

export async function endSupportSession(supabaseAdmin, { sessionId, actorUserId, isAdmin }) {
  await expireStaleSupportSessions(supabaseAdmin);

  const session = await getSupportSessionById(supabaseAdmin, sessionId);
  if (!session || !OPEN_STATUSES.includes(session.status)) {
    return { error: 'Phiên hỗ trợ không tồn tại hoặc đã kết thúc.' };
  }

  if (!isAdmin && session.user_id !== actorUserId) {
    return { error: 'Không có quyền kết thúc phiên này.' };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('support_sessions')
    .update({ status: 'ended', ended_at: now })
    .eq('id', sessionId)
    .in('status', OPEN_STATUSES)
    .select('*')
    .single();

  if (error) throw error;
  if (!data) return { error: 'Không thể kết thúc phiên hỗ trợ.' };
  return { data };
}

export async function listSupportSessionsForAdmin(supabaseAdmin) {
  await expireStaleSupportSessions(supabaseAdmin);

  const { data, error } = await supabaseAdmin
    .from('support_sessions')
    .select('*')
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const adminIds = [...new Set(rows.map((r) => r.admin_id).filter(Boolean))];
  const allIds = [...new Set([...userIds, ...adminIds])];

  let usersById = new Map();
  if (allIds.length > 0) {
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, phone')
      .in('id', allIds);

    if (usersError) throw usersError;
    usersById = new Map((users ?? []).map((u) => [u.id, u]));
  }

  return rows.map((row) => {
    const customer = usersById.get(row.user_id);
    const admin = row.admin_id ? usersById.get(row.admin_id) : null;
    return {
      ...mapSupportSession(row),
      customerName: customer?.full_name || customer?.email || 'Khách hàng',
      customerEmail: customer?.email ?? null,
      adminName: admin?.full_name || admin?.email || null,
    };
  });
}

export async function fetchAdminUserIds(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', 'admin');

  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

export const SUPPORT_REQUEST_NOTICE =
  '⚠️ Admin chỉ có thể XEM, không thể thao tác.\n⏱️ Phiên hỗ trợ tự động kết thúc sau 30 phút.';
