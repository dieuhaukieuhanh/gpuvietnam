/**
 * Centralized structured logging for GPUVietnam.
 *
 * @example
 * import { logger, logOperation, withApiLogging } from '@/lib/logging';
 */

export { LOG_CHANNELS, LOG_CHANNEL_FILES, normalizeChannel } from './channels.js';
export { LOGGING_VERSION } from './version.js';
export {
  getLogContext,
  runWithLogContext,
  updateLogContext,
  bindingsFromContext,
} from './context.js';
export { getLogger, logger, log, __resetLoggerForTests } from './logger.js';
export { logOperation, logPhase } from './operations.js';
export {
  REQUEST_ID_HEADER,
  resolveRequestId,
  setRequestIdHeader,
  withApiLogging,
  withBackgroundLogContext,
  bindRequestActors,
  supportCodeFields,
} from './api.js';
export { initLogging, ensureLogsDir, getLogsDir } from './init.js';
export { formatSupportCode, parseSupportCodeOrRequestId } from './support-code.js';
export { serializeError } from './serialize-error.js';
export { redactObject, redactValue, summarizeRequest, isSensitiveKey } from './redact.js';
export { providerDiag } from './provider-fields.js';
export { logScbTransition } from './scb-transition.js';
export { logStartupDiagnostics } from './startup.js';
