/** @typedef {import('./domain/gpu-instance').GPULine} GPULine */

export const PLAN_TO_GPU = {
  starter: 'rtx3090',
  pro: 'rtx4090_1x',
  studio: 'rtx5090_1x',
};

/**
 * Package specs: GPU line, customer-facing storage, and minimum host disk.
 * Customer storage is fixed by package; host disk is eligibility-only.
 */
export const PACKAGE_SPECS = {
  starter: {
    planKey: 'starter',
    gpuLine: 'rtx3090',
    customerStorageGb: 50,
    minHostDiskGb: 50,
    numGpus: 1,
    /** Inclusive floor (GB). */
    minVramGb: 20,
  },
  pro: {
    planKey: 'pro',
    gpuLine: 'rtx4090_1x',
    customerStorageGb: 80,
    minHostDiskGb: 80,
    numGpus: 1,
    minVramGb: 20,
  },
  studio: {
    planKey: 'studio',
    gpuLine: 'rtx5090_1x',
    customerStorageGb: 120,
    minHostDiskGb: 120,
    numGpus: 1,
    /** Studio / 5090: require VRAM strictly above 30GB. */
    minVramGb: 30,
    minVramExclusive: true,
    /** Soft floor when offer reports CUDA — v4 needs a newer host driver. */
    minCudaVersion: 12.0,
  },
};

/** @type {Record<GPULine, keyof typeof PACKAGE_SPECS>} */
export const GPU_LINE_TO_PLAN = {
  rtx3090: 'starter',
  rtx4090_1x: 'pro',
  /** Legacy dual-4090 machines — still bill/display as Studio. */
  rtx4090_2x: 'studio',
  rtx5090_1x: 'studio',
};

/**
 * Dual-image strategy (maximize marketplace supply):
 * - v3 (CUDA ~12.0): Starter/Pro / 3090 / 4090 — broader host driver pool
 * - v4 (CUDA 12.8): Studio / 5090 only — Blackwell requires newer stack
 *
 * Env:
 * - GPUVIETNAM_COMFYUI_IMAGE_V3 / _V4 — per-tag overrides
 * - DEFAULT_GPU_IMAGE / GPUVIETNAM_COMFYUI_IMAGE — fallback for v4 + legacy DEFAULT
 * - GPUVIETNAM_COMFYUI_IMAGE_FORCE — force one image for all lines (rollback)
 */
export const GPU_IMAGE_REPO = 'dieuhaukieuhanh/gpuvietnam-comfyui';

export const GPU_IMAGE_V3 =
  (process.env.GPUVIETNAM_COMFYUI_IMAGE_V3 ?? '').trim() || `${GPU_IMAGE_REPO}:v3`;

export const GPU_IMAGE_V4 =
  (process.env.GPUVIETNAM_COMFYUI_IMAGE_V4 ?? '').trim() ||
  (process.env.DEFAULT_GPU_IMAGE ?? '').trim() ||
  (process.env.GPUVIETNAM_COMFYUI_IMAGE ?? '').trim() ||
  `${GPU_IMAGE_REPO}:v4`;

/**
 * Resolve ComfyUI image for a GPU line.
 * @param {import('./domain/gpu-instance').GPULine | string | null | undefined} gpuLine
 * @returns {string}
 */
export function resolveGpuImage(gpuLine) {
  const force = (process.env.GPUVIETNAM_COMFYUI_IMAGE_FORCE ?? '').trim();
  if (force) return force;
  const line = String(gpuLine ?? '').trim();
  if (line === 'rtx5090_1x') return GPU_IMAGE_V4;
  if (line === 'rtx3090' || line === 'rtx4090_1x' || line === 'rtx4090_2x') return GPU_IMAGE_V3;
  // Unknown line → v3 (maximize supply; Studio always resolves via rtx5090_1x).
  return GPU_IMAGE_V3;
}

/** @type {Record<import('./domain/gpu-instance').GPULine, string>} */
export const GPU_IMAGE_BY_LINE = {
  rtx3090: GPU_IMAGE_V3,
  rtx4090_1x: GPU_IMAGE_V3,
  rtx4090_2x: GPU_IMAGE_V3,
  rtx5090_1x: GPU_IMAGE_V4,
};

/** Legacy default — Studio/v4. Prefer resolveGpuImage(gpuLine) at provision time. */
export const DEFAULT_GPU_IMAGE = GPU_IMAGE_V4;

/** Fallback disk when plan is unknown — prefer package customer storage via resolvePackageDiskSize(). */
export const DEFAULT_DISK_SIZE = Number(process.env.DEFAULT_DISK_SIZE ?? 32);

export const DEFAULT_GPU_PORT = Number(process.env.DEFAULT_GPU_PORT ?? process.env.COMFYUI_PORT ?? 8080);

const DEFAULT_REGIONS = ['Taiwan', 'Japan', 'Singapore'];

export function getDefaultGpuRegions() {
  const raw = process.env.GPU_REGIONS;
  if (!raw) return DEFAULT_REGIONS;
  const regions = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return regions.length > 0 ? regions : DEFAULT_REGIONS;
}

/**
 * @param {string | null | undefined} planKeyOrName
 * @returns {GPULine}
 */
export function resolveGpuLineFromPlan(planKeyOrName) {
  const normalized = String(planKeyOrName ?? '')
    .trim()
    .toLowerCase();
  if (normalized in PLAN_TO_GPU) {
    return /** @type {GPULine} */ (PLAN_TO_GPU[normalized]);
  }
  if (/\bstarter\b/.test(normalized) || /\brtx\s*3090\b/.test(normalized)) return 'rtx3090';
  if (/\bstudio\b/.test(normalized) || /\brtx\s*5090\b/.test(normalized) || /\b5090\b/.test(normalized)) {
    return 'rtx5090_1x';
  }
  // Legacy explicit dual-4090 (hard-migrate Studio no longer maps here via "studio")
  if (/\b2\s*x\s*rtx\s*4090\b/.test(normalized) || /\b4090\s*2\s*x\b/.test(normalized)) {
    return 'rtx4090_2x';
  }
  if (/\bpro\b/.test(normalized) || /\brtx\s*4090\b/.test(normalized)) return 'rtx4090_1x';
  console.warn('[resolveGpuLineFromPlan] unrecognized plan, no GPU line:', planKeyOrName);
  return null;
}

/**
 * @param {string | null | undefined} planKeyOrName
 * @param {GPULine | string | null | undefined} [gpuLine]
 */
export function resolvePackageSpec(planKeyOrName, gpuLine) {
  const normalized = String(planKeyOrName ?? '')
    .trim()
    .toLowerCase();
  if (normalized in PACKAGE_SPECS) {
    return PACKAGE_SPECS[/** @type {keyof typeof PACKAGE_SPECS} */ (normalized)];
  }
  if (/starter/i.test(normalized)) return PACKAGE_SPECS.starter;
  if (/studio/i.test(normalized)) return PACKAGE_SPECS.studio;
  if (/pro/i.test(normalized)) return PACKAGE_SPECS.pro;

  const line = String(gpuLine ?? resolveGpuLineFromPlan(planKeyOrName));
  const planKey = GPU_LINE_TO_PLAN[/** @type {GPULine} */ (line)] ?? 'pro';
  return PACKAGE_SPECS[planKey];
}

/**
 * Disk size rented on the host = customer storage for the package.
 * @param {string | null | undefined} planKeyOrName
 * @param {GPULine | string | null | undefined} [gpuLine]
 */
export function resolvePackageDiskSize(planKeyOrName, gpuLine) {
  return resolvePackageSpec(planKeyOrName, gpuLine).customerStorageGb;
}

/** User-facing message when both providers / all offers fail. */
export const NO_AVAILABLE_WORKSTATION_MESSAGE = 'No Available Workstation';

/**
 * Level 1 — Provider routing.
 * Vast primary, Clore secondary (failover / occasional probe).
 * Journal evidence: Clore often rents + http_pub but public HTTP proxy fails.
 */
export const PROVIDER_ROUTING = {
  sequence: /** @type {const} */ (['vast', 'vast', 'vast', 'vast', 'clore']),
  providers: /** @type {const} */ (['vast', 'clore']),
};

/**
 * Clore GPU lines only — 5090/Studio excluded (public HTTP proxy fails across hosts).
 * @type {ReadonlySet<string>}
 */
export const CLORE_SUPPORTED_GPU_LINES = new Set(['rtx3090', 'rtx4090_1x', 'rtx4090_2x']);

/**
 * @param {string | null | undefined} gpuLine
 * @returns {boolean}
 */
export function isCloreGpuLineSupported(gpuLine) {
  const line = String(gpuLine || '').trim().toLowerCase();
  if (!line) return true; // unknown line: keep legacy Clore eligibility
  return CLORE_SUPPORTED_GPU_LINES.has(line);
}

/**
 * Level 2 — Offer selection thresholds (shared across providers).
 */
export const OFFER_SELECTION = {
  minVramGb: 20,
  maxPingMs: 250,
  /** Prefer higher uptime when median premium ≤ 10%. */
  uptimePricePremium: 1.1,
  candidatesPerGroup: 6,
  maxCandidates: 6,
  /** Ignore offers below this uptime percent (shared Vast + Clore). */
  minUptimePercent: 98.0,
  groups: {
    A: { minInclusive: 99.0, maxExclusive: Infinity },
    B: { minInclusive: 98.5, maxExclusive: 99.0 },
    C: { minInclusive: 98.0, maxExclusive: 98.5 },
  },
  /** Existing technical requirements retained from prior Vast filters. */
  minMaxDurationDays: 3,
  minInetDownMbps: 100,
  minOpenPorts: 0,
  /** Soft RAM floor (GB). Offers missing RAM are not rejected. */
  minRamGb: 16,
  /** Soft CUDA version floor. Offers missing CUDA are not rejected. */
  minCudaVersion: 11.0,
};

/**
 * Vast-only offer sanity (storage-priced / dead-GPU listings).
 * Floors are USD/hour on dph_total — tune from marketplace logs.
 */
export const VAST_OFFER_SANITY = {
  /** Reject offers cheaper than this floor per GPU line. */
  minDphTotalByLine: {
    rtx3090: 0.12,
    rtx4090_1x: 0.2,
    rtx4090_2x: 0.35,
    rtx5090_1x: 0.28,
  },
  /** Drop offers below median(cohort) * ratio (catches storage-only cheap listings). */
  medianPriceFloorRatio: 0.5,
  /** Require positive dlperf when ranking Vast offers. */
  requirePositiveDlperf: true,
  /** Post-rent poll window before destroying a bad host (ports-only legacy; multi-step gate uses VAST_PROVISION_GATE). */
  postRentTimeoutMs: 150_000,
  postRentPollMs: 8_000,
  /** Default TTL when reason category unknown. */
  badHostExclusionTtlMs: 4 * 60 * 60 * 1000,
  /** Persist exclusion list under tmp/ for multi-request reuse in one Node process / restarts. */
  badHostExclusionFile: 'tmp/vast-bad-hosts.json',
  /**
   * TTL by gate-fail reason (ms). Longer for hardware/GPU deaths.
   * @type {Record<string, number>}
   */
  badHostTtlByReasonMs: {
    /** Soft ops signal only — should not exclude hosts when HTTP customer-path passed. */
    ssh_exec: 3 * 24 * 60 * 60 * 1000,
    port: 3 * 24 * 60 * 60 * 1000,
    http_endpoint: 3 * 24 * 60 * 60 * 1000,
    gpu_stats: 12 * 60 * 60 * 1000,
    nvidia_smi: 12 * 60 * 60 * 1000,
    cuda: 12 * 60 * 60 * 1000,
    comfy_smoke: 6 * 60 * 60 * 1000,
    comfy_workflow: 6 * 60 * 60 * 1000,
    slow: 2 * 60 * 60 * 1000,
    default: 4 * 60 * 60 * 1000,
  },
};

/**
 * Vast L1 — do not bottom-fish price within uptime cohort.
 * Starter: drop cheapest bottom fraction. Pro/Studio: keep P40–P70 (widen when cohort thin).
 *
 * Temporarily disabled for all plans — post-rent gate (CUDA / Comfy) is the quality SoT.
 * Set `enabled: true` to restore band filtering.
 */
export const VAST_PERCENTILE_BAND = {
  enabled: false,
  fullCohortMin: 8,
  thinCohortMin: 4,
  starter: {
    fullDropBottomFraction: 0.18,
    thinDropCheapestCount: 1,
  },
  proStudio: {
    fullLowPct: 0.4,
    fullHighPct: 0.7,
    thinLowPct: 0.25,
    thinHighPct: 0.85,
  },
};

/**
 * Vast L2 — multi-step provision gate (before returning rented instance to app).
 * Hard path = public HTTP Comfy (system_stats + prompt smoke).
 * SSH is soft (ops_degraded) and must not alone destroy a machine.
 * Clore reuses the same timeout table via CLORE_PROVISION_GATE alias.
 */
export const VAST_PROVISION_GATE = {
  pollMs: 5_000,
  sshReadyTimeoutMs: 30_000,
  /** Soft SSH probe after HTTP pass — do not block delivery for the full SSH window. */
  sshSoftTimeoutMs: 30_000,
  portTimeoutMs: 45_000,
  gpuCudaTimeoutMs: 90_000,
  comfyWorkflowTimeoutMs: 120_000,
  comfyColdStartExtraMs: 90_000,
  /** nvidia-smi / system_stats expected name substrings by gpu line */
  expectedGpuNameByLine: {
    rtx3090: ['3090'],
    rtx4090_1x: ['4090'],
    rtx4090_2x: ['4090'],
    rtx5090_1x: ['5090'],
  },
};

/**
 * Clore L2 gate — base = Vast budgets; soft SSH window longer (hosts slow to expose 22).
 * Hard delivery uses HTTP customer-path; SSH fail → ops_degraded, not destroy.
 */
export const CLORE_PROVISION_GATE = {
  ...VAST_PROVISION_GATE,
  sshReadyTimeoutMs: Number(process.env.CLORE_SSH_READY_TIMEOUT_MS) > 0
    ? Number(process.env.CLORE_SSH_READY_TIMEOUT_MS)
    : 120_000,
  sshSoftTimeoutMs: Number(process.env.CLORE_SSH_SOFT_TIMEOUT_MS) > 0
    ? Number(process.env.CLORE_SSH_SOFT_TIMEOUT_MS)
    : 60_000,
  /** Per-attempt SSH exec cap while polling ready. */
  sshExecAttemptTimeoutMs: Number(process.env.CLORE_SSH_EXEC_ATTEMPT_MS) > 0
    ? Number(process.env.CLORE_SSH_EXEC_ATTEMPT_MS)
    : 25_000,
};

/**
 * Clore bad-host exclusion — 30 days for any post-rent / gate failure.
 * Kill-switch / override: CLORE_BAD_HOST_TTL_DAYS (default 30).
 */
const CLORE_BAD_HOST_TTL_DAYS = Math.max(
  1,
  Number(process.env.CLORE_BAD_HOST_TTL_DAYS) > 0
    ? Number(process.env.CLORE_BAD_HOST_TTL_DAYS)
    : 30,
);
const CLORE_BAD_HOST_TTL_MS = CLORE_BAD_HOST_TTL_DAYS * 24 * 60 * 60 * 1000;

export const CLORE_BAD_HOST = {
  badHostExclusionTtlMs: CLORE_BAD_HOST_TTL_MS,
  badHostExclusionFile: 'tmp/clore-bad-hosts.json',
  /** All gate-fail categories share the 30-day Clore TTL. */
  badHostTtlByReasonMs: {
    ssh_exec: CLORE_BAD_HOST_TTL_MS,
    port: CLORE_BAD_HOST_TTL_MS,
    http_endpoint: CLORE_BAD_HOST_TTL_MS,
    gpu_stats: CLORE_BAD_HOST_TTL_MS,
    nvidia_smi: CLORE_BAD_HOST_TTL_MS,
    cuda: CLORE_BAD_HOST_TTL_MS,
    comfy_smoke: CLORE_BAD_HOST_TTL_MS,
    comfy_workflow: CLORE_BAD_HOST_TTL_MS,
    slow: CLORE_BAD_HOST_TTL_MS,
    default: CLORE_BAD_HOST_TTL_MS,
  },
};

/**
 * Permanent country/region block for marketplace rentals (Clore + Vast).
 * Matched against ISO cc (UA/IR) and region / geolocation labels.
 */
export const CLORE_BLOCKED_REGIONS = {
  countryCodes: /** @type {const} */ (['UA', 'IR']),
  /** Lowercase substrings / names */
  regionNames: /** @type {const} */ ([
    'ukraine',
    'iran',
    'islamic republic of iran',
  ]),
};

/** Alias — same list applies to Vast and Clore. */
export const MARKETPLACE_BLOCKED_REGIONS = CLORE_BLOCKED_REGIONS;

/** @deprecated Use OFFER_SELECTION — kept for transitional imports. */
export const GPU_STRICT_FILTERS = {
  minReliability: OFFER_SELECTION.minUptimePercent / 100,
  minDiskGb: PACKAGE_SPECS.starter.minHostDiskGb,
  minMaxDurationDays: OFFER_SELECTION.minMaxDurationDays,
  minInetDownMbps: OFFER_SELECTION.minInetDownMbps,
  minOpenPorts: OFFER_SELECTION.minOpenPorts,
  minVramGb: OFFER_SELECTION.minVramGb,
};

/** @deprecated Geography is no longer used for offer selection (ping-only). */
export const GPU_SCORE_WEIGHTS = {
  price: 0.6,
  region: 0.15,
  network: 0.1,
  uptime: 0.1,
  dlperf: 0.05,
};

/** @deprecated Price premium cap removed; uptime-group median logic replaces it. */
export const MAX_PRICE_PREMIUM = 1.2;

/** Max offers attempted per selection round (Step 5). */
export const MAX_OFFERS_PER_REGION = OFFER_SELECTION.maxCandidates;

/** @deprecated Location filtering removed — ping ≤ 250ms is the only network constraint. */
export const GPU_FALLBACK_LEVELS = [
  { label: 'global', asiaMode: 'global' },
];
