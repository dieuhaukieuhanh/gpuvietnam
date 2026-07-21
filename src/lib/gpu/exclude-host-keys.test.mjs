import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hostKeyIsExcluded,
  hostKeyMatchTokens,
  normalizeExcludeHostKeys,
} from './exclude-host-keys.js';

describe('exclude-host-keys', () => {
  it('matches full, base, and bare id forms', () => {
    assert.equal(hostKeyIsExcluded('vast-host:7788|rtx4090_1x', ['vast-host:7788']), true);
    assert.equal(hostKeyIsExcluded('vast-host:7788', ['7788']), true);
    assert.equal(hostKeyIsExcluded('vast-host:99|rtx3090', ['vast-host:7788']), false);
    assert.ok(hostKeyMatchTokens('clore-host:42|rtx5090_1x').has('42'));
    assert.ok(hostKeyIsExcluded('clore-host:42', ['clore-host:42|rtx5090_1x']));
    const normalized = normalizeExcludeHostKeys(['vast-host:1|rtx4090_1x']);
    assert.ok(normalized.includes('vast-host:1'));
    assert.ok(normalized.includes('1'));
  });
});
