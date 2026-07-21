import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('logging', () => {
  /** @type {string} */
  let dir;
  /** @type {string|undefined} */
  let prevLogDir;
  /** @type {string|undefined} */
  let prevConsole;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'gv-logs-'));
    prevLogDir = process.env.LOG_DIR;
    prevConsole = process.env.LOG_TO_CONSOLE;
    process.env.LOG_DIR = dir;
    process.env.LOG_TO_CONSOLE = 'false';
  });

  after(() => {
    if (prevLogDir === undefined) delete process.env.LOG_DIR;
    else process.env.LOG_DIR = prevLogDir;
    if (prevConsole === undefined) delete process.env.LOG_TO_CONSOLE;
    else process.env.LOG_TO_CONSOLE = prevConsole;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('writes structured JSON with requestId to channel files', async () => {
    const { __resetLoggerForTests, initLogging, logger, runWithLogContext, logOperation } =
      await import('./index.js');
    __resetLoggerForTests();
    initLogging();

    await runWithLogContext(
      {
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        userId: 'user-1',
        operation: 'test.op',
        channel: 'api',
      },
      async () => {
        await logOperation(
          'test.op',
          async () => 'ok',
          { channel: 'api', requestId: '550e8400-e29b-41d4-a716-446655440000', userId: 'user-1' },
        );
        logger('provider').info({ machineId: 'm-1' }, 'provider note');
        logger('api').error({ operation: 'test.fail' }, 'boom');
      },
    );

    await new Promise((r) => setTimeout(r, 250));

    const apiPath = join(dir, 'api.log');
    const providerPath = join(dir, 'provider.log');
    const errorPath = join(dir, 'error.log');
    assert.equal(existsSync(apiPath), true);
    assert.equal(existsSync(providerPath), true);
    assert.equal(existsSync(errorPath), true);

    const apiText = readFileSync(apiPath, 'utf8');
    assert.match(apiText, /550e8400-e29b-41d4-a716-446655440000/);
    assert.match(apiText, /"phase":"START"/);
    assert.match(apiText, /"phase":"SUCCESS"/);
    assert.match(apiText, /user-1/);

    const providerText = readFileSync(providerPath, 'utf8');
    assert.match(providerText, /provider note/);
    assert.match(providerText, /550e8400-e29b-41d4-a716-446655440000/);

    const errorText = readFileSync(errorPath, 'utf8');
    assert.match(errorText, /boom/);
  });

  it('resolveRequestId reuses header uuid', async () => {
    const { resolveRequestId } = await import('./api.js');
    const id = resolveRequestId({
      headers: { 'x-request-id': '550e8400-e29b-41d4-a716-446655440000' },
    });
    assert.equal(id, '550e8400-e29b-41d4-a716-446655440000');
  });

  it('redacts secrets and truncates large payloads', async () => {
    const { redactObject, isSensitiveKey } = await import('./redact.js');
    assert.equal(isSensitiveKey('authorization'), true);
    assert.equal(isSensitiveKey('apiKey'), true);
    const redacted = redactObject({
      authorization: 'Bearer secret-token',
      password: 'hunter2',
      cookie: 'sid=abc',
      planId: 'pro',
      huge: 'A'.repeat(2000),
      nested: { access_token: 'xyz', ok: true },
    });
    assert.equal(redacted.authorization, '[REDACTED]');
    assert.equal(redacted.password, '[REDACTED]');
    assert.equal(redacted.cookie, '[REDACTED]');
    assert.equal(redacted.planId, 'pro');
    assert.match(String(redacted.huge), /truncated/);
    assert.equal(/** @type {any} */ (redacted.nested).access_token, '[REDACTED]');
    assert.equal(/** @type {any} */ (redacted.nested).ok, true);
  });

  it('serializeError keeps stack, cause, requestId', async () => {
    const { serializeError } = await import('./serialize-error.js');
    const { runWithLogContext } = await import('./context.js');
    const cause = new Error('root cause');
    const err = new Error('outer');
    err.cause = cause;
    const serialized = await runWithLogContext(
      { requestId: '550e8400-e29b-41d4-a716-446655440000', operation: 'op.x' },
      () => serializeError(err, { provider: 'clore' }),
    );
    assert.equal(serialized.message, 'outer');
    assert.ok(typeof serialized.stack === 'string');
    assert.equal(serialized.requestId, '550e8400-e29b-41d4-a716-446655440000');
    assert.equal(serialized.operation, 'op.x');
    assert.equal(serialized.provider, 'clore');
    assert.equal(/** @type {any} */ (serialized.cause).message, 'root cause');
  });

  it('formatSupportCode produces REQ-XXXXXXXX', async () => {
    const { formatSupportCode, parseSupportCodeOrRequestId } = await import('./support-code.js');
    assert.equal(formatSupportCode('550e8400-e29b-41d4-a716-446655440000'), 'REQ-550E8400');
    assert.equal(
      parseSupportCodeOrRequestId('550e8400-e29b-41d4-a716-446655440000'),
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });
});
