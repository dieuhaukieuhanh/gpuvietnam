/**
 * SCB 2.1 Architecture Freeze v2 — Projection-first read path helpers.
 */

import {
  buildConsumerEndpoint,
  isEndpointResolved,
} from './endpoint-utils.js';
import {
  isRecentBootMachine,
  isMachineBooting,
  PROVISIONING_BOOT_MAX_MS,
} from './machines-provisioning-sync.js';

/** @type {'v2'} */
export const ARCHITECTURE_FREEZE_VERSION = 'v2';

/** Default ON when unset. Set SCB21_READ_PATH_DETECT_ONLY=0 to rollback to inline sync repair. */
export function isScb21ReadPathDetectOnly() {
  return process.env.SCB21_READ_PATH_DETECT_ONLY !== '0';
}

/**
 * Architecture Freeze v2 — Projection-first is the default production read path.
 * Legacy ADR-001 only when SCB_READ_PROJECTION_FIRST=0 (explicit rollback).
 */
export function isScbReadProjectionFirst() {
  return process.env.SCB_READ_PROJECTION_FIRST !== '0';
}

/** @returns {'Projection-first' | 'Legacy Rollback'} */
export function getReadPathMode() {
  return isScbReadProjectionFirst() ? 'Projection-first' : 'Legacy Rollback';
}

/** @returns {'Projection' | 'Legacy'} */
export function getReadPathProfilerLabel() {
  return isScbReadProjectionFirst() ? 'Projection' : 'Legacy';
}

let architectureStartupLogged = false;

/** Log once per Node server process (instrumentation hook or first API load). */
export function logArchitectureFreezeStartup() {
  if (architectureStartupLogged) return;
  architectureStartupLogged = true;
  const raw = process.env.SCB_READ_PROJECTION_FIRST;
  console.info(`[scb-architecture] Architecture Freeze Version: ${ARCHITECTURE_FREEZE_VERSION}`);
  console.info(
    `[scb-architecture] Read Path Mode: ${getReadPathMode()} (SCB_READ_PROJECTION_FIRST=${raw ?? 'unset'})`,
  );
}

/**
 * @param {unknown} message
 */
export function isProjectionReadyMessage(message) {
  const msg = String(message ?? '');
  if (!msg) return false;
  return /sẵn sàng|reachable/i.test(msg);
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 */
export function isProjectionTrafficReady(machine) {
  if (!machine || String(machine.status ?? '') !== 'running') return false;
  if (!isEndpointResolved(machine)) return false;
  if (!machine.projection_verified_at) return false;
  if (isProjectionVerificationStale(machine)) return false;
  return isProjectionReadyMessage(machine.projection_message);
}

/**
 * @param {Record<string, unknown>} machine
 * @param {string} machineStatus
 */
function inferProjectionHealthOk(machine, machineStatus) {
  if (machineStatus !== 'running') return false;
  return isProjectionTrafficReady(machine);
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {string} status
 * @param {string|null} message
 * @param {string|null} instanceId
 * @param {boolean} healthOk
 */
function projectionStatusResponse(machine, status, message, instanceId, healthOk) {
  const endpoint = buildConsumerEndpoint(machine ?? {}, healthOk);
  return {
    status,
    message,
    instanceId,
    ip: endpoint.ip,
    port: endpoint.port,
    comfyUrl: endpoint.comfyUrl,
    healthOk,
  };
}

/**
 * Map machine + subscription projection rows to machines/status UI shape (no provider I/O).
 *
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {Record<string, unknown>|null|undefined} subscription
 * @returns {{
 *   status: 'offline'|'creating'|'starting'|'running'|'error'|'disconnected'|'stopping';
 *   message: string|null;
 *   instanceId: string|null;
 *   ip: string|null;
 *   port: number|null;
 *   comfyUrl: string|null;
 *   healthOk: boolean;
 * }}
 */
export function resolveProjectionMachineStatus(machine, subscription) {
  if (!machine) {
    return projectionStatusResponse(null, 'offline', 'Máy chưa bật', null, false);
  }

  const instanceId = machine.instance_id ? String(machine.instance_id) : null;
  const machineStatus = String(machine.status ?? 'creating');
  const projectionMessage =
    typeof machine.projection_message === 'string' ? machine.projection_message : null;
  const errorMessage =
    typeof machine.error_message === 'string' ? machine.error_message : null;
  const serverStatus = subscription?.server_status ? String(subscription.server_status) : null;

  if (serverStatus === 'offline') {
    return projectionStatusResponse(null, 'offline', 'Máy chưa bật', null, false);
  }

  if (serverStatus === 'provisioning') {
    const booting = isMachineBooting(machine);
    if (!booting && machineStatus !== 'running') {
      return projectionStatusResponse(null, 'offline', 'Máy chưa bật', null, false);
    }
    if (
      booting &&
      !isRecentBootMachine(machine, Date.now(), PROVISIONING_BOOT_MAX_MS)
    ) {
      return projectionStatusResponse(null, 'offline', 'Máy chưa bật', null, false);
    }
  }

  if (machineStatus === 'destroyed') {
    return projectionStatusResponse(null, 'offline', 'Máy chưa bật', null, false);
  }

  if (machineStatus === 'error') {
    if (serverStatus === 'offline') {
      return projectionStatusResponse(null, 'offline', 'Máy chưa bật', null, false);
    }
    return projectionStatusResponse(
      machine,
      'error',
      errorMessage ?? projectionMessage ?? 'Khởi tạo máy thất bại',
      instanceId,
      false,
    );
  }

  if (machineStatus === 'running') {
    const healthOk = inferProjectionHealthOk(machine, machineStatus);
    const trafficReady = healthOk && serverStatus === 'online';
    if (!trafficReady) {
      return projectionStatusResponse(
        machine,
        'starting',
        projectionMessage ?? 'Đang khởi động ComfyUI...',
        instanceId,
        false,
      );
    }

    return projectionStatusResponse(
      machine,
      'running',
      projectionMessage ?? 'ComfyUI sẵn sàng',
      instanceId,
      true,
    );
  }

  if (machineStatus === 'starting') {
    return projectionStatusResponse(
      machine,
      'starting',
      projectionMessage ?? 'Đang khởi động ComfyUI...',
      instanceId,
      false,
    );
  }

  if (machineStatus === 'creating' || serverStatus === 'provisioning') {
    return projectionStatusResponse(
      machine,
      'creating',
      projectionMessage ?? 'Đang khởi tạo máy...',
      instanceId,
      false,
    );
  }

  if (serverStatus === 'online' && machineStatus !== 'running') {
    return projectionStatusResponse(
      machine,
      'starting',
      projectionMessage ?? 'Đang đồng bộ trạng thái...',
      instanceId,
      false,
    );
  }

  return projectionStatusResponse(
    machine,
    'starting',
    projectionMessage ?? 'Đang đồng bộ trạng thái...',
    instanceId,
    false,
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {number} [staleMs]
 */
export function isProjectionVerificationStale(machine, staleMs = 30_000) {
  if (!machine?.projection_verified_at) return true;
  const verifiedAt = new Date(String(machine.projection_verified_at)).getTime();
  if (!Number.isFinite(verifiedAt)) return true;
  return Date.now() - verifiedAt >= staleMs;
}
