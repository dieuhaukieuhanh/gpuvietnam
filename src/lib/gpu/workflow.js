import { ComfyClient } from './providers/vast/comfy-client.js';

const CACHE_TTL_MS = 15_000;
/** @type {Map<string, { at: number; value: unknown }>} */
const cache = new Map();

function humanizeAssetName(name) {
  return String(name)
    .replace(/\.(safetensors|ckpt|pt|pth)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} workflow
 */
export function parseWorkflowModels(workflow) {
  let model = null;
  /** @type {string[]} */
  const loras = [];

  if (!workflow || typeof workflow !== 'object') {
    return { model: null, loras: [], current_model: null };
  }

  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type ?? '');
    const inputs = node.inputs ?? {};

    if (classType === 'CheckpointLoaderSimple' && inputs.ckpt_name) {
      model = humanizeAssetName(String(inputs.ckpt_name));
    }
    if (classType === 'UNETLoader' && inputs.unet_name) {
      model = humanizeAssetName(String(inputs.unet_name));
    }
    if (
      (classType === 'LoraLoader' ||
        classType === 'LoraLoaderModelOnly' ||
        classType === 'Power Lora Loader (rgthree)') &&
      inputs.lora_name
    ) {
      loras.push(humanizeAssetName(String(inputs.lora_name)));
    }
    if (classType === 'Power Lora Loader (rgthree)' && inputs && typeof inputs === 'object') {
      for (const [key, value] of Object.entries(inputs)) {
        if (/lora/i.test(key) && typeof value === 'string' && value.trim()) {
          loras.push(humanizeAssetName(value));
        }
      }
    }
  }

  const uniqueLoras = [...new Set(loras.filter(Boolean))];
  return {
    model,
    loras: uniqueLoras,
    current_model: model,
  };
}

/**
 * @param {string} comfyUrl EndpointReady URL from buildConsumerEndpoint
 */
export async function fetchCurrentWorkflow(comfyUrl) {
  const cacheKey = `workflow:${comfyUrl}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return cached.value;
  }

  const comfy = new ComfyClient(comfyUrl);
  let workflow = null;

  try {
    const queue = await comfy.request('/queue');
    const running = Array.isArray(queue?.queue_running) ? queue.queue_running[0] : null;
    const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending[0] : null;
    const activeItem = running ?? pending;
    if (Array.isArray(activeItem) && activeItem[2] && typeof activeItem[2] === 'object') {
      workflow = activeItem[2];
    }
  } catch {
    // fall through to history
  }

  if (!workflow) {
    try {
      const history = await comfy.request('/history');
      const entries = Object.values(history ?? {}).filter(Boolean);
      const latest = entries[entries.length - 1];
      if (latest?.prompt?.[2] && typeof latest.prompt[2] === 'object') {
        workflow = latest.prompt[2];
      }
    } catch {
      // ignore
    }
  }

  const parsed = parseWorkflowModels(workflow);
  cache.set(cacheKey, { at: Date.now(), value: parsed });
  return parsed;
}
