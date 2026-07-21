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
