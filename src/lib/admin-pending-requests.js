import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { buildDepositTransferNote } from '@/lib/wallet-deposit';
import { fetchPendingPlanRenewRequests } from '@/lib/plan-renew-request';

async function loadUsersById(supabaseAdmin, userIds) {
  if (userIds.length === 0) return {};

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, full_name')
    .in('id', userIds);

  if (error) throw error;
  return Object.fromEntries((users ?? []).map((u) => [u.id, u]));
}

/**
 * Pending GPU subscriptions (chuyển khoản chờ duyệt).
 */
export async function fetchPendingGpuPlans(supabaseAdmin) {
  const { data: subscriptions, error } = await supabaseAdmin
    .from('subscriptions')
    .select(
      'id, user_id, plan, billing, env_name, env_icon, env_desc, gpu_label, hours_total, transfer_note, created_at',
    )
    .eq('status', 'pending_payment')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const userIds = [...new Set((subscriptions ?? []).map((s) => s.user_id))];
  const usersById = await loadUsersById(supabaseAdmin, userIds);

  return (subscriptions ?? []).map((sub) => ({
    type: 'gpu_plan',
    id: sub.id,
    user_id: sub.user_id,
    created_at: sub.created_at,
    user: usersById[sub.user_id] ?? null,
    plan_name: sub.plan,
    plan: sub.plan,
    billing: sub.billing,
    env_name: sub.env_name,
    env_icon: sub.env_icon,
    env_desc: sub.env_desc,
    gpu_label: sub.gpu_label,
    hours: sub.hours_total,
    hours_total: sub.hours_total,
    transfer_note: sub.transfer_note,
  }));
}

/**
 * Pending storage upgrades (chuyển khoản chờ duyệt).
 */
export async function fetchPendingStorageUpgrades(supabaseAdmin) {
  const { data: upgrades, error } = await supabaseAdmin
    .from('storage_upgrades')
    .select('*')
    .eq('status', 'pending')
    .eq('payment_method', 'transfer')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const userIds = [...new Set((upgrades ?? []).map((u) => u.user_id))];
  const usersById = await loadUsersById(supabaseAdmin, userIds);

  return (upgrades ?? []).map((row) => ({
    type: 'storage_upgrade',
    id: row.id,
    user_id: row.user_id,
    created_at: row.created_at,
    user: usersById[row.user_id] ?? null,
    current_ssd_gb: row.current_ssd_gb,
    current_backup_gb: row.current_backup_gb,
    requested_ssd_gb: row.requested_ssd_gb,
    requested_backup_gb: row.requested_backup_gb,
    price_change_per_month: row.price_change_per_month,
    total_amount: row.total_amount,
    payment_method: row.payment_method,
    transfer_note: row.transfer_note,
  }));
}

/**
 * Pending wallet deposits (nạp Ví chờ Admin duyệt).
 */
export async function fetchPendingWalletDeposits(supabaseAdmin) {
  const { data: transactions, error } = await supabaseAdmin
    .from('wallet_transactions')
    .select('id, user_id, amount, description, created_at')
    .eq('type', 'deposit')
    .eq('status', 'pending_deposit')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const userIds = [...new Set((transactions ?? []).map((tx) => tx.user_id))];
  const usersById = await loadUsersById(supabaseAdmin, userIds);

  return (transactions ?? []).map((tx) => ({
    type: 'wallet_deposit',
    id: tx.id,
    user_id: tx.user_id,
    created_at: tx.created_at,
    user: usersById[tx.user_id] ?? null,
    amount: Number(tx.amount),
    description: tx.description,
    transfer_note: buildDepositTransferNote(tx.id),
  }));
}

export async function fetchMergedPendingRequests(supabaseAdmin) {
  const [gpuPlans, storageUpgrades, walletDeposits, planRenews] = await Promise.all([
    fetchPendingGpuPlans(supabaseAdmin),
    fetchPendingStorageUpgrades(supabaseAdmin),
    fetchPendingWalletDeposits(supabaseAdmin),
    fetchPendingPlanRenewRequests(supabaseAdmin),
  ]);

  const items = [...gpuPlans, ...storageUpgrades, ...walletDeposits, ...planRenews].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return { items, count: items.length };
}

export async function fetchPendingRequestsCount(supabaseAdmin) {
  const [
    { count: gpuCount, error: gpuError },
    { count: storageCount, error: storageError },
    { count: walletCount, error: walletError },
    { count: renewCount, error: renewError },
  ] = await Promise.all([
    supabaseAdmin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_payment'),
    supabaseAdmin
      .from('storage_upgrades')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('payment_method', 'transfer'),
    supabaseAdmin
      .from('wallet_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'deposit')
      .eq('status', 'pending_deposit'),
    supabaseAdmin
      .from('plan_renew_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ]);

  if (gpuError) throw gpuError;
  if (storageError) throw storageError;
  if (walletError) throw walletError;
  if (renewError) throw renewError;

  return (gpuCount ?? 0) + (storageCount ?? 0) + (walletCount ?? 0) + (renewCount ?? 0);
}

/**
 * Yêu cầu đã duyệt/từ chối gần đây (cả GPU + bộ nhớ).
 */
export async function fetchRecentProcessedRequests(supabaseAdmin, limit = 8) {
  const [{ data: subs, error: subsError }, { data: upgrades, error: upgradesError }, { data: walletTx, error: walletError }, { data: renewRows, error: renewError }] =
    await Promise.all([
      supabaseAdmin
        .from('subscriptions')
        .select('id, user_id, plan, hours_total, status, activated_at, created_at')
        .in('status', ['active', 'cancelled'])
        .order('activated_at', { ascending: false, nullsFirst: false })
        .limit(limit),
      supabaseAdmin
        .from('storage_upgrades')
        .select(
          'id, user_id, requested_ssd_gb, requested_backup_gb, total_amount, status, updated_at, created_at',
        )
        .in('status', ['completed', 'rejected'])
        .order('updated_at', { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from('wallet_transactions')
        .select('id, user_id, amount, status, updated_at, created_at')
        .eq('type', 'deposit')
        .in('status', ['completed', 'rejected'])
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(limit),
      supabaseAdmin
        .from('plan_renew_requests')
        .select('id, user_id, plan, hours_to_add, renew_price, status, updated_at, created_at')
        .in('status', ['approved', 'rejected'])
        .order('processed_at', { ascending: false, nullsFirst: false })
        .limit(limit),
    ]);

  if (subsError) throw subsError;
  if (upgradesError) throw upgradesError;
  if (walletError) throw walletError;
  if (renewError) throw renewError;

  const userIds = [
    ...new Set([
      ...(subs ?? []).map((s) => s.user_id),
      ...(upgrades ?? []).map((u) => u.user_id),
      ...(walletTx ?? []).map((tx) => tx.user_id),
      ...(renewRows ?? []).map((r) => r.user_id),
    ]),
  ];
  const usersById = await loadUsersById(supabaseAdmin, userIds);

  const gpuRecent = (subs ?? []).map((sub) => ({
    type: 'gpu_plan',
    id: sub.id,
    user: usersById[sub.user_id] ?? null,
    plan_name: sub.plan,
    hours: sub.hours_total,
    outcome: sub.status === 'active' ? 'approved' : 'rejected',
    processed_at: sub.activated_at ?? sub.created_at,
  }));

  const storageRecent = (upgrades ?? []).map((row) => ({
    type: 'storage_upgrade',
    id: row.id,
    user: usersById[row.user_id] ?? null,
    requested_ssd_gb: row.requested_ssd_gb,
    requested_backup_gb: row.requested_backup_gb,
    total_amount: row.total_amount,
    outcome: row.status === 'completed' ? 'approved' : 'rejected',
    processed_at: row.updated_at ?? row.created_at,
  }));

  const walletRecent = (walletTx ?? []).map((row) => ({
    type: 'wallet_deposit',
    id: row.id,
    user: usersById[row.user_id] ?? null,
    amount: Number(row.amount),
    outcome: row.status === 'completed' ? 'approved' : 'rejected',
    processed_at: row.updated_at ?? row.created_at,
  }));

  const renewRecent = (renewRows ?? []).map((row) => ({
    type: 'plan_renew',
    id: row.id,
    user: usersById[row.user_id] ?? null,
    plan_name: row.plan,
    hours: Number(row.hours_to_add),
    renew_price: Number(row.renew_price),
    outcome: row.status === 'approved' ? 'approved' : 'rejected',
    processed_at: row.updated_at ?? row.created_at,
  }));

  return [...gpuRecent, ...storageRecent, ...walletRecent, ...renewRecent]
    .sort((a, b) => new Date(b.processed_at).getTime() - new Date(a.processed_at).getTime())
    .slice(0, limit);
}
