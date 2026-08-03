import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { SaladClient, generateSaladContainerGroupName } from './salad-client.js';

describe('generateSaladContainerGroupName', () => {
  it('produces valid Salad names (2-63 lowercase alphanumeric + hyphens)', () => {
    const name = generateSaladContainerGroupName('test-user');
    assert.ok(name.length >= 2 && name.length <= 63, `name length ${name.length} out of range`);
    assert.ok(/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name), `name "${name}" doesn't match Salad pattern`);
    assert.ok(name.startsWith('gv-'), 'name should start with gv-');
  });

  it('includes user id safely', () => {
    const name = generateSaladContainerGroupName('User@123');
    assert.ok(name.includes('user-123'), `name should include sanitized user id: ${name}`);
  });

  it('generates unique names', () => {
    const names = new Set();
    for (let i = 0; i < 20; i++) {
      names.add(generateSaladContainerGroupName('user'));
    }
    assert.equal(names.size, 20, 'all 20 names should be unique');
  });
});

describe('SaladClient', () => {
  /** @type {SaladClient} */
  let client;

  beforeEach(() => {
    client = new SaladClient({
      apiKey: 'test-key',
      organization: 'test-org',
      project: 'test-project',
      priority: 'high',
    });
  });

  describe('constructor', () => {
    it('reads from env vars when options omitted', () => {
      const prev = process.env.SALAD_API_KEY;
      process.env.SALAD_API_KEY = 'env-key';
      try {
        const c = new SaladClient();
        assert.equal(c.apiKey, 'env-key');
      } finally {
        process.env.SALAD_API_KEY = prev;
      }
    });

    it('defaults priority to high', () => {
      const c = new SaladClient({ apiKey: 'k' });
      assert.equal(c.priority, 'high');
    });

    it('respects explicit priority', () => {
      const c = new SaladClient({ apiKey: 'k', priority: 'batch' });
      assert.equal(c.priority, 'batch');
    });
  });

  describe('_resolveOrgBaseUrl', () => {
    it('builds correct org URL', () => {
      const url = client._resolveOrgBaseUrl();
      assert.ok(url.includes('test-org'));
      assert.ok(url.startsWith('https://api.salad.com'));
    });

    it('throws when organization missing', () => {
      const c = new SaladClient({ apiKey: 'k' });
      assert.throws(() => c._resolveOrgBaseUrl(), /SALAD_ORGANIZATION/);
    });
  });

  describe('_resolveContainerBaseUrl', () => {
    it('builds container URL with project', () => {
      const url = client._resolveContainerBaseUrl();
      assert.ok(url.includes('test-org'));
      assert.ok(url.includes('test-project'));
      assert.ok(url.includes('/containers'));
    });

    it('throws when project missing', () => {
      const c = new SaladClient({ apiKey: 'k', organization: 'org' });
      assert.throws(() => c._resolveContainerBaseUrl(), /SALAD_PROJECT/);
    });
  });

  describe('_request', () => {
    it('throws when API key missing', async () => {
      const prevKey = process.env.SALAD_API_KEY;
      const prevOrg = process.env.SALAD_ORGANIZATION;
      const prevProj = process.env.SALAD_PROJECT;
      try {
        // Clear all env vars to ensure null apiKey is not overridden.
        delete process.env.SALAD_API_KEY;
        delete process.env.SALAD_ORGANIZATION;
        delete process.env.SALAD_PROJECT;

        const c = new SaladClient({
          apiKey: null,
          organization: 'test-org',
          project: 'test-project',
        });
        await assert.rejects(
          () => c._request('GET', 'https://api.salad.com/api/public/organizations/test-org/test'),
          /SALAD_API_KEY/,
        );
      } finally {
        if (prevKey !== undefined) process.env.SALAD_API_KEY = prevKey;
        else delete process.env.SALAD_API_KEY;
        if (prevOrg !== undefined) process.env.SALAD_ORGANIZATION = prevOrg;
        else delete process.env.SALAD_ORGANIZATION;
        if (prevProj !== undefined) process.env.SALAD_PROJECT = prevProj;
        else delete process.env.SALAD_PROJECT;
      }
    });
  });

  describe('resolveEndpointUrl', () => {
    it('uses networking.dns when provided', () => {
      const url = client.resolveEndpointUrl('my-group', {
        dns: 'my-group-test-org.salad.cloud',
        protocol: 'http',
        port: 8080,
      });
      assert.equal(url, 'https://my-group-test-org.salad.cloud');
    });

    it('preserves https prefix in dns', () => {
      const url = client.resolveEndpointUrl('my-group', {
        dns: 'https://my-group-test-org.salad.cloud',
      });
      assert.equal(url, 'https://my-group-test-org.salad.cloud');
    });

    it('falls back to default gateway format', () => {
      const url = client.resolveEndpointUrl('my-group');
      assert.ok(url.includes('my-group'));
      assert.ok(url.includes('salad.cloud'));
    });
  });

  describe('listGpuClasses', () => {
    it('returns empty array when no GPU class map loaded', async () => {
      // No API call made — returns from uninitialized cache.
      // Override to avoid real API call.
      client._fetchGpuClassMap = async () => new Map();
      const classes = await client.listGpuClasses();
      assert.deepEqual(classes, []);
    });
  });

  describe('resolveGpuClassUuid', () => {
    it('throws when no matching GPU class found', async () => {
      client._fetchGpuClassMap = async () => new Map();
      await assert.rejects(
        () => client.resolveGpuClassUuid('rtx3090'),
        /No Salad GPU class found/,
      );
    });

    it('uses fallback env var when map empty', async () => {
      client._fetchGpuClassMap = async () => new Map();
      const prev = process.env.SALAD_DEFAULT_GPU_CLASS_UUID;
      process.env.SALAD_DEFAULT_GPU_CLASS_UUID = 'fallback-uuid';
      try {
        const uuid = await client.resolveGpuClassUuid('rtx3090');
        assert.equal(uuid, 'fallback-uuid');
      } finally {
        process.env.SALAD_DEFAULT_GPU_CLASS_UUID = prev;
      }
    });
  });

  describe('destroyInstance', () => {
    it('throws on empty instance id', async () => {
      await assert.rejects(
        () => client.destroyInstance(''),
        /requires a container group name/,
      );
    });

    it('throws on null instance id', async () => {
      await assert.rejects(
        () => client.destroyInstance(null),
        /requires a container group name/,
      );
    });
  });
});
