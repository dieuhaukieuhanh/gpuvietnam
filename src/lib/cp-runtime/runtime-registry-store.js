/**
 * In-memory Runtime Registry + Attempt binding store (B1.6).
 * Mirrors public.runtime_registry / job_attempts shapes for orchestration
 * before full Supabase wiring.
 */

/**
 * @typedef {object} RuntimeRegistryRow
 * @property {string} id
 * @property {string} userId
 * @property {string | null} [machineId]
 * @property {string | null} [instanceId]
 * @property {string} provider
 * @property {string} runtimeKind
 * @property {string} status
 * @property {string | null} [endpointUrl]
 * @property {string | null} [imageSpecRef]
 * @property {string | null} [image]
 * @property {string | null} [lastError]
 * @property {Record<string, unknown>} [metadata]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {string | null} [readyAt]
 * @property {string | null} [destroyedAt]
 */

/**
 * @typedef {object} AttemptBindRow
 * @property {string} attemptId
 * @property {string} jobId
 * @property {string} userId
 * @property {number} attemptNumber
 * @property {string} status
 * @property {string | null} [runtimeId]
 * @property {string | null} [machineId]
 * @property {string | null} [instanceId]
 * @property {string | null} [externalPromptId]
 * @property {string | null} [imageSpecRef]
 * @property {string | null} [errorMessage]
 * @property {Record<string, unknown>} [metadata]
 * @property {string} [updatedAt]
 */

/**
 * @returns {{
 *   upsertRuntime: (row: Partial<RuntimeRegistryRow> & { id: string }) => Promise<RuntimeRegistryRow>;
 *   getRuntime: (id: string) => Promise<RuntimeRegistryRow | null>;
 *   listRuntimes: () => Promise<RuntimeRegistryRow[]>;
 *   upsertAttempt: (row: Partial<AttemptBindRow> & { attemptId: string; jobId: string; userId: string }) => Promise<AttemptBindRow>;
 *   getAttempt: (attemptId: string) => Promise<AttemptBindRow | null>;
 *   getAttemptByRuntime: (runtimeId: string) => Promise<AttemptBindRow | null>;
 * }}
 */
export function createMemoryRuntimeRegistryStore() {
  /** @type {Map<string, RuntimeRegistryRow>} */
  const runtimes = new Map();
  /** @type {Map<string, AttemptBindRow>} */
  const attempts = new Map();

  return {
    async upsertRuntime(row) {
      const id = String(row.id ?? '').trim();
      if (!id) throw new Error('upsertRuntime: id required');
      const prev = runtimes.get(id);
      const now = new Date().toISOString();
      /** @type {RuntimeRegistryRow} */
      const next = {
        id,
        userId: String(row.userId ?? prev?.userId ?? ''),
        machineId: row.machineId !== undefined ? row.machineId : (prev?.machineId ?? null),
        instanceId: row.instanceId !== undefined ? row.instanceId : (prev?.instanceId ?? null),
        provider: String(row.provider ?? prev?.provider ?? 'unknown'),
        runtimeKind: String(row.runtimeKind ?? prev?.runtimeKind ?? 'comfy'),
        status: String(row.status ?? prev?.status ?? 'pending'),
        endpointUrl:
          row.endpointUrl !== undefined ? row.endpointUrl : (prev?.endpointUrl ?? null),
        imageSpecRef:
          row.imageSpecRef !== undefined ? row.imageSpecRef : (prev?.imageSpecRef ?? null),
        image: row.image !== undefined ? row.image : (prev?.image ?? null),
        lastError: row.lastError !== undefined ? row.lastError : (prev?.lastError ?? null),
        metadata: row.metadata ?? prev?.metadata ?? {},
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        readyAt:
          row.readyAt !== undefined
            ? row.readyAt
            : row.status === 'ready' && !prev?.readyAt
              ? now
              : (prev?.readyAt ?? null),
        destroyedAt:
          row.destroyedAt !== undefined
            ? row.destroyedAt
            : row.status === 'destroyed'
              ? now
              : (prev?.destroyedAt ?? null),
      };
      runtimes.set(id, next);
      return next;
    },

    async getRuntime(id) {
      return runtimes.get(String(id ?? '')) ?? null;
    },

    async listRuntimes() {
      return [...runtimes.values()];
    },

    async upsertAttempt(row) {
      const attemptId = String(row.attemptId ?? '').trim();
      if (!attemptId) throw new Error('upsertAttempt: attemptId required');
      const prev = attempts.get(attemptId);
      const now = new Date().toISOString();
      /** @type {AttemptBindRow} */
      const next = {
        attemptId,
        jobId: String(row.jobId ?? prev?.jobId ?? ''),
        userId: String(row.userId ?? prev?.userId ?? ''),
        attemptNumber: Number(row.attemptNumber ?? prev?.attemptNumber ?? 1) || 1,
        status: String(row.status ?? prev?.status ?? 'pending'),
        runtimeId: row.runtimeId !== undefined ? row.runtimeId : (prev?.runtimeId ?? null),
        machineId: row.machineId !== undefined ? row.machineId : (prev?.machineId ?? null),
        instanceId: row.instanceId !== undefined ? row.instanceId : (prev?.instanceId ?? null),
        externalPromptId:
          row.externalPromptId !== undefined
            ? row.externalPromptId
            : (prev?.externalPromptId ?? null),
        imageSpecRef:
          row.imageSpecRef !== undefined ? row.imageSpecRef : (prev?.imageSpecRef ?? null),
        errorMessage:
          row.errorMessage !== undefined ? row.errorMessage : (prev?.errorMessage ?? null),
        metadata: row.metadata ?? prev?.metadata ?? {},
        updatedAt: now,
      };
      attempts.set(attemptId, next);
      return next;
    },

    async getAttempt(attemptId) {
      return attempts.get(String(attemptId ?? '')) ?? null;
    },

    async getAttemptByRuntime(runtimeId) {
      const id = String(runtimeId ?? '');
      for (const row of attempts.values()) {
        if (row.runtimeId === id) return row;
      }
      return null;
    },
  };
}
