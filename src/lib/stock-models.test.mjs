import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  STOCK_MODELS_R2_PREFIX,
  buildStockModelR2Key,
  resolveStockModelsBaseUrl,
  sanitizeStockModelRelativeKey,
} from './stock-models.js';

describe('stock-models', () => {
  it('builds R2 keys under stock/models', () => {
    assert.equal(
      buildStockModelR2Key('checkpoints/sd_xl_base_1.0.safetensors'),
      STOCK_MODELS_R2_PREFIX + '/checkpoints/sd_xl_base_1.0.safetensors',
    );
  });

  it('allowlists stock paths only', () => {
    assert.equal(sanitizeStockModelRelativeKey('checkpoints/sd_xl_base_1.0.safetensors').ok, true);
    assert.equal(sanitizeStockModelRelativeKey('users/x/outputs/a.png').ok, false);
    assert.equal(sanitizeStockModelRelativeKey('../etc/passwd').ok, false);
  });

  it('resolveStockModelsBaseUrl prefers GPUVIETNAM_MODELS_BASE_URL', () => {
    const prev = {
      m: process.env.GPUVIETNAM_MODELS_BASE_URL,
      p: process.env.R2_PUBLIC_BASE_URL,
      a: process.env.GPUVIETNAM_PUBLIC_API_URL,
      n: process.env.NEXT_PUBLIC_APP_URL,
    };
    process.env.GPUVIETNAM_MODELS_BASE_URL = 'https://cdn.example/stock/models/';
    delete process.env.R2_PUBLIC_BASE_URL;
    assert.equal(resolveStockModelsBaseUrl(), 'https://cdn.example/stock/models');
    delete process.env.GPUVIETNAM_MODELS_BASE_URL;
    process.env.GPUVIETNAM_PUBLIC_API_URL = 'https://app.example';
    assert.equal(resolveStockModelsBaseUrl(), 'https://app.example/api/storage/stock/models');
    if (prev.m == null) delete process.env.GPUVIETNAM_MODELS_BASE_URL; else process.env.GPUVIETNAM_MODELS_BASE_URL = prev.m;
    if (prev.p == null) delete process.env.R2_PUBLIC_BASE_URL; else process.env.R2_PUBLIC_BASE_URL = prev.p;
    if (prev.a == null) delete process.env.GPUVIETNAM_PUBLIC_API_URL; else process.env.GPUVIETNAM_PUBLIC_API_URL = prev.a;
    if (prev.n == null) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = prev.n;
  });
});
