import { WORKSTATIONS } from '@/lib/workstations';

/** @typedef {'character-art' | 'commerce-product' | 'video-ai'} WorkstationSlug */

/** @type {Record<WorkstationSlug, string[]>} */
export const WORKSTATION_WORKFLOWS = {
  'character-art': ['avatar-ghibli.json', 'sinh-anh-co-ban.json', 'upscale-anh-cu.json'],
  'commerce-product': ['tao-anh-san-pham.json', 'doi-background.json'],
  'video-ai': ['sinh-anh-co-ban.json'],
};

/** All bundled GPUVietnam stock workflows (used when resetting the workflows folder). */
export const WORKSTATION_STOCK_FILES = [
  'avatar-ghibli.json',
  'sinh-anh-co-ban.json',
  'upscale-anh-cu.json',
  'tao-anh-san-pham.json',
  'doi-background.json',
];

const WORKSTATION_ID_TO_SLUG = {
  1: 'character-art',
  2: 'commerce-product',
  3: 'video-ai',
};

/** Workstations backed by the ComfyUI Docker image (workflows differ per slug). */
export const GPU_COMFY_WORKSTATION_IDS = [1, 2, 3];

/**
 * @param {{ id?: number } | null | undefined} workstation
 */
export function isGpuComfyWorkstation(workstation) {
  return Boolean(workstation?.id && GPU_COMFY_WORKSTATION_IDS.includes(workstation.id));
}

/**
 * @param {string | null | undefined} envName
 * @returns {{ name: string; icon: string }}
 */
export function workspaceDisplayFromEnvName(envName) {
  const resolvedName = resolveEnvName(envName);
  const workstation = WORKSTATIONS.find((item) => item.name === resolvedName);
  return {
    name: resolvedName,
    icon: workstation?.icon ?? '👤',
  };
}

/**
 * Workspace env for the current machine session (Restart-only architecture).
 * `machines.template` = workspace applied at last successful Start Machine (container boot).
 * `subscriptions.env_name` = workspace selected for the next Start Machine only.
 * @param {string | null | undefined} subscriptionEnvName
 * @param {string | null | undefined} machineTemplate
 */
export function resolveMachineWorkstationEnv(subscriptionEnvName, machineTemplate) {
  if (machineTemplate) {
    return resolveEnvName(machineTemplate);
  }
  return resolveEnvName(subscriptionEnvName);
}

/**
 * @param {string | null | undefined} envName
 * @returns {string}
 */
export function resolveEnvName(envName) {
  if (envName && WORKSTATIONS.some((workstation) => workstation.name === envName && workstation.id !== 6)) {
    return envName;
  }
  return WORKSTATIONS[0]?.name ?? 'ComfyUI — Character & Art';
}

/**
 * @param {string | null | undefined} envName
 * @returns {WorkstationSlug}
 */
export function resolveWorkstationSlug(envName) {
  const resolvedName = resolveEnvName(envName);
  const workstation = WORKSTATIONS.find((item) => item.name === resolvedName);
  if (!workstation) return 'character-art';
  return WORKSTATION_ID_TO_SLUG[workstation.id] ?? 'character-art';
}

/**
 * @param {string | null | undefined} envName
 * @returns {Record<string, string>}
 */
export function buildWorkstationContainerEnv(envName) {
  const resolvedName = resolveEnvName(envName);
  const slug = resolveWorkstationSlug(resolvedName);
  const workstation = WORKSTATIONS.find((item) => item.name === resolvedName);

  /** @type {Record<string, string>} */
  const env = {
    GPUVIETNAM_WORKSTATION: slug,
    GPUVIETNAM_ENV_NAME: resolvedName,
    GPUVIETNAM_ENV_ICON: workstation?.icon ?? '👤',
  };

  if (process.env.CIVITAI_API_TOKEN) {
    env.CIVITAI_API_TOKEN = process.env.CIVITAI_API_TOKEN;
  }

  return env;
}

/**
 * @param {WorkstationSlug} slug
 * @returns {string[]}
 */
export function getWorkflowFilesForSlug(slug) {
  return WORKSTATION_WORKFLOWS[slug] ?? WORKSTATION_WORKFLOWS['character-art'];
}
