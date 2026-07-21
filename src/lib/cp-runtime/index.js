/**
 * Control Plane ↔ Runtime modules (Architecture v2.0 / B1).
 */

export {
  buildAttemptLogKey,
  buildAttemptOutputKey,
  buildAttemptSidecarKey,
  buildJobInputKey,
  buildManifestEntry,
  buildProjectAssetKey,
  buildResultManifest,
  buildStockModelKey,
  isCpDurableObjectKey,
  isStockObjectKey,
} from './storage-paths.js';

export {
  DEFAULT_STOCK_MODELS,
  GPUVIETNAM_EXTENSIONS,
  PACK_VERSION,
  SPEC_ID_V3,
  SPEC_ID_V4,
  buildRuntimeImageSpec,
  evaluateImageSpecParity,
  getRuntimeImageSpec,
  getRuntimeImageSpecCatalog,
  inferImageSpecRefFromDockerImage,
  normalizeModelRelativeKey,
  parseOfficialNodesLock,
  resolveImageSpecRefForGpuLine,
} from './runtime-image-spec.js';

export {
  RUNTIME_PORT_ERROR_CODES,
  RUNTIME_PORT_METHODS,
  RuntimePortError,
  assertRuntimePort,
  createRecordingRuntimePort,
  createUnimplementedRuntimePort,
  validateCreateParams,
  validateSubmitParams,
} from './runtime-port.js';

export {
  createComfyRuntimePort,
  runJobAttemptViaRuntimePort,
} from './comfy-adapter.js';

export {
  COMFY_SMOKE_WORKFLOW,
  TINY_PNG_BYTES,
} from './comfy-smoke-workflow.js';

export { createMemoryRuntimeRegistryStore } from './runtime-registry-store.js';

export {
  createProviderBackedComfyRuntimePort,
  createProviderRuntimeBindings,
  runProviderBackedJobAttempt,
  waitForProviderEndpoint,
} from './provider-runtime-bind.js';

export {
  FAILOVER_RETRYABLE_CODES,
  isFailoverRetryable,
  runJobWithFailover,
} from './failover.js';

export {
  buildJobListItemViewModel,
  buildJobListViewModels,
  isMissingCpJobsRelation,
  jobUiStatusBadgeClass,
  jobUiStatusLabel,
  resolveJobUiStatus,
} from './job-attempt-display.js';

export { listUserJobDashboardItems } from './list-user-jobs.js';

export {
  createCpWorkflow,
  getCpWorkflow,
  listCpWorkflows,
  toWorkflowClientSyncPayload,
  upsertCpWorkflowDocument,
} from './workflow-sot.js';

export {
  listProjectSnapshots,
  restoreProjectSnapshot,
  saveProjectSnapshot,
} from './project-snapshot.js';

export {
  buildSessionRestoreViewModel,
  loadSessionRestoreContext,
} from './session-restore.js';

export {
  buildRuntimeRebindPlan,
  rebindComfyProxyToRuntime,
} from './runtime-rebind.js';

export {
  DUAL_RUN_BILLING,
  DUAL_RUN_UX_COPY_VI,
  buildDualRunUxState,
  estimateDualRunCustomerCharge,
  evaluateDualRunEligibility,
  isDualRunAllowedForPlan,
} from './dual-run-policy.js';

export {
  runJobWithDualRun,
  selectDualRunWinner,
} from './dual-run.js';
