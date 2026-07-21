import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BACKUP_FLUSH_PATH,
  buildBackupFlushUrl,
  resolveFlushBaseUrlFromCloreOrder,
  resolveFlushBaseUrlFromMachine,
  resolveFlushSecretFromMachine,
  requestContainerBackupFlush,
} from './machine-backup-http-flush.js';

describe('machine-backup-http-flush', () => {
  it('builds flush URL', () => {
    assert.equal(
      buildBackupFlushUrl('https://x.us.clorecloud.net'),
      `https://x.us.clorecloud.net${BACKUP_FLUSH_PATH}`,
    );
  });

  it('resolves Clore http_pub order', () => {
    const url = resolveFlushBaseUrlFromCloreOrder({ http_pub: 'abc.us.clorecloud.net' });
    assert.equal(url, 'https://abc.us.clorecloud.net');
  });

  it('resolves machine ip/port', () => {
    assert.equal(
      resolveFlushBaseUrlFromMachine({ ip_address: '10.0.0.1', port: 30001 }),
      'http://10.0.0.1:30001',
    );
  });

  it('reads flush secret', () => {
    assert.equal(resolveFlushSecretFromMachine({ backup_flush_secret: ' abc ' }), 'abc');
    assert.equal(resolveFlushSecretFromMachine({}), null);
  });

  it('requestContainerBackupFlush posts bearer token', async () => {
    /** @type {RequestInit | undefined} */
    let init;
    const result = await requestContainerBackupFlush({
      baseUrl: 'https://example.test',
      flushSecret: 'sec',
      timeoutMs: 5000,
      fetchImpl: async (url, options) => {
        init = options;
        assert.equal(url, `https://example.test${BACKUP_FLUSH_PATH}`);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, code: 0 }),
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(init?.method, 'POST');
    assert.equal(init?.headers?.Authorization, 'Bearer sec');
  });
});