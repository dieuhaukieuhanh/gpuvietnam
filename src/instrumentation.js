/**
 * Next.js server startup — logging + Architecture Freeze read path + machine-op worker.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initLogging, logStartupDiagnostics, logger } = await import('./lib/logging/index.js');
    initLogging();
    logStartupDiagnostics();

    const { logArchitectureFreezeStartup } = await import('./lib/scb-read-path.js');
    logArchitectureFreezeStartup();

    const { startMachineOperationBackgroundWorker } = await import(
      './lib/infrastructure/machine-operation-worker-runner.js'
    );
    startMachineOperationBackgroundWorker();

    const { startCloreOrphanReconciliation } = await import(
      './lib/gpu/providers/clore/clore-orphan-runner.js'
    );
    startCloreOrphanReconciliation();

    logger('app').info({ operation: 'server.boot', phase: 'SUCCESS' }, 'server instrumentation ready');
  }
}
