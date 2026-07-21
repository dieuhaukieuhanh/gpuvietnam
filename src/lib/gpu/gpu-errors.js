export class GPUError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string; operation?: string; cause?: unknown; retryable?: boolean }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'GPUError';
    this.code = options.code ?? 'GPU_ERROR';
    this.operation = options.operation;
    this.retryable = Boolean(options.retryable);
    if (options.cause instanceof Error) {
      this.cause = options.cause;
    }
  }
}

export class GPUConfigurationError extends GPUError {
  /** @param {string} message */
  constructor(message) {
    super(message, { code: 'GPU_CONFIGURATION_ERROR', retryable: false });
    this.name = 'GPUConfigurationError';
  }
}

export class GPUProviderError extends GPUError {
  /**
   * @param {string} message
   * @param {{ operation?: string; cause?: unknown; retryable?: boolean }} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      code: 'GPU_PROVIDER_ERROR',
      operation: options.operation,
      cause: options.cause,
      retryable: options.retryable ?? false,
    });
    this.name = 'GPUProviderError';
  }
}

export class GPUInstanceNotFoundError extends GPUError {
  /** @param {string} instanceId */
  constructor(instanceId) {
    super(`GPU instance not found: ${instanceId}`, {
      code: 'GPU_INSTANCE_NOT_FOUND',
      retryable: false,
    });
    this.name = 'GPUInstanceNotFoundError';
  }
}

export class GPUJobNotFoundError extends GPUError {
  /** @param {string} jobId */
  constructor(jobId) {
    super(`GPU job not found: ${jobId}`, {
      code: 'GPU_JOB_NOT_FOUND',
      retryable: false,
    });
    this.name = 'GPUJobNotFoundError';
  }
}

/**
 * @param {unknown} error
 * @param {string} [operation]
 * @returns {GPUError}
 */
export function mapProviderError(error, operation) {
  if (error instanceof GPUError) {
    if (operation && !error.operation) {
      error.operation = operation;
    }
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const retryable =
    /timeout|ECONNRESET|ETIMEDOUT|502|503|504|429|code.?5|rate.?limit/i.test(message) ||
    /no_such_ask|not available|404\/3603/i.test(message);

  if (/no_such_ask|404\/3603|not available/i.test(message)) {
    return new GPUProviderError(message, { operation, cause: error, retryable: true });
  }

  if (/not found|\b404\b/i.test(message)) {
    return new GPUProviderError(message, { operation, cause: error, retryable: false });
  }

  return new GPUProviderError(message, { operation, cause: error, retryable });
}

/**
 * @param {GPUError} error
 */
export function isRetryableGpuError(error) {
  return error instanceof GPUError && error.retryable;
}

/**
 * @param {unknown} error
 */
export function isGpuUnavailableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /no available workstation|no vast\.ai offers|no matching offer|hết gpu|out of stock|đang hết gpu|no_such_ask|not available|server-already-rented|404\/3603/i.test(
    message,
  );
}

/**
 * @param {unknown} error
 */
export function formatGpuUserMessage(error) {
  if (isGpuUnavailableError(error)) {
    return 'No Available Workstation';
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/bad host|gpu\/container|no such container|trying next offer/i.test(message)) {
    return 'Máy provider lỗi GPU/container, đang thử máy khác…';
  }
  if (/timeout|ETIMEDOUT/i.test(message)) {
    return 'Hết thời gian chờ, vui lòng thử lại';
  }
  if (/network|ECONNRESET|ECONNREFUSED|mất kết nối/i.test(message)) {
    return 'Mất kết nối';
  }

  return message || 'Không thực hiện được thao tác GPU.';
}
