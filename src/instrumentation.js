/**
 * Next.js server startup — log Architecture Freeze v2 read path mode once.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logArchitectureFreezeStartup } = await import('./lib/scb-read-path.js');
    logArchitectureFreezeStartup();

    const { startMachineOperationBackgroundWorker } = await import(
      './lib/infrastructure/machine-operation-worker-runner.js'
    );
    startMachineOperationBackgroundWorker();
  }
}
