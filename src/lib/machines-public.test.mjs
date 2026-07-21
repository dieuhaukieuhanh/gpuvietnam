import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MACHINE_CUSTOMER_DENYLIST,
  customerPayloadHasMachineInternals,
  scrubMachineForCustomer,
} from './machines-public.js';

describe('scrubMachineForCustomer', () => {
  it('strips image and secrets from customer payloads', () => {
    const scrubbed = scrubMachineForCustomer({
      status: 'running',
      template: 'ComfyUI — Character & Art',
      image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v3',
      ssh_password: 'secret',
      backup_flush_secret: 'flush',
      comfyUrl: 'https://example.com',
    });
    assert.equal(scrubbed.status, 'running');
    assert.equal(scrubbed.comfyUrl, 'https://example.com');
    assert.equal('image' in scrubbed, false);
    assert.equal('ssh_password' in scrubbed, false);
    assert.equal('backup_flush_secret' in scrubbed, false);
    assert.ok(MACHINE_CUSTOMER_DENYLIST.includes('image'));
  });

  it('detects leaked internals', () => {
    assert.equal(customerPayloadHasMachineInternals({ image: 'x' }), true);
    assert.equal(customerPayloadHasMachineInternals({ status: 'running' }), false);
  });
});
