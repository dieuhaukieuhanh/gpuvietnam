/**
 * Minimal Comfy graph for Adapter smoke (no checkpoint / VAE).
 * Same shape as provision-http-gate EmptyImage → PreviewImage.
 */

export const COMFY_SMOKE_WORKFLOW = Object.freeze({
  '1': {
    class_type: 'EmptyImage',
    inputs: { width: 64, height: 64, batch_size: 1, color: 0 },
  },
  '2': {
    class_type: 'PreviewImage',
    inputs: { images: ['1', 0] },
  },
});

/** Tiny valid 1×1 PNG (black). */
export const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
