import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'session-ghost-close.js'), 'utf8');

describe('session-ghost-close source invariants', () => {
  it('closes running and pending ghosts but skips pending with no machine_id', () => {
    assert.match(src, /\.in\('status',\s*\['running',\s*'pending'\]\)/);
    assert.match(src, /status === 'pending' && !mid/);
    assert.match(src, /machine\.status.*destroyed|=== 'destroyed'/);
  });

  it('does not treat error machines as destroyed (keep-open / replace)', () => {
    assert.doesNotMatch(src, /status === 'error'/);
  });
});
