import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CloreClient,
  CLORE_CANCEL_ORDER_RETRY_WAITS_MS,
  cloreServerAcceptsCurrency,
  isCloreUsdPriceConsistent,
  isOfferRentError,
  readCloreWalletBalance,
  resolveCloreRequiredPriceDaily,
  resolveClorePricePerHour,
  classifyCloreServerForLine,
  extractCloreOrderId,
  extractCloreServerId,
  isCloreOrderActive,
  isGpuVietnamCloreOrder,
  sanitizeCloreContainerEnv,
  buildCloreOnstartCommand,
  isCloreAutosshEnabled,
} from './clore-client.js';
import { GPUProviderError } from '../../gpu-errors.js';

function serverFixture(overrides = {}) {
  return {
    id: 31148,
    rented: false,
    reliability: 0.9,
    gpu_array: ['NVIDIA GeForce RTX 4090'],
    specs: { gpu: '1x NVIDIA GeForce RTX 4090', gpuram: 24, disk: '500GB', net: { cc: 'SG' } },
    price: {
      on_demand: {
        bitcoin: 0.00006,
        'CLORE-Blockchain': 3300,
        'USD-Blockchain': 1.61,
      },
      usd: {
        on_demand_usd: 1.61,
        on_demand_clore: 3.99,
        on_demand_btc: 3.99,
        spot: 0,
      },
    },
    ...overrides,
  };
}

describe('clore currency filters', () => {
  it('accepts hosts with positive USD-Blockchain on_demand', () => {
    assert.equal(cloreServerAcceptsCurrency(serverFixture(), 'USD-Blockchain'), true);
  });

  it('rejects hosts missing USD-Blockchain', () => {
    const server = serverFixture({
      price: {
        on_demand: { bitcoin: 0.0001, 'CLORE-Blockchain': 1000 },
        usd: { on_demand_usd: 4, on_demand_clore: 4, on_demand_btc: 4 },
      },
    });
    assert.equal(cloreServerAcceptsCurrency(server, 'USD-Blockchain'), false);
  });

  it('rejects hosts that list USD price but omit USD from allowed_coins', () => {
    const server = serverFixture({
      allowed_coins: ['bitcoin', 'CLORE-Blockchain'],
    });
    assert.equal(cloreServerAcceptsCurrency(server, 'USD-Blockchain'), false);
  });

  it('accepts hosts when allowed_coins includes USD-Blockchain', () => {
    const server = serverFixture({
      allowed_coins: ['bitcoin', 'CLORE-Blockchain', 'USD-Blockchain'],
    });
    assert.equal(cloreServerAcceptsCurrency(server, 'USD-Blockchain'), true);
  });

  it('flags inconsistent USD vs CLORE USD-equiv (incident host shape)', () => {
    assert.equal(isCloreUsdPriceConsistent(serverFixture()), false);
  });

  it('keeps consistent USD pricing', () => {
    const server = serverFixture({
      price: {
        on_demand: {
          bitcoin: 0.00003,
          'CLORE-Blockchain': 3500,
          'USD-Blockchain': 4.3,
        },
        usd: {
          on_demand_usd: 4.3,
          on_demand_clore: 4.3,
          on_demand_btc: 1.8,
          spot: 0,
        },
      },
    });
    assert.equal(isCloreUsdPriceConsistent(server), true);
  });
});

describe('clore offer rent error classification', () => {
  it('routes offer-loop continues through Retry Policy Engine', () => {
    // Currency → another host immediately
    assert.equal(isOfferRentError(new Error('Clore.ai 500: currency-not-allowed')), true);
    assert.equal(isOfferRentError(new Error('Clore.ai 500 (code 6): currency-not-allowed')), true);

    // Provider internal: switch host immediately → walk continues
    assert.equal(isOfferRentError(new Error('Clore.ai 500 (code 1): Internal Server Error')), true);

    // Rate limit: same-host first — isOfferRentError is false until host-switch decision
    assert.equal(isOfferRentError(new Error('Clore.ai 429 (code 5): rate limit')), false);
    assert.equal(
      isOfferRentError(new Error('Clore.ai 429 (code 5): rate limit'), { retryCount: 3 }),
      true,
    );

    // Still switches host after retries for code 1
    assert.equal(
      isOfferRentError(new Error('Clore.ai 500 (code 1): Internal Server Error'), { retryCount: 3 }),
      true,
    );
  });

  it('does not treat config errors as per-offer retry', () => {
    assert.equal(isOfferRentError(new Error('CLORE_API_KEY is not configured')), false);
  });
});

describe('clore wallet + required price helpers', () => {
  it('reads USD-Blockchain balance from wallets array', () => {
    const bal = readCloreWalletBalance(
      {
        code: 0,
        wallets: [
          { currency: 'bitcoin', balance: 0 },
          { currency: 'USD-Blockchain', balance: 37.51 },
        ],
      },
      'USD-Blockchain',
    );
    assert.equal(bal, 37.51);
  });

  it('uses on_demand USD-Blockchain for required_price', () => {
    const classified = classifyCloreServerForLine(serverFixture(), 'rtx4090_1x');
    assert.ok(classified);
    const pricePerHour = resolveClorePricePerHour(serverFixture(), classified);
    const required = resolveCloreRequiredPriceDaily(
      {
        offerId: 31148,
        pricePerHour,
        raw: serverFixture(),
      },
      'USD-Blockchain',
    );
    assert.equal(required, 1.61);
  });

  it('extracts order id and recovers from empty create payload shape', async () => {
    const { extractCloreOrderId } = await import('./clore-client.js');
    assert.equal(extractCloreOrderId({ code: 0 }), '');
    assert.equal(extractCloreOrderId({ code: 0, order_id: 1939941 }), '1939941');
    assert.equal(extractCloreOrderId({ order: { id: 55 } }), '55');
  });

  it('rejects multi-GPU 3090 hosts for starter line unless partial rental', () => {
    const dual = serverFixture({
      id: 1,
      gpu_array: ['NVIDIA GeForce RTX 3090', 'NVIDIA GeForce RTX 3090'],
      specs: { gpu: '2x NVIDIA GeForce RTX 3090', gpuram: 24, disk: '500GB', net: { cc: 'SG' } },
      partial_gpu_rental: false,
      price: {
        on_demand: { 'USD-Blockchain': 4, bitcoin: 0.0001, 'CLORE-Blockchain': 1000 },
        usd: { on_demand_usd: 4, on_demand_clore: 4, on_demand_btc: 4 },
      },
    });
    assert.equal(classifyCloreServerForLine(dual, 'rtx3090'), null);
    dual.partial_gpu_rental = true;
    assert.ok(classifyCloreServerForLine(dual, 'rtx3090'));
  });

  it('classifies 5090 1x with VRAM > 30 and rejects low VRAM', () => {
    const ok = serverFixture({
      gpu_array: ['NVIDIA GeForce RTX 5090'],
      specs: { gpu: '1x NVIDIA GeForce RTX 5090', gpuram: 32, disk: '500GB', net: { cc: 'SG' } },
    });
    assert.ok(classifyCloreServerForLine(ok, 'rtx5090_1x'));

    const low = serverFixture({
      gpu_array: ['NVIDIA GeForce RTX 5090'],
      specs: { gpu: '1x NVIDIA GeForce RTX 5090', gpuram: 24, disk: '500GB', net: { cc: 'SG' } },
    });
    assert.equal(classifyCloreServerForLine(low, 'rtx5090_1x'), null);

    const edge = serverFixture({
      gpu_array: ['NVIDIA GeForce RTX 5090'],
      specs: { gpu: '1x NVIDIA GeForce RTX 5090', gpuram: 30, disk: '500GB', net: { cc: 'SG' } },
    });
    assert.equal(classifyCloreServerForLine(edge, 'rtx5090_1x'), null);
  });
});

describe('clore order identity helpers', () => {
  it('reads si as server id and treats online orders as active', () => {
    const order = {
      id: 1939941,
      si: 88028,
      image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v1',
      online: true,
    };
    assert.equal(extractCloreServerId(order), '88028');
    assert.equal(isCloreOrderActive(order), true);
    assert.equal(isGpuVietnamCloreOrder(order), true);
  });
});

describe('sanitizeCloreContainerEnv', () => {
  it('strips emoji icons and replaces ampersand (Clore code-1 trigger)', () => {
    const out = sanitizeCloreContainerEnv({
      GPUVIETNAM_ENV_ICON: '🛒',
      GPUVIETNAM_ENV_NAME: 'ComfyUI — Commerce & Product',
      COMFYUI_PORT: '8080',
    });
    assert.equal(out.GPUVIETNAM_ENV_ICON, undefined);
    assert.equal(out.GPUVIETNAM_ENV_NAME, 'ComfyUI - Commerce and Product');
    assert.equal(out.COMFYUI_PORT, '8080');
    assert.ok(!out.GPUVIETNAM_ENV_NAME.includes('&'));
  });
});

describe('Clore onstart (create_order only)', () => {
  it('buildCloreOnstartCommand binds Comfy without changing image CMD', () => {
    const cmd = buildCloreOnstartCommand(8080);
    assert.match(cmd, /^#!\/bin\/bash/);
    assert.match(cmd, /--listen 0\.0\.0\.0/);
    assert.match(cmd, /PORT="\$\{COMFYUI_PORT\}"|COMFYUI_PORT="8080"/);
    assert.match(cmd, /nohup python main\.py/);
    assert.match(cmd, /download-models\.sh/);
    assert.ok(!cmd.includes('exec /app/start.sh'));
  });

  it('isCloreAutosshEnabled defaults on and respects kill-switch', () => {
    const prev = process.env.CLORE_AUTOSSH_ENTRYPOINT;
    try {
      delete process.env.CLORE_AUTOSSH_ENTRYPOINT;
      assert.equal(isCloreAutosshEnabled(), true);
      process.env.CLORE_AUTOSSH_ENTRYPOINT = 'false';
      assert.equal(isCloreAutosshEnabled(), false);
      process.env.CLORE_AUTOSSH_ENTRYPOINT = 'true';
      assert.equal(isCloreAutosshEnabled(), true);
    } finally {
      if (prev === undefined) delete process.env.CLORE_AUTOSSH_ENTRYPOINT;
      else process.env.CLORE_AUTOSSH_ENTRYPOINT = prev;
    }
  });
});

describe('CloreClient.destroyInstance', () => {
  it('exports multi-second cancel backoff waits', () => {
    assert.ok(Array.isArray(CLORE_CANCEL_ORDER_RETRY_WAITS_MS));
    assert.ok(CLORE_CANCEL_ORDER_RETRY_WAITS_MS.length >= 3);
    assert.ok(CLORE_CANCEL_ORDER_RETRY_WAITS_MS.every((ms) => ms >= 1000));
  });

  it('retries cancel_order on 429 then succeeds when order gone', async () => {
    const client = new CloreClient({ apiKey: 'test-key' });
    let cancelCalls = 0;
    client.request = async (method, path) => {
      if (method === 'POST' && path === '/cancel_order') {
        cancelCalls += 1;
        if (cancelCalls < 3) {
          throw new GPUProviderError('Clore.ai code 5: rate limit', { retryable: true });
        }
        return { code: 0 };
      }
      throw new Error(`unexpected ${method} ${path}`);
    };
    client.listMyOrders = async () => (cancelCalls >= 3 ? [] : [{ id: 1964920, http_pub: 'x.example' }]);

    const result = await client.destroyInstance('1964920', { waitsMs: [1, 1, 1] });
    assert.equal(result.cancelled, true);
    assert.equal(cancelCalls, 3);
    assert.equal(extractCloreOrderId({ id: 1964920 }), '1964920');
  });

  it('treats already-gone order as successful cancel', async () => {
    const client = new CloreClient({ apiKey: 'test-key' });
    client.request = async () => {
      throw new GPUProviderError('Clore.ai code 4: unknown order', { retryable: false });
    };
    client.listMyOrders = async () => [];
    const result = await client.destroyInstance('1964920', { waitsMs: [1] });
    assert.equal(result.cancelled, true);
    assert.equal(result.alreadyGone, true);
  });
});
