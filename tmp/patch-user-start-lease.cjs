const fs = require('fs');
const p = 'src/lib/gpu/user-start-provision.js';
let s = fs.readFileSync(p, 'utf8');

if (!s.includes("from '../provision-lease.js'")) {
  s = s.replace(
    "import { logger, logPhase, updateLogContext } from '../logging/index.js';",
    "import { logger, logPhase, updateLogContext } from '../logging/index.js';\nimport { ProvisionLeaseHandle } from '../provision-lease.js';"
  );
}

const oldBlock = `  const label =
    provisionLabel ||
    \`gv-\${String(userId).replace(/-/g, '').slice(0, 8)}-\${String(subscriptionId).replace(/-/g, '').slice(0, 8)}-\${String(correlationId ?? '').replace(/-/g, '').slice(0, 8)}\`.slice(0, 64);

  try {
    let instance = await provisionGpuInstance(gpuService, {
      gpuLine,
      plan: planKey,
      label,
      env: workstationContainerEnv,
    });`;

const newBlock = `  const label =
    provisionLabel ||
    \`gv-\${String(userId).replace(/-/g, '').slice(0, 8)}-\${String(subscriptionId).replace(/-/g, '').slice(0, 8)}-\${String(correlationId ?? '').replace(/-/g, '').slice(0, 8)}\`.slice(0, 64);

  const leaseId = subscription?.provisioning_lease_id
    ? String(subscription.provisioning_lease_id)
    : null;
  const leaseOwner = subscription?.provisioning_lease_owner
    ? String(subscription.provisioning_lease_owner)
    : null;
  /** @type {import('../provision-lease.js').ProvisionLeaseHandle | null} */
  let lease = null;
  if (leaseId) {
    lease = new ProvisionLeaseHandle({
      supabaseAdmin,
      subscriptionId,
      leaseId,
      ownerId: leaseOwner || 'unknown',
      requestId: correlationId,
      provider: 'clore',
    });
    lease.startAutoRenew();
    await lease.heartbeat('provision_start');
  }

  const onProgress = async (step) => {
    if (!lease) return;
    const ok = await lease.onProgress(step);
    if (!ok) {
      throw new Error('Provision lease lost — another worker reclaimed this claim');
    }
  };

  try {
    let instance = await provisionGpuInstance(gpuService, {
      gpuLine,
      plan: planKey,
      label,
      env: workstationContainerEnv,
      onProgress,
    });`;

if (!s.includes('provisionLabel ||')) {
  console.error('label block missing');
  process.exit(1);
}
if (!s.includes(oldBlock)) {
  console.error('exact oldBlock not found — dumping nearby');
  const i = s.indexOf('const label =');
  console.log(JSON.stringify(s.slice(i, i + 350)));
  process.exit(1);
}
s = s.replace(oldBlock, newBlock);

s = s.replace(
  `    rentedInstanceId = String(instance.id);
    updateLogContext({ machineId: rentedInstanceId });`,
  `    rentedInstanceId = String(instance.id);
    updateLogContext({ machineId: rentedInstanceId });
    if (lease) {
      lease.provider = instance.providerId ?? lease.provider;
      lease.machineId = rentedInstanceId;
      await onProgress('instance_rented');
    }`
);

s = s.replace(
  `    const machine = await insertMachineRecord(supabaseAdmin, userId, machineRow);
    insertedMachineId = machine.id;
    gpuService = getGpuServiceForMachine(machine);`,
  `    await onProgress('machine_insert');
    const machine = await insertMachineRecord(supabaseAdmin, userId, machineRow);
    insertedMachineId = machine.id;
    if (lease) lease.machineId = machine.id != null ? String(machine.id) : rentedInstanceId;
    gpuService = getGpuServiceForMachine(machine);
    await onProgress('machine_created');`
);

s = s.replace(
  `    await createProvisioningPendingSession(supabaseAdmin, {`,
  `    await onProgress('session_create');
    await createProvisioningPendingSession(supabaseAdmin, {`
);

s = s.replace(
  `    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);
    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);

    if (liveStatus.status === 'running') {
      await persistProviderRunning(`,
  `    await onProgress('status_poll');
    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);
    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);
    await onProgress(liveStatus.status === 'running' ? 'comfy_ready' : 'health_check');

    if (liveStatus.status === 'running') {
      await persistProviderRunning(`
);

s = s.replace(
  `    logPhase('user.startProvision', 'SUCCESS', {`,
  `    lease?.release('provision_success');
    lease = null;

    logPhase('user.startProvision', 'SUCCESS', {`
);

if (!s.includes('lease?.stopAutoRenew()')) {
  s = s.replace(
    `    void formatGpuUserMessage(gpuError);
  }
}`,
    `    lease?.stopAutoRenew();
    void formatGpuUserMessage(gpuError);
  } finally {
    lease?.stopAutoRenew();
  }
}`
);

fs.writeFileSync(p, s, 'utf8');
console.log('patched ok', s.includes('ProvisionLeaseHandle'), s.includes('onProgress'));
