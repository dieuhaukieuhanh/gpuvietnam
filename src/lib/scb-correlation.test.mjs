import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCorrelationId } from './scb-correlation.js';

describe('scb-correlation', () => {
  it('createCorrelationId returns uuid by default', () => {
    const id = createCorrelationId();
    assert.match(id, /^[0-9a-f-]{36}$/i);
  });

  it('createCorrelationId accepts valid uuid seed', () => {
    const seed = '550e8400-e29b-41d4-a716-446655440000';
    assert.equal(createCorrelationId(seed), seed);
  });
});
