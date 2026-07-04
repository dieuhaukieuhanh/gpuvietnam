import { createGpuService } from './gpu-service.js';
import { VastProvider } from './providers/vast/vast-provider.js';

/** @type {import('./gpu-service.js').GPUService | null} */
let defaultGpuService = null;

/**
 * Singleton GPUService wired to VastProvider (current production backend).
 */
export function getGpuService() {
  if (!defaultGpuService) {
    defaultGpuService = createGpuService(new VastProvider());
  }
  return defaultGpuService;
}

/**
 * @param {import('./providers/gpu-provider.interface').GPUProvider} provider
 */
export function createGpuServiceWithProvider(provider) {
  return createGpuService(provider);
}

export { GPUService, createGpuService } from './gpu-service.js';
export { VastProvider } from './providers/vast/vast-provider.js';
export { VastClient } from './providers/vast/vast-client.js';
export {
  GPUError,
  GPUConfigurationError,
  GPUProviderError,
  GPUInstanceNotFoundError,
  GPUJobNotFoundError,
  mapProviderError,
  isRetryableGpuError,
  isGpuUnavailableError,
  formatGpuUserMessage,
} from './gpu-errors.js';
export {
  PLAN_TO_GPU,
  resolveGpuLineFromPlan,
  getDefaultGpuRegions,
  DEFAULT_GPU_IMAGE,
  DEFAULT_DISK_SIZE,
  DEFAULT_GPU_PORT,
} from './gpu-config.js';
export { provisionGpuInstance } from './provision-instance.js';
export {
  finalizeGpuSession,
  getBillingStatus,
  readRemainingForMachine,
  readRemainingForUser,
  collectSessionMetrics,
  closeOrphanRunningSessions,
  repairUserBillingState,
  settleMachineBillingWithoutCharge,
  findMachineForBilling,
  linkMachineToBillingSession,
  fetchOrderedBillablePlansForUser,
} from './billing.js';
export {
  mapSessionStatusFields,
  mapRemainingStatusFields,
  mapDestroyApiResponse,
} from './api-scb.js';
export {
  openBillableSession,
  createProvisioningPendingSession,
  interruptPendingSessionForUser,
  loadActiveSessionRow,
} from './session-start.js';
export { mapRemainingResultToBillingCredit, resolveScbRemainingHours } from './billing-projection.js';
export {
  loadScbRemainingForUser,
  loadScbRemainingBatch,
} from './remaining-consumer.js';
export {
  SETTLEMENT_MODULE_VERSION,
  SETTLEMENT_ERROR_CODE,
  TERMINAL_SETTLEMENT_STATUSES,
  SETTLEABLE_SETTLEMENT_STATUSES,
  calculateBillableSeconds,
  computeAvailableEntitlementSeconds,
  capChargeSeconds,
  allocateSettlementCharge,
  buildSettlementBreakdown,
  evaluateSettlementEligibility,
  isSettlementIdempotentTerminal,
  orderPlansForSettlement,
  compareSettlementPlanPriority,
  settlementPlanTier,
  isSettlementPlanUsable,
  settleSession,
  skipSessionSettlement,
  settleSessionForMachine,
} from './settlement.js';
export { fetchGpuMetrics, fetchOutputCount, fetchLiveMetrics } from './metrics.js';
export { fetchStorageInfo } from './storage.js';
export { fetchCurrentWorkflow, parseWorkflowModels } from './workflow.js';
export {
  checkAutoStop,
  syncMachineIdleState,
  triggerAutoStopDestroy,
  IDLE_WARN_MINUTES,
  IDLE_STOP_MINUTES,
  computeIdleMinutes,
  fetchComfyQueueStats,
  getMachineById,
  AUTO_STOP_MODULE_VERSION,
  AUTO_STOP_DECISION,
  decideAutoStopAction,
  shouldStopForOutOfCredit,
  shouldStopForIdle,
  shouldWarnForIdle,
} from './auto-stop.js';
export {
  calculateRemaining,
  calculateTotalEntitlement,
  calculateSettledUsage,
  calculateCurrentSessionElapsed,
  calculateSessionBillableSeconds,
  isOutOfCredit,
  clampRemainingHours,
  createClock,
  systemClock,
  isUsableEntitlementPlan,
  resolvePrimaryPlanType,
  assertAtMostOneRunningSession,
  RemainingInvariantError,
  REMAINING_STATE_OK,
  REMAINING_INVALID_STATE,
  REMAINING_ERROR_MULTIPLE_RUNNING_SESSIONS,
} from './remaining-time.js';
export {
  SESSION_STATUS,
  SETTLEMENT_STATUS,
  SESSION_COMMAND,
  SESSION_DOMAIN_EVENT,
  SESSION_ERROR_CODE,
  ILLEGAL_POLICY,
  INTERRUPT_REASON,
  SESSION_STATE_MACHINE_VERSION,
  SessionInvariantViolationError,
  SESSION_GUARDS,
  assertSessionIntegrity,
  executeCommand,
  findTransitions,
  getTransitionMap,
  createPendingSession,
  activateRunningSession,
  requestDestroy,
  closeSession,
  interruptSession,
  cancelSession,
  handleRunningVerifyFailed,
  rollbackClosingToRunning,
  retryDestroyVerification,
  retrySettlement,
  startSettlement,
  completeSettlement,
  skipSettlement,
  failSettlement,
  isTerminalStatus,
  isScbStatus,
} from './session-lifecycle.js';
export {
  PROVIDER_VERIFY_MODULE_VERSION,
  NORMALIZED_PROVIDER_STATE,
  PROVIDER_VERIFY_STATE,
  PROVIDER_VERIFY_OUTCOME,
  PROVIDER_VERIFY_ERROR_CODE,
  normalizeGpuStatusCode,
  buildProviderStateSnapshot,
  evaluateRunningVerify,
  evaluateDestroyedVerify,
  isProviderVerifyTimeoutError,
  buildUnknownVerifyResult,
  readProviderStateSnapshot,
  verifyProviderState,
  verifyInstanceRunning,
  verifyInstanceDestroyed,
  createProviderVerifyPortFromGpuService,
  reconcileMachine,
  reconcileSession,
  reconcileSettlement,
  isVerifyPass,
} from './provider-verify.js';
