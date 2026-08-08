import type { MachineSessionView } from '@/hooks/useDashboard';

/** Server card UI phase - driven by machineSessionView (SCB 4.0). */
export type ServerCardPhase =
  | 'loading'
  | 'idle'
  | 'opening'
  | 'running'
  | 'stopping'
  | 'disconnected'
  | 'error';

export type MachineMetricsSnapshot = {
  pollStatus?: string | null;
  comfyUrl?: string | null;
  workReady?: boolean;
  comfyProxyEnabled?: boolean;
  ip?: string | null;
  port?: number | null;
  template?: string | null;
  idleMinutes?: number | null;
  lastActivity?: string | null;
  minutesUntilAutoStop?: number | null;
  idleWarningActive?: boolean;
  metrics?: {
    vram?: { used_gb: number; total_gb: number; percent: number } | null;
    gpu_usage_percent?: number | null;
    temperature?: number | null;
    disk?: { used_gb: number; total_gb: number; percent: number } | null;
    current_model?: string | null;
    loras?: string[];
    output_count?: number;
  } | null;
};

export function createEmptyMachineMetrics(): MachineMetricsSnapshot {
  return {
    pollStatus: null,
    comfyUrl: null,
    workReady: false,
    comfyProxyEnabled: false,
    ip: null,
    port: null,
    template: null,
    idleMinutes: null,
    lastActivity: null,
    minutesUntilAutoStop: null,
    idleWarningActive: false,
    metrics: null,
  };
}

/** True when user can open Comfy (direct URL or brand proxy). */
export function isComfyWorkspaceReady(metrics: MachineMetricsSnapshot | null | undefined): boolean {
  if (!metrics) return false;
  return Boolean(metrics.comfyUrl) || metrics.workReady === true;
}

/** Instant UI feedback while start-machine API is in flight. */
export function buildOptimisticOpeningMachineSessionView(
  envName: string | null | undefined,
): MachineSessionView {
  return {
    phase: 'opening',
    lifecycleStatus: 'provisioning',
    serverStatus: 'provisioning',
    workspace: { name: envName ?? null, locked: true },
    machine: null,
    actions: {
      canStart: false,
      canCancel: true,
      canStop: false,
      canOpenComfy: false,
      canOpenEditor: true,
    },
    message: 'Đang mở phiên làm việc...',
    domainEvent: 'MACHINE_PROVISIONING',
    clientOptimistic: true,
  };
}

/** Instant UI feedback while destroy API is in flight / post-check. */
export function buildOptimisticStoppingMachineSessionView(
  envName: string | null | undefined,
  message?: string | null,
): MachineSessionView {
  return {
    phase: 'stopping',
    lifecycleStatus: 'stopping',
    serverStatus: 'stopping',
    workspace: { name: envName ?? null, locked: true },
    machine: null,
    actions: {
      canStart: false,
      canCancel: false,
      canStop: false,
      canOpenComfy: false,
      canOpenEditor: false,
    },
    message: message?.trim() || 'Đang lưu dữ liệu trước khi tắt máy...',
    domainEvent: 'MACHINE_STOPPING',
    clientOptimistic: true,
  };
}

export function buildIdleMachineSessionViewForUi(
  envName: string | null | undefined,
): MachineSessionView {
  return {
    phase: 'idle',
    lifecycleStatus: 'idle',
    serverStatus: 'offline',
    workspace: { name: envName ?? null, locked: false },
    machine: null,
    actions: {
      canStart: true,
      canCancel: false,
      canStop: false,
      canOpenComfy: false,
      canOpenEditor: false,
    },
    message: null,
    domainEvent: null,
  };
}

/** Keep boot UI only for true boot — not for billing/projection lag after machine is up. */
export function resolveBootDisplayPhase(
  phase: ServerCardPhase,
  billingStarted: boolean,
  sessionView?: Pick<MachineSessionView, 'lifecycleStatus' | 'serverStatus' | 'phase' | 'machine'> | null,
): ServerCardPhase {
  if (phase === 'stopping') return 'stopping';

  // Machine row already running → never remount the boot checklist on F5.
  if (sessionView?.machine?.status === 'running') {
    return 'running';
  }

  if (phase !== 'running' || billingStarted) return phase;

  const lifecycle = sessionView?.lifecycleStatus;
  const serverStatus = sessionView?.serverStatus;
  if (lifecycle === 'provisioning' || serverStatus === 'provisioning') {
    return 'opening';
  }
  return phase;
}

/** Server-authoritative card phase from machineSessionView only. */
export function resolveServerCardPhase(
  view: MachineSessionView | null,
  options: {
    dashboardLoading?: boolean;
    metricsLoaded?: boolean;
  } = {},
): ServerCardPhase {
  const { dashboardLoading, metricsLoaded } = options;

  if (dashboardLoading && !view) return 'loading';
  if (dashboardLoading && view) return view.phase as ServerCardPhase;
  if (!view) return metricsLoaded ? 'idle' : 'loading';

  if (view.phase === 'loading') return 'loading';
  return view.phase as ServerCardPhase;
}

/** Merge status poll into infra metrics snapshot — billing uses billingView from server. */
export function mergeMetricsFromStatusPoll(
  prev: MachineMetricsSnapshot,
  data: Record<string, unknown>,
): MachineMetricsSnapshot {
  return {
    ...prev,
    pollStatus: (data.status as string | null | undefined) ?? prev.pollStatus ?? null,
    comfyUrl: (data.comfyUrl as string | null | undefined) ?? prev.comfyUrl ?? null,
    workReady:
      data.workReady === true ||
      Boolean(data.comfyUrl) ||
      (data.workReady === false ? false : Boolean(prev.workReady)),
    comfyProxyEnabled:
      typeof data.comfyProxyEnabled === 'boolean'
        ? data.comfyProxyEnabled
        : Boolean(prev.comfyProxyEnabled),
    ip: (data.ip as string | null | undefined) ?? prev.ip ?? null,
    port: (data.port as number | null | undefined) ?? prev.port ?? null,
    template: (data.template as string | null | undefined) ?? prev.template ?? null,
    idleMinutes: (data.idleMinutes as number | null | undefined) ?? prev.idleMinutes ?? null,
    lastActivity: (data.lastActivity as string | null | undefined) ?? prev.lastActivity ?? null,
    minutesUntilAutoStop:
      (data.minutesUntilAutoStop as number | null | undefined) ?? prev.minutesUntilAutoStop ?? null,
    idleWarningActive: Boolean(data.idleWarningActive),
    metrics: (data.metrics as MachineMetricsSnapshot['metrics']) ?? prev.metrics ?? null,
  };
}

export function serverCardStatusLabel(phase: ServerCardPhase, isPending: boolean): string {
  if (isPending) return 'Ch\u1edd x\u00e1c nh\u1eadn';
  switch (phase) {
    case 'loading':
      return '\u0110ang \u0111\u1ed3ng b\u1ed9';
    case 'opening':
      return '\u0110ang m\u1edf phi\u00ean';
    case 'running':
      return '\u0110ang ch\u1ea1y';
    case 'stopping':
      return '\u0110ang l\u01b0u d\u1eef li\u1ec7u';
    case 'disconnected':
      return 'M\u1ea5t k\u1ebft n\u1ed1i';
    case 'error':
      return 'L\u1ed7i';
    default:
      return 'Ch\u01b0a m\u1edf phi\u00ean';
  }
}

export function serverCardStatusBadgeClass(phase: ServerCardPhase): string {
  switch (phase) {
    case 'running':
      return ' online';
    case 'opening':
    case 'stopping':
      return ' starting';
    case 'disconnected':
    case 'error':
      return ' offline';
    default:
      return '';
  }
}

export function isAutostopOfflineMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message.includes('t\u1eaft do kh\u00f4ng s\u1eed d\u1ee5ng') ||
    message.includes('t\u1eaft v\u00ec h\u1ebft gi\u1edd') ||
    message.includes('h\u1ebft gi\u1edd s\u1eed d\u1ee5ng')
  );
}

export function autostopToastMessage(message: string | null | undefined): string {
  if (message?.includes('h\u1ebft gi\u1edd')) {
    return '\u23f0 M\u00e1y \u0111\u00e3 t\u1ef1 t\u1eaft v\u00ec h\u1ebft gi\u1edd s\u1eed d\u1ee5ng.';
  }
  return '\ud83d\udca4 M\u00e1y \u0111\u00e3 t\u1ef1 t\u1eaft sau 1 gi\u1edd kh\u00f4ng s\u1eed d\u1ee5ng.';
}
