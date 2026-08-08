import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it, before, after } from 'node:test';
import {
  parseTransferCode,
  verifySepayWebhook,
  buildVietQrUrl,
  buildTransferDescription,
  normalizeSepayListTransaction,
} from './sepay.js';
import { buildDepositTransferNote, shortTransactionId } from './wallet-deposit.js';

describe('parseTransferCode', () => {
  it('extracts GD + 2 alphanumeric from transfer content', () => {
    assert.equal(parseTransferCode('Nguyen Van A GDX7'), 'GDX7');
    assert.equal(parseTransferCode('gdx7'), 'GDX7');
    assert.equal(parseTransferCode('TAITUC-ABC123 GDA1'), 'GDA1');
  });

  it('returns null when format missing', () => {
    assert.equal(parseTransferCode('no code here'), null);
    assert.equal(parseTransferCode(''), null);
  });
});

describe('wallet transfer code length parity', () => {
  it('matches shortTransactionId used by deposit note', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    assert.equal(shortTransactionId(id), 'A1');
    assert.equal(buildDepositTransferNote(id), 'GDA1');
    assert.equal(parseTransferCode(`Khach Hang ${buildDepositTransferNote(id)}`), 'GDA1');
  });
});

describe('buildTransferDescription / VietQR', () => {
  it('uses GD code only (no customer name prefix)', () => {
    assert.equal(buildTransferDescription('Nguyen Van A', 'GDX7'), 'GDX7');
    assert.equal(buildTransferDescription(null, 'GDA1'), 'GDA1');
  });

  it('builds qr.sepay.vn URL', () => {
    const url = buildVietQrUrl({ amount: 100000, description: 'GDX7' });
    assert.match(url, /^https:\/\/qr\.sepay\.vn\/img\?/);
    assert.match(url, /amount=100000/);
    assert.match(url, /des=GDX7/);
    assert.match(url, /template=qronly/);
  });
});

describe('normalizeSepayListTransaction', () => {
  it('maps v1 list fields', () => {
    const tx = normalizeSepayListTransaction({
      id: 42,
      transferAmount: 50000,
      transferType: 'in',
      code: 'GDA1',
      content: 'Khach Hang GDA1',
    });
    assert.equal(tx.id, 42);
    assert.equal(tx.transferAmount, 50000);
    assert.equal(tx.code, 'GDA1');
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
    const rawBody = '{"id":1,"transferAmount":100000,"code":"GDA1"}';
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
