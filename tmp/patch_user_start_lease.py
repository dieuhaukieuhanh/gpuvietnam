from pathlib import Path

p = Path("src/lib/gpu/user-start-provision.js")
s = p.read_text(encoding="utf-8")

lease_setup = """
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
      throw new Error('Provision lease lost - another worker reclaimed this claim');
    }
  };

"""

if "await lease.heartbeat('provision_start')" not in s:
    needle = "  const label =\n    provisionLabel ||"
    if needle not in s:
        needle = "  const label =\r\n    provisionLabel ||"
    idx = s.find(needle)
    assert idx >= 0, "label not found"
    try_idx = s.find("  try {", idx)
    assert try_idx >= 0
    s = s[:try_idx] + lease_setup + s[try_idx:]

replacements = [
    (
        "env: workstationContainerEnv,\n    });",
        "env: workstationContainerEnv,\n      onProgress,\n    });",
    ),
    (
        "    rentedInstanceId = String(instance.id);\n    updateLogContext({ machineId: rentedInstanceId });",
        "    rentedInstanceId = String(instance.id);\n    updateLogContext({ machineId: rentedInstanceId });\n    if (lease) {\n      lease.provider = instance.providerId ?? lease.provider;\n      lease.machineId = rentedInstanceId;\n      await onProgress('instance_rented');\n    }",
    ),
    (
        "    const machine = await insertMachineRecord(supabaseAdmin, userId, machineRow);\n    insertedMachineId = machine.id;\n    gpuService = getGpuServiceForMachine(machine);",
        "    await onProgress('machine_insert');\n    const machine = await insertMachineRecord(supabaseAdmin, userId, machineRow);\n    insertedMachineId = machine.id;\n    if (lease) lease.machineId = machine.id != null ? String(machine.id) : rentedInstanceId;\n    gpuService = getGpuServiceForMachine(machine);\n    await onProgress('machine_created');",
    ),
    (
        "    await createProvisioningPendingSession(supabaseAdmin, {",
        "    await onProgress('session_create');\n    await createProvisioningPendingSession(supabaseAdmin, {",
    ),
    (
        "    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);\n    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);\n\n    if (liveStatus.status === 'running') {",
        "    await onProgress('status_poll');\n    const liveStatus = await resolveLiveMachineStatus(gpuService, machine);\n    const syncedMachine = await syncMachineFromLiveStatus(supabaseAdmin, machine, liveStatus);\n    await onProgress(liveStatus.status === 'running' ? 'comfy_ready' : 'health_check');\n\n    if (liveStatus.status === 'running') {",
    ),
    (
        "    logPhase('user.startProvision', 'SUCCESS', {",
        "    lease?.release('provision_success');\n    lease = null;\n\n    logPhase('user.startProvision', 'SUCCESS', {",
    ),
    (
        "    void formatGpuUserMessage(gpuError);\n  }\n}",
        "    lease?.stopAutoRenew();\n    void formatGpuUserMessage(gpuError);\n  } finally {\n    lease?.stopAutoRenew();\n  }\n}",
    ),
]

for old, new in replacements:
    if old not in s:
        old2 = old.replace("\n", "\r\n")
        new2 = new.replace("\n", "\r\n")
        if old2 in s:
            s = s.replace(old2, new2, 1)
        else:
            print("MISSING:", repr(old[:60]))
    else:
        s = s.replace(old, new, 1)

p.write_text(s, encoding="utf-8", newline="\n")
print(
    "ok",
    "onProgress" in s,
    "finally" in s,
    "lease?.release" in s,
    "provision_start" in s,
)
