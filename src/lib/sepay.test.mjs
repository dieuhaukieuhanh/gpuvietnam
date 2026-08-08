import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it, before, after } from 'node:test';
import {
  parseTransferCode,
  verifySepayWebhook,
  buildVietQrUrl,
  buildTransferDescription,
  normalizeSepayListTransaction,
  generateTransferCode,
} from './sepay.js';
import { extractDepositTransferCode } from './wallet-deposit.js';

describe('parseTransferCode', () => {
  it('extracts NV + 4 digits from transfer content', () => {
    assert.equal(parseTransferCode('NV4821'), 'NV4821');
    assert.equal(parseTransferCode('nv4821'), 'NV4821');
    assert.equal(parseTransferCode('CK NV4821 OK'), 'NV4821');
  });

  it('still parses legacy GD + 2 alphanumeric', () => {
    assert.equal(parseTransferCode('Nguyen Van A GDX7'), 'GDX7');
    assert.equal(parseTransferCode('TAITUC-ABC123 GDA1'), 'GDA1');
  });

  it('returns null when format missing', () => {
    assert.equal(parseTransferCode('no code here'), null);
    assert.equal(parseTransferCode(''), null);
  });
});

describe('wallet transfer code', () => {
  it('reads NV code from deposit description — 6 chars', () => {
    const tx = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      description: 'Nạp 50.000đ qua chuyển khoản NV4821',
    };
    assert.equal(extractDepositTransferCode(tx), 'NV4821');
    assert.equal(extractDepositTransferCode(tx).length, 6);
    assert.equal(parseTransferCode(extractDepositTransferCode(tx)), 'NV4821');
  });

  it('generateTransferCode is NV + 4 digits', () => {
    const code = generateTransferCode();
    assert.match(code, /^NV\d{4}$/);
  });
});

describe('buildTransferDescription / VietQR', () => {
  it('uses only 6-char NV code (no customer name)', () => {
    assert.equal(buildTransferDescription('Nguyen Van A', 'NV4821'), 'NV4821');
    assert.equal(buildTransferDescription('NV4821'), 'NV4821');
  });

  it('builds qr.sepay.vn URL', () => {
    const url = buildVietQrUrl({ amount: 100000, description: 'NV4821' });
    assert.match(url, /^https:\/\/qr\.sepay\.vn\/img\?/);
    assert.match(url, /amount=100000/);
    assert.match(url, /des=NV4821/);
    assert.match(url, /template=qronly/);
  });
});

describe('normalizeSepayListTransaction', () => {
  it('maps v1 list fields', () => {
    const tx = normalizeSepayListTransaction({
      id: 42,
      transferAmount: 50000,
      transferType: 'in',
      code: 'NV4821',
      content: 'NV4821',
    });
    assert.equal(tx.id, 42);
    assert.equal(tx.transferAmount, 50000);
    assert.equal(tx.code, 'NV4821');
  });
});

describe('verifySepayWebhook', () => {
  const secret = 'test-sepay-webhook-secret';
  let prev;

  before(() => {
    prev = process.env.SEPAY_WEBHOOK_SECRET;
    process.env.SEPAY_WEBHOOK_SECRET = secret;
  });

  after(() => {
    if (prev === undefined) delete process.env.SEPAY_WEBHOOK_SECRET;
    else process.env.SEPAY_WEBHOOK_SECRET = prev;
  });

  it('accepts valid sha256=HMAC(timestamp.body) signature', () => {
    const rawBody = '{"id":1,"transferAmount":100000,"code":"NV4821"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    assert.equal(verifySepayWebhook(rawBody, signature, timestamp), true);
  });

  it('rejects legacy raw-body-only HMAC', () => {
    const rawBody = '{"id":1}';
    const timestamp = Math.floor(Date.now() / 1000);
    const legacy = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    assert.equal(verifySepayWebhook(rawBody, legacy, timestamp), false);
  });

  it('rejects stale timestamp', () => {
    const rawBody = '{"id":1}';
    const timestamp = Math.floor(Date.now() / 1000) - 600;
    const signature =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    assert.equal(verifySepayWebhook(rawBody, signature, timestamp), false);
  });
});
