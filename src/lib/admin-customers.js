/**
 * Admin — phân tích khách hàng (mock + Supabase).
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { loadScbRemainingBatch } from '@/lib/gpu/remaining-consumer';
import { REMAINING_STATE_OK } from '@/lib/gpu/remaining-time';
import {
  buildAnomalySummary,
  detectCustomerAnomalies,
  getAnomalyLevel,
} from '@/lib/customer-anomalies';
import {
  loadBackupAutoPolicy,
  resolveAutoBackupEnabled,
  normalizeAutoBackupOverride,
} from '@/lib/backup-auto-policy';
import { normalizeBackupPlanKey } from '@/lib/backup-entitlement';

/** @typedef {import('@/lib/admin-customers-shared').AdminCustomerRow} AdminCustomerRow */
/** @typedef {import('@/lib/admin-customers-shared').CustomerStats} CustomerStats */
/** @typedef {import('@/lib/admin-customers-shared').CustomerFilters} CustomerFilters */
/** @typedef {import('@/lib/admin-customers-shared').CustomerSortField} CustomerSortField */

const CHURN_ORDER = { low: 0, medium: 1, high: 2 };

const MOCK_CUSTOMERS_RAW = [
  { id: 'KH001', name: 'Nguyễn Thành', email: 'thanh@gmail.com', phone: '0901234567', plan: 'Pro', hoursLeft: 18.5, totalHours: 120, lastAccess: '2026-06-16T09:30:00', workflow: 'ComfyUI', model: 'SDXL', journey: 'Starter→Pro', revenue: 6600000, avgDaily: 2.3, sessionsPerWeek: 5, history: ['Starter', 'Pro'], region: 'Japan', isUsing: true, mockSessionSeconds: 8100 },
  { id: 'KH002', name: 'Trần Minh Khoa', email: 'khoa@gmail.com', plan: 'Starter', hoursLeft: 32, totalHours: 50, lastAccess: '2026-06-15T22:15:00', workflow: 'A1111', model: 'SD 1.5', journey: 'Pro→Starter', revenue: 1960000, avgDaily: 1.2, sessionsPerWeek: 3, history: ['Pro', 'Starter'], region: 'Singapore', isUsing: false },
  { id: 'KH003', name: 'Lê Thị Hương', email: 'huong@studio.vn', plan: 'Studio', hoursLeft: 0, totalHours: 200, lastAccess: '2026-06-10T14:00:00', workflow: 'Video AI', model: 'AnimateDiff', journey: 'Studio', revenue: 10500000, avgDaily: 6.8, sessionsPerWeek: 0, history: ['Studio'], region: 'US', isUsing: false },
  { id: 'KH004', name: 'Phạm Văn Đức', email: 'duc@freelance.vn', plan: 'Starter', hoursLeft: 8, totalHours: 20, lastAccess: '2026-06-14T08:45:00', workflow: 'ComfyUI', model: 'Flux', journey: 'Starter', revenue: 780000, avgDaily: 0.8, sessionsPerWeek: 2, history: ['Starter'], region: 'Japan', isUsing: false },
  { id: 'KH005', name: 'Hoàng Anh Tuấn', email: 'tuan@agency.vn', plan: 'Pro', hoursLeft: 54, totalHours: 120, lastAccess: '2026-06-16T10:00:00', workflow: 'ComfyUI', model: 'SDXL', journey: 'Starter→Pro', revenue: 4400000, avgDaily: 3.1, sessionsPerWeek: 6, history: ['Starter', 'Pro'], region: 'Singapore', isUsing: true, mockSessionSeconds: 2700 },
  { id: 'KH006', name: 'Nguyễn Thị Mai', email: 'mai@design.vn', plan: 'Starter', hoursLeft: 12, totalHours: 50, lastAccess: '2026-06-15T16:20:00', workflow: 'A1111', model: 'ReActor', journey: 'Starter', revenue: 1960000, avgDaily: 1.6, sessionsPerWeek: 4, history: ['Starter'], region: 'US', isUsing: false },
  { id: 'KH007', name: 'Trịnh Văn An', email: 'an@creator.com', plan: 'Pro', hoursLeft: 2, totalHours: 120, lastAccess: '2026-06-16T07:00:00', workflow: 'ComfyUI', model: 'ControlNet', journey: 'Pro', revenue: 2200000, avgDaily: 4.2, sessionsPerWeek: 9, history: ['Pro'], region: 'Japan', isUsing: true, mockSessionSeconds: 32400, mockOutputCount: 0 },
  { id: 'KH008', name: 'Vũ Thị Lan', email: 'lan@studio.vn', plan: 'Studio', hoursLeft: 120, totalHours: 200, lastAccess: '2026-06-15T13:10:00', workflow: 'Blender', model: 'Cycles', journey: 'Starter→Pro→Studio', revenue: 10500000, avgDaily: 2.8, sessionsPerWeek: 4, history: ['Starter', 'Pro', 'Studio'], region: 'Singapore', isUsing: false },
  { id: 'KH009', name: 'Đỗ Minh Tuấn', email: 'tuan.do@ai.com', plan: 'Pro', hoursLeft: 95, totalHours: 120, lastAccess: '2026-05-20T20:30:00', workflow: 'ComfyUI', model: 'Flux', journey: 'Pro', revenue: 4400000, avgDaily: 1.9, sessionsPerWeek: 0, history: ['Pro'], region: 'US', isUsing: false },
  { id: 'KH010', name: 'Phan Thị Ngọc', email: 'ngoc@design.vn', plan: 'Starter', hoursLeft: 0, totalHours: 50, lastAccess: '2026-06-01T09:00:00', workflow: 'A1111', model: 'SD 1.5', journey: 'Starter', revenue: 980000, avgDaily: 0.3, sessionsPerWeek: 1, history: ['Starter'], region: 'Japan', isUsing: false },
  { id: 'KH011', name: 'Lý Quốc Huy', email: 'huy@agency.vn', plan: 'Pro', hoursLeft: 45, totalHours: 120, lastAccess: '2026-06-16T11:45:00', workflow: 'Video AI', model: 'RIFE', journey: 'Starter→Pro', revenue: 4400000, avgDaily: 2.5, sessionsPerWeek: 5, history: ['Starter', 'Pro'], region: 'Singapore', isUsing: true, mockSessionSeconds: 3900, mockMachinesRunning: 3 },
  { id: 'KH012', name: 'Ngô Thị Thanh', email: 'thanh@freelance.vn', plan: 'Studio', hoursLeft: 10, totalHours: 200, lastAccess: '2026-06-15T18:00:00', workflow: 'ComfyUI', model: 'SDXL', journey: 'Pro→Studio', revenue: 10500000, avgDaily: 3.8, sessionsPerWeek: 6, history: ['Pro', 'Studio'], region: 'Japan', isUsing: false },
];

const MOCK_STATS = {
  totalCustomers: 237,
  newThisMonth: 12,
  activeUsing: 48,
  withHours: 132,
  totalRevenue: 568000000,
  retentionRate: 86,
  retentionDelta: 3,
  peakHours: { morning: 30, afternoon: 45, evening: 25 },
  peakHourNote: 'Khách dùng nhiều nhất khung 14h-17h',
  gpuRegions: [
    { label: '🇸🇬 SG', percent: 52, badge: 'badge-green' },
    { label: '🇯🇵 JP', percent: 28, badge: 'badge-blue' },
    { label: '🇺🇸 US', percent: 20, badge: 'badge-purple' },
  ],
  templateNote: 'Template: ComfyUI (68%), A1111 (22%)',
};

function capitalizePlan(plan) {
  if (!plan) return '—';
  const p = String(plan);
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function daysSince(isoDate) {
  if (!isoDate) return 999;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 999;
  return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

/**
 * @param {{ hoursLeft: number, lastAccess: string | null, sessionsPerWeek: number }} row
 */
export function computeChurnRisk(row) {
  let score = 0;
  if (row.hoursLeft <= 0) score += 40;
  const days = daysSince(row.lastAccess);
  if (days > 7) score += 30;
  if (days > 14) score += 30;
  if (row.sessionsPerWeek <= 0) score += 30;

  let level = 'low';
  if (score >= 70) level = 'high';
  else if (score >= 40) level = 'medium';

  return { level, score };
}

/**
 * @param {{ isOnline: boolean, hoursLeft: number, hasActivePlan?: boolean }} row
 */
export function getRealtimeStatus(row) {
  if (row.isOnline) return 'online';
  if (row.hoursLeft <= 0) return 'expired';
  return 'hasPlan';
}

/**
 * @param {AdminCustomerRow} row
 */
export function getCustomerStatus(row) {
  if (row.hoursLeft <= 0) return 'expired';
  if (row.isOnline) return 'active';
  if (row.hoursLeft > 0) return 'hasHours';
  return 'expired';
}

function sessionDurationSeconds(startedAt) {
  if (!startedAt) return 0;
  const then = new Date(startedAt).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 1000));
}

function stripTemplateLabel(template) {
  if (!template) return null;
  return String(template).replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '').trim() || template;
}

/**
 * @param {object} raw
 * @returns {AdminCustomerRow}
 */
export function enrichCustomerRow(raw) {
  const hoursLeft = Number(raw.hoursLeft ?? 0);
  const sessionsPerWeek = Number(raw.sessionsPerWeek ?? 0);
  const lastAccess = raw.lastAccess ?? null;
  const { level, score } = computeChurnRisk({ hoursLeft, lastAccess, sessionsPerWeek });
  const history = Array.isArray(raw.history) ? raw.history : [];
  const hasActivePlan = Boolean(raw.hasActivePlan ?? (hoursLeft > 0 && raw.plan && raw.plan !== '—'));

  let isOnline = Boolean(raw.isOnline);
  let sessionStartedAt = raw.sessionStartedAt ?? null;
  let currentTemplate = raw.currentTemplate ?? null;

  if (isOnline && !sessionStartedAt) {
    const mockSeconds = Number(raw.mockSessionSeconds ?? 3600);
    sessionStartedAt = new Date(Date.now() - mockSeconds * 1000).toISOString();
    currentTemplate = currentTemplate ?? raw.workflow ?? null;
  }

  if (!isOnline && raw.isUsing) {
    isOnline = true;
    if (!sessionStartedAt) {
      const mockSeconds = Number(raw.mockSessionSeconds ?? 3600);
      sessionStartedAt = new Date(Date.now() - mockSeconds * 1000).toISOString();
    }
    currentTemplate = currentTemplate ?? raw.workflow ?? null;
  }

  const currentSessionDuration = sessionDurationSeconds(sessionStartedAt);
  const machinesRunning = Number(
    raw.machinesRunning ?? raw.mockMachinesRunning ?? (isOnline ? 1 : 0),
  );
  const outputCount = Number(raw.outputCount ?? raw.mockOutputCount ?? 0);

  const row = {
    id: raw.id,
    userId: raw.userId ?? null,
    name: raw.name ?? 'Khách hàng',
    email: raw.email ?? '',
    phone: raw.phone ?? null,
    plan: capitalizePlan(raw.plan),
    hoursLeft,
    totalHours: Number(raw.totalHours ?? 0),
    daysLeft: raw.daysLeft ?? null,
    lastAccess,
    workflow: raw.workflow ?? '—',
    model: raw.model ?? '—',
    journey: raw.journey ?? history.join('→'),
    revenue: Number(raw.revenue ?? 0),
    avgDaily: Number(raw.avgDaily ?? 0),
    churnRisk: level,
    churnScore: score,
    sessionsPerWeek,
    history,
    region: raw.region ?? 'Singapore',
    isUsing: isOnline,
    isOnline,
    realtimeStatus: 'hasPlan',
    currentSessionDuration,
    sessionStartedAt: isOnline ? sessionStartedAt : null,
    currentTemplate: isOnline ? stripTemplateLabel(currentTemplate) : null,
    currentProvider: isOnline ? (raw.currentProvider ?? null) : null,
    runtimeImage: isOnline ? (raw.runtimeImage ?? null) : null,
    gpuLine: isOnline ? (raw.gpuLine ?? null) : null,
    opsDegraded: isOnline ? Boolean(raw.opsDegraded) : false,
    sshOk: isOnline && typeof raw.sshOk === 'boolean' ? raw.sshOk : null,
    machinesRunning,
    outputCount,
    status: 'hasHours',
    anomalies: [],
    anomalyLevel: 'none',
    autoBackupOverride: normalizeAutoBackupOverride(raw.autoBackupOverride ?? null),
    autoBackupEnabled:
      raw.autoBackupEnabled != null
        ? Boolean(raw.autoBackupEnabled)
        : resolveAutoBackupEnabled({
            planKey: raw.plan,
            userOverride: raw.autoBackupOverride,
          }).enabled,
    autoBackupSource: String(
      raw.autoBackupSource ??
        resolveAutoBackupEnabled({
          planKey: raw.plan,
          userOverride: raw.autoBackupOverride,
        }).source,
    ),
  };

  row.realtimeStatus = getRealtimeStatus({ isOnline, hoursLeft, hasActivePlan });
  row.status = getCustomerStatus(row);

  const anomalies = detectCustomerAnomalies({
    hoursLeft: row.hoursLeft,
    totalHours: row.totalHours,
    avgDaily: row.avgDaily,
    sessionsPerWeek: row.sessionsPerWeek,
    lastAccess: row.lastAccess,
    churnRisk: row.churnRisk,
    isOnline: row.isOnline,
    currentSessionDuration: row.currentSessionDuration,
    machinesRunning: row.machinesRunning,
    outputCount: row.outputCount,
  });
  row.anomalies = anomalies;
  row.anomalyLevel = getAnomalyLevel(anomalies);

  return row;
}

export function getMockCustomers() {
  return MOCK_CUSTOMERS_RAW.map(enrichCustomerRow);
}

function formatVndShort(amount) {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1).replace('.0', '')}tr`;
  return new Intl.NumberFormat('vi-VN').format(amount);
}

/**
 * @param {AdminCustomerRow[]} customers
 * @param {object} [overrides]
 * @returns {CustomerStats}
 */
export function computeCustomerStats(customers, overrides = {}) {
  const totalRevenue = customers.reduce((sum, c) => sum + c.revenue, 0);
  const withHours = customers.filter((c) => c.hoursLeft > 0).length;
  const activeUsing = customers.filter((c) => c.isOnline).length;
  const avgRevenue = customers.length > 0 ? Math.round(totalRevenue / customers.length) : 0;

  return {
    totalCustomers: overrides.totalCustomers ?? customers.length,
    newThisMonth: overrides.newThisMonth ?? 0,
    activeUsing: overrides.activeUsing ?? activeUsing,
    withHours: overrides.withHours ?? withHours,
    avgRevenuePerCustomer: avgRevenue,
    totalRevenue: overrides.totalRevenue ?? totalRevenue,
    retentionRate: overrides.retentionRate ?? 86,
    retentionDelta: overrides.retentionDelta ?? 0,
    peakHours: overrides.peakHours ?? { morning: 30, afternoon: 45, evening: 25 },
    peakHourNote: overrides.peakHourNote ?? '',
    gpuRegions: overrides.gpuRegions ?? MOCK_STATS.gpuRegions,
    templateNote: overrides.templateNote ?? MOCK_STATS.templateNote,
  };
}

export function getMockCustomerStats() {
  const customers = getMockCustomers();
  return {
    ...computeCustomerStats(customers, MOCK_STATS),
    avgRevenuePerCustomer: Math.round(MOCK_STATS.totalRevenue / MOCK_STATS.totalCustomers),
    formattedAvgRevenue: formatVndShort(Math.round(MOCK_STATS.totalRevenue / MOCK_STATS.totalCustomers)),
    formattedTotalRevenue: formatVndShort(MOCK_STATS.totalRevenue),
  };
}

/**
 * @param {AdminCustomerRow[]} rows
 * @param {CustomerFilters} filters
 */
export function filterCustomers(rows, filters) {
  const search = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.status === 'online' && !row.isOnline) return false;
    if (filters.status !== 'all' && filters.status !== 'online' && row.status !== filters.status) return false;
    if (filters.plan !== 'all' && row.plan !== filters.plan) return false;
    if (filters.template !== 'all' && row.workflow !== filters.template) return false;
    if (filters.region !== 'all' && row.region !== filters.region) return false;
    if (filters.alert === 'hasAlert' && row.anomalies.length === 0) return false;
    if (filters.alert === 'critical' && row.anomalyLevel !== 'high') return false;
    if (filters.alert === 'warning' && row.anomalyLevel !== 'medium' && row.anomalyLevel !== 'low') {
      return false;
    }
    if (search) {
      const hay = `${row.name} ${row.email}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/**
 * @param {AdminCustomerRow[]} rows
 * @param {CustomerSortField} field
 * @param {'asc' | 'desc'} order
 */
export function sortCustomers(rows, field, order = 'asc') {
  const dir = order === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'name':
        cmp = a.name.localeCompare(b.name, 'vi');
        break;
      case 'plan':
        cmp = a.plan.localeCompare(b.plan);
        break;
      case 'hoursLeft':
        cmp = a.hoursLeft - b.hoursLeft;
        break;
      case 'lastAccess':
        cmp = new Date(a.lastAccess ?? 0).getTime() - new Date(b.lastAccess ?? 0).getTime();
        break;
      case 'workflow':
        cmp = a.workflow.localeCompare(b.workflow);
        break;
      case 'model':
        cmp = a.model.localeCompare(b.model);
        break;
      case 'journey':
        cmp = a.journey.localeCompare(b.journey);
        break;
      case 'revenue':
        cmp = a.revenue - b.revenue;
        break;
      case 'avgDaily':
        cmp = a.avgDaily - b.avgDaily;
        break;
      case 'churnRisk':
        cmp = CHURN_ORDER[a.churnRisk] - CHURN_ORDER[b.churnRisk];
        break;
      case 'sessionsPerWeek':
        cmp = a.sessionsPerWeek - b.sessionsPerWeek;
        break;
      case 'anomalyLevel': {
        const ANOMALY_ORDER = { none: 0, low: 1, medium: 2, high: 3 };
        cmp = ANOMALY_ORDER[a.anomalyLevel] - ANOMALY_ORDER[b.anomalyLevel];
        break;
      }
      default:
        cmp = 0;
    }
    return cmp * dir;
  });
}

function parseFilters(query) {
  return {
    status: typeof query.status === 'string' ? query.status : 'all',
    plan: typeof query.plan === 'string' ? query.plan : 'all',
    template: typeof query.template === 'string' ? query.template : 'all',
    region: typeof query.region === 'string' ? query.region : 'all',
    search: typeof query.search === 'string' ? query.search : '',
    alert: typeof query.alert === 'string' ? query.alert : 'all',
  };
}

function mostCommon(items) {
  const counts = new Map();
  for (const item of items) {
    if (!item) continue;
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  let best = '—';
  let max = 0;
  for (const [key, count] of counts) {
    if (count > max) {
      max = count;
      best = key;
    }
  }
  return best;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string[]} userIds
 */
async function fetchRunningMachinesByUser(supabaseAdmin, userIds) {
  const countMap = new Map();
  const primaryMap = new Map();
  if (!userIds.length) return { countMap, primaryMap };

  const { data, error } = await supabaseAdmin
    .from('machines')
    .select('user_id, status, template, started_at, provider, gpu_line, image')
    .in('user_id', userIds)
    .eq('status', 'running');

  if (error) {
    console.warn('[admin-customers] machines query:', error.message);
    return { countMap, primaryMap };
  }

  for (const machine of data ?? []) {
    if (machine.status !== 'running') continue;
    countMap.set(machine.user_id, (countMap.get(machine.user_id) ?? 0) + 1);
    if (!primaryMap.has(machine.user_id)) {
      primaryMap.set(machine.user_id, machine);
    }
  }

  return { countMap, primaryMap };
}

function resolveOnlineState(userId, sessions, activeSub, runningMachines) {
  const { countMap, primaryMap } = runningMachines;
  const machine = primaryMap.get(userId);
  const machinesRunning = countMap.get(userId) ?? 0;
  if (machine) {
    return {
      isOnline: true,
      sessionStartedAt: machine.started_at ?? null,
      currentTemplate: machine.template ?? activeSub?.env_name ?? null,
      currentProvider: machine.provider ?? null,
      /** Admin audit only — ComfyUI image tag (v3/v4). */
      runtimeImage: machine.image ?? null,
      gpuLine: machine.gpu_line ?? null,
      opsDegraded: machine.ops_degraded === true,
      sshOk: typeof machine.ssh_ok === 'boolean' ? machine.ssh_ok : null,
      machinesRunning,
    };
  }

  const runningSession = sessions.find((s) => s.status === 'running');
  if (runningSession) {
    return {
      isOnline: true,
      sessionStartedAt: runningSession.started_at ?? null,
      currentTemplate: runningSession.template ?? activeSub?.env_name ?? null,
      currentProvider: null,
      runtimeImage: null,
      gpuLine: null,
      opsDegraded: false,
      sshOk: null,
      machinesRunning: machinesRunning || 1,
    };
  }

  if (activeSub?.server_status === 'online') {
    return {
      isOnline: true,
      sessionStartedAt: activeSub.activated_at ?? activeSub.created_at ?? null,
      currentTemplate: activeSub.env_name ?? null,
      currentProvider: null,
      runtimeImage: null,
      gpuLine: null,
      opsDegraded: false,
      sshOk: null,
      machinesRunning: machinesRunning || 1,
    };
  }

  return {
    isOnline: false,
    sessionStartedAt: null,
    currentTemplate: null,
    currentProvider: null,
    runtimeImage: null,
    gpuLine: null,
    opsDegraded: false,
    sshOk: null,
    machinesRunning: 0,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 */
async function fetchCustomersFromDb(supabaseAdmin) {
  let users;
  let usersError;

  {
    const first = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, phone, role, created_at, auto_backup_override, backup_entitled_plan')
      .eq('role', 'user')
      .order('created_at', { ascending: false });
    users = first.data;
    usersError = first.error;

    if (usersError && /auto_backup_override|backup_entitled_plan|schema cache|Could not find/i.test(usersError.message || '')) {
      const fallback = await supabaseAdmin
        .from('users')
        .select('id, email, full_name, phone, role, created_at')
        .eq('role', 'user')
        .order('created_at', { ascending: false });
      users = fallback.data;
      usersError = fallback.error;
    }
  }

  if (usersError || !users?.length) return null;

  const userIds = users.map((u) => u.id);
  const autoBackupPolicy = await loadBackupAutoPolicy(supabaseAdmin);

  const [subsRes, sessionsRes, walletRes, runningMachines, inventoryRes] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').in('user_id', userIds),
    supabaseAdmin.from('gpu_sessions').select('*').in('user_id', userIds).order('started_at', { ascending: false }),
    supabaseAdmin
      .from('wallet_transactions')
      .select('user_id, amount, type, status')
      .in('user_id', userIds)
      .eq('status', 'completed'),
    fetchRunningMachinesByUser(supabaseAdmin, userIds),
    supabaseAdmin
      .from('user_plan_inventory')
      .select('user_id, plan_name, hours_remaining, hours_total, is_active, status, valid_until, plan_type')
      .in('user_id', userIds),
  ]);

  const subsByUser = new Map();
  for (const sub of subsRes.data ?? []) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }

  const activeInventoryByUser = new Map();
  const usableInventoryByUser = new Map();
  const nowMs = Date.now();
  for (const inv of inventoryRes.data ?? []) {
    if (inv.is_active) {
      const existing = activeInventoryByUser.get(inv.user_id);
      if (!existing || new Date(String(existing.valid_until ?? 0)).getTime() < new Date(String(inv.valid_until ?? 0)).getTime()) {
        activeInventoryByUser.set(inv.user_id, inv);
      }
    }
    if (inv.status === 'active' && inv.valid_until) {
      const expMs = new Date(String(inv.valid_until)).getTime();
      if (Number.isFinite(expMs) && expMs > nowMs) {
        const list = usableInventoryByUser.get(inv.user_id) ?? [];
        list.push(inv);
        usableInventoryByUser.set(inv.user_id, list);
      }
    }
  }

  const sessionsByUser = new Map();
  for (const session of sessionsRes.data ?? []) {
    const list = sessionsByUser.get(session.user_id) ?? [];
    list.push(session);
    sessionsByUser.set(session.user_id, list);
  }

  const revenueByUser = new Map();
  for (const tx of walletRes.data ?? []) {
    if (tx.type !== 'payment' && tx.type !== 'topup') continue;
    revenueByUser.set(tx.user_id, (revenueByUser.get(tx.user_id) ?? 0) + Number(tx.amount ?? 0));
  }

  const remainingByUser = await loadScbRemainingBatch(supabaseAdmin, userIds);

  const rows = users.map((user, index) => {
    const subs = subsByUser.get(user.id) ?? [];
    const sessions = sessionsByUser.get(user.id) ?? [];
    const activeSub =
      subs.find((s) => s.status === 'active') ??
      subs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    const remainingRead = remainingByUser.get(user.id);
    const scbOk = remainingRead?.remaining?.state === REMAINING_STATE_OK;
    const activeInventory = activeInventoryByUser.get(user.id);
    const activeInventoryRemaining = activeInventory
      ? Math.max(0, Number(activeInventory.hours_remaining ?? 0))
      : null;
    const activeInventoryTotal = activeInventory
      ? Math.max(0, Number(activeInventory.hours_total ?? 0))
      : null;
    const hoursLeft =
      activeInventoryRemaining != null
        ? activeInventoryRemaining
        : scbOk
          ? Number(remainingRead?.hoursRemaining ?? 0)
          : 0;
    const hoursTotal =
      activeInventoryTotal != null && activeInventoryTotal > 0
        ? activeInventoryTotal
        : activeSub
          ? Number(activeSub.hours_total ?? 0)
          : scbOk
            ? Number(remainingRead.remaining.totalEntitlementHours ?? 0)
            : 0;
    const plan = capitalizePlan(activeSub?.plan ?? '—');
    const hasActivePlan = activeSub?.status === 'active' || hoursLeft > 0;
    const planKey =
      normalizeBackupPlanKey(user.backup_entitled_plan) ??
      normalizeBackupPlanKey(activeSub?.plan) ??
      'starter';
    const autoBackupOverride = normalizeAutoBackupOverride(user.auto_backup_override);
    const autoBackup = resolveAutoBackupEnabled({
      planKey,
      userOverride: autoBackupOverride,
      globalStarterPolicy: autoBackupPolicy,
    });

    const usableInvs = usableInventoryByUser.get(user.id) ?? [];
    let daysLeft = null;
    for (const inv of usableInvs) {
      const expMs = new Date(String(inv.valid_until)).getTime();
      if (!Number.isFinite(expMs)) continue;
      const d = Math.max(0, Math.ceil((expMs - nowMs) / (24 * 60 * 60 * 1000)));
      if (daysLeft == null || d > daysLeft) daysLeft = d;
    }

    const onlineState = resolveOnlineState(user.id, sessions, activeSub, runningMachines);
    const runningSession = sessions.find((s) => s.status === 'running');
    const outputCount = runningSession ? Number(runningSession.output_count ?? 0) : 0;

    const lastSession = sessions[0];
    const lastAccess = lastSession?.ended_at ?? lastSession?.started_at ?? user.created_at;

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const sessionsPerWeek = sessions.filter(
      (s) => new Date(s.started_at).getTime() >= weekAgo,
    ).length;

    const templates = sessions.map((s) => s.template).filter(Boolean);
    const workflow = mostCommon(templates) || activeSub?.env_name || 'ComfyUI';

    const planHistory = [...new Set(subs.map((s) => capitalizePlan(s.plan)).filter(Boolean))];
    const journey = planHistory.join('→');
    const totalDurationSec = sessions.reduce((sum, s) => sum + Number(s.duration_seconds ?? 0), 0);
    const avgDaily =
      sessions.length > 0 ? totalDurationSec / sessions.length / 3600 / 7 : 0;

    const regions = ['Singapore', 'Japan', 'US'];
    const region = regions[index % regions.length];

    return enrichCustomerRow({
      id: user.id.slice(0, 8).toUpperCase(),
      userId: user.id,
      name: user.full_name || user.email.split('@')[0],
      email: user.email,
      phone: user.phone ?? null,
      plan,
      hoursLeft,
      totalHours: hoursTotal || hoursLeft,
      daysLeft,
      lastAccess,
      workflow,
      model: lastSession?.gpu_config?.split(' ')?.[0] ?? '—',
      journey,
      revenue: revenueByUser.get(user.id) ?? 0,
      avgDaily: Math.round(avgDaily * 10) / 10,
      sessionsPerWeek,
      history: planHistory,
      region,
      hasActivePlan,
      isOnline: onlineState.isOnline,
      sessionStartedAt: onlineState.sessionStartedAt,
      currentTemplate: onlineState.currentTemplate,
      currentProvider: onlineState.currentProvider,
      runtimeImage: onlineState.runtimeImage,
      gpuLine: onlineState.gpuLine,
      opsDegraded: onlineState.opsDegraded === true,
      sshOk: typeof onlineState.sshOk === 'boolean' ? onlineState.sshOk : null,
      machinesRunning: onlineState.machinesRunning,
      outputCount,
      autoBackupOverride,
      autoBackupEnabled: autoBackup.enabled,
      autoBackupSource: autoBackup.source,
    });
  });

  return rows.length ? rows : null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 */
async function fetchStatsFromDb(supabaseAdmin) {
  const { count: totalCustomers, error: countError } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'user');

  if (countError) return null;

  const customers = await fetchCustomersFromDb(supabaseAdmin);
  if (!customers) return null;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { count: newThisMonth } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'user')
    .gte('created_at', monthStart.toISOString());

  return {
    ...computeCustomerStats(customers, {
      newThisMonth: newThisMonth ?? 0,
      retentionRate: MOCK_STATS.retentionRate,
      retentionDelta: MOCK_STATS.retentionDelta,
      peakHours: MOCK_STATS.peakHours,
      peakHourNote: MOCK_STATS.peakHourNote,
      gpuRegions: MOCK_STATS.gpuRegions,
      templateNote: MOCK_STATS.templateNote,
    }),
    totalCustomers: totalCustomers ?? customers.length,
    totalRevenue: customers.reduce((s, c) => s + c.revenue, 0),
  };
}

export async function fetchAdminCustomers(query = {}) {
  const supabaseAdmin = getSupabaseAdmin();
  let rows = await fetchCustomersFromDb(supabaseAdmin);
  let source = 'db';

  if (!rows?.length) {
    rows = getMockCustomers();
    source = 'mock';
  }

  const filters = parseFilters(query);
  const sortField =
    typeof query.sort === 'string' &&
    ['name', 'plan', 'hoursLeft', 'lastAccess', 'workflow', 'model', 'journey', 'revenue', 'avgDaily', 'churnRisk', 'sessionsPerWeek', 'anomalyLevel'].includes(query.sort)
      ? query.sort
      : 'name';
  const sortOrder = query.order === 'desc' ? 'desc' : 'asc';

  const filtered = filterCustomers(rows, filters);
  const sorted = sortCustomers(filtered, sortField, sortOrder);
  const anomalySummary = buildAnomalySummary(rows);

  return {
    items: sorted,
    total: rows.length,
    filtered: sorted.length,
    filters,
    sort: sortField,
    order: sortOrder,
    source,
    fetchedAt: new Date().toISOString(),
    onlineCount: rows.filter((r) => r.isOnline).length,
    anomalySummary,
  };
}

export async function fetchAdminCustomerStats() {
  const supabaseAdmin = getSupabaseAdmin();
  const dbStats = await fetchStatsFromDb(supabaseAdmin);

  if (dbStats && dbStats.totalCustomers > 0) {
    return { ...dbStats, source: 'db' };
  }

  return { ...getMockCustomerStats(), source: 'mock' };
}

export { formatVndShort, MOCK_STATS };
