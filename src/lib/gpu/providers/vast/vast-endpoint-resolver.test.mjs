import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENDPOINT_HARD_TTL_MS,
  ENDPOINT_HEALTH_TRUST_WINDOW_MS,
  buildResolvedEndpoint,
  createCachedEndpoint,
  extractDirectPortFromV0Record,
  extractHostPortFromV1Record,
  invalidateEndpointCacheTrust,
  isEndpointCacheTrusted,
  markEndpointCacheHealthOk,
  resolveVastEndpoint,
  shouldRefreshEndpointCache,
} from './vast-endpoint-resolver.js';

describe('extractHostPortFromV1Record', () => {
  it('reads HostPort for internal port key', () => {
    const record = {
      ports: {
        '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '33526' }],
      },
    };
    assert.equal(extractHostPortFromV1Record(record, 8080), 33526);
  });

  it('returns null when ports missing', () => {
    assert.equal(extractHostPortFromV1Record({ public_ipaddr: '1.2.3.4' }, 8080), null);
  });
});

describe('extractDirectPortFromV0Record', () => {
  it('reads direct_port_start when positive', () => {
    assert.equal(extractDirectPortFromV0Record({ direct_port_start: 20000 }), 20000);
  });

  it('ignores non-positive direct_port_start', () => {
    assert.equal(extractDirectPortFromV0Record({ direct_port_start: -1 }), null);
  });
});

describe('resolveVastEndpoint', () => {
  it('prefers v1 HostPort over v0 internal defaults', async () => {
    const client = {
      async listInstanceV1() {
        return {
          id: 1,
          public_ipaddr: '116.127.115.18',
          ports: { '8080/tcp': [{ HostPort: '33526' }] },
        };
      },
      async getInstance() {
        return { instances: { public_ipaddr: '116.127.115.18', direct_port_start: -1 } };
      },
    };

    const result = await resolveVastEndpoint(client, '1', 8080, {
      instances: { public_ipaddr: '116.127.115.18', direct_port_start: -1 },
    });

    assert.equal(result.status, 'resolved');
    assert.equal(result.endpoint.url, 'http://116.127.115.18:33526');
    assert.equal(result.endpoint.source, 'v1-hostport');
  });

  it('returns pending when HostPort absent and no direct port', async () => {
    const client = {
      async listInstanceV1() {
        return { id: 1, public_ipaddr: '116.127.115.18', ports: null };
      },
      async getInstance() {
        return { instances: { public_ipaddr: '116.127.115.18', direct_port_start: -1 } };
      },
    };

    const result = await resolveVastEndpoint(client, '1', 8080, {
      instances: { public_ipaddr: '116.127.115.18', direct_port_start: -1 },
    });

    assert.equal(result.status, 'pending');
    assert.equal(result.host, '116.127.115.18');
  });

  it('uses v0 direct port when v1 HostPort missing', async () => {
    const client = {
      async listInstanceV1() {
        return { id: 1, public_ipaddr: '10.0.0.1', ports: null };
      },
      async getInstance() {
        return { instances: { public_ipaddr: '10.0.0.1', direct_port_start: 20000 } };
      },
    };

    const result = await resolveVastEndpoint(client, '1', 8080, {
      instances: { public_ipaddr: '10.0.0.1', direct_port_start: 20000 },
    });

    assert.equal(result.status, 'resolved');
    assert.equal(result.endpoint.url, 'http://10.0.0.1:20000');
    assert.equal(result.endpoint.source, 'v0-direct-port');
  });
});

describe('endpoint cache trust', () => {
  it('trusts cache after health ok within window', () => {
    const now = 1_000_000;
    const endpoint = buildResolvedEndpoint('1.2.3.4', 33526, 8080, 'v1-hostport', now);
    const cache = createCachedEndpoint(endpoint);
    markEndpointCacheHealthOk(cache, now + 1000);
    assert.equal(isEndpointCacheTrusted(cache, now + 2000), true);
    assert.equal(shouldRefreshEndpointCache(cache, { now: now + 2000 }), false);
  });

  it('invalidates trust after health window expires', () => {
    const now = 1_000_000;
    const endpoint = buildResolvedEndpoint('1.2.3.4', 33526, 8080, 'v1-hostport', now);
    const cache = createCachedEndpoint(endpoint);
    markEndpointCacheHealthOk(cache, now);
    const later = now + ENDPOINT_HEALTH_TRUST_WINDOW_MS + 1;
    assert.equal(isEndpointCacheTrusted(cache, later), false);
    assert.equal(shouldRefreshEndpointCache(cache, { now: later }), true);
  });

  it('forces refresh after hard ttl', () => {
    const now = 1_000_000;
    const endpoint = buildResolvedEndpoint('1.2.3.4', 33526, 8080, 'v1-hostport', now);
    const cache = createCachedEndpoint(endpoint);
    markEndpointCacheHealthOk(cache, now + 1000);
    const later = now + ENDPOINT_HARD_TTL_MS + 1;
    assert.equal(shouldRefreshEndpointCache(cache, { now: later }), true);
  });

  it('invalidateEndpointCacheTrust clears trusted flag', () => {
    const cache = createCachedEndpoint(
      buildResolvedEndpoint('1.2.3.4', 33526, 8080, 'v1-hostport'),
    );
    markEndpointCacheHealthOk(cache);
    invalidateEndpointCacheTrust(cache);
    assert.equal(cache.trusted, false);
    assert.equal(cache.lastHealthOkAt, null);
  });
});
