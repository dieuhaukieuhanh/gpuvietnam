import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSshTargetFromClore } from './machine-ssh.js';

describe('resolveSshTargetFromClore', () => {
  it('maps pub_cluster + tcp_ports 22 to SSH host/port', () => {
    const target = resolveSshTargetFromClore(
      {
        pub_cluster: ['n1.us.clorecloud.net'],
        tcp_ports: ['22:1548', '8080:30001'],
      },
      { password: 'secret' },
    );
    assert.ok(target);
    assert.equal(target.host, 'n1.us.clorecloud.net');
    assert.equal(target.port, 1548);
    assert.equal(target.username, 'root');
    assert.equal(target.password, 'secret');
  });

  it('returns null when SSH mapping missing', () => {
    const target = resolveSshTargetFromClore({ http_pub: 'x.us.clorecloud.net' }, { password: 'x' });
    assert.equal(target, null);
  });
});