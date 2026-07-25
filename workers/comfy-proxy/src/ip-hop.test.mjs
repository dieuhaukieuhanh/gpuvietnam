import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rewriteIpLiteralUpstreamForFetch } from './ip-hop.js';

describe('worker ip-hop', () => {
  it('rewrites Vast IP; keeps Clore host', () => {
    assert.equal(
      rewriteIpLiteralUpstreamForFetch('http://173.239.95.142:45522', 'sslip.io'),
      'http://173-239-95-142.sslip.io:45522',
    );
    assert.equal(
      rewriteIpLiteralUpstreamForFetch('https://x.us.clorecloud.net', 'sslip.io'),
      'https://x.us.clorecloud.net',
    );
  });
});
