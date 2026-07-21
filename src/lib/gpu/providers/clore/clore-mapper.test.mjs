import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapCloreOrderToGPUInstance,
  parseCloreTcpPortMap,
  resolveClorePublicEndpoints,
} from './clore-mapper.js';

const sampleOrder = {
  id: 1939941,
  online: true,
  status: null,
  pub_cluster: ['n1.us.clorecloud.net'],
  tcp_ports: ['22:1972'],
  http_port: '8080',
  http_pub: '2q8138x0hvvzh.us.clorecloud.net',
  ct: 1783703890,
};

describe('clore-mapper endpoints', () => {
  it('parses tcp_ports local:public map', () => {
    assert.deepEqual(parseCloreTcpPortMap(['22:1972', '8080:30001']), {
      '22': 1972,
      '8080': 30001,
    });
  });

  it('resolves https endpoint from http_pub', () => {
    const endpoints = resolveClorePublicEndpoints(sampleOrder, 8080);
    assert.equal(endpoints.endpointUrl, 'https://2q8138x0hvvzh.us.clorecloud.net');
    assert.equal(endpoints.externalPort, 443);
    assert.equal(endpoints.sshHost, 'n1.us.clorecloud.net');
    assert.equal(endpoints.sshPort, 1972);
    assert.deepEqual(endpoints.candidateUrls, [
      'https://2q8138x0hvvzh.us.clorecloud.net',
    ]);
  });

  it('includes direct tcp candidate when mapped', () => {
    const endpoints = resolveClorePublicEndpoints(
      { ...sampleOrder, tcp_ports: ['22:1972', '8080:30001'] },
      8080,
    );
    assert.ok(endpoints.candidateUrls.includes('https://2q8138x0hvvzh.us.clorecloud.net'));
    assert.ok(endpoints.candidateUrls.includes('http://n1.us.clorecloud.net:30001'));
  });

  it('maps online Clore order to running with public host', () => {
    const instance = mapCloreOrderToGPUInstance(sampleOrder, 'rtx3090', { port: 8080 });
    assert.equal(instance.id, '1939941');
    assert.equal(instance.status.code, 'running');
    assert.equal(instance.endpointUrl, 'https://2q8138x0hvvzh.us.clorecloud.net');
    assert.equal(instance.metadata.port, 443);
    assert.equal(instance.metadata.sshPort, 1972);
    assert.equal(instance.metadata.sshPassword, null);
  });

  it('keeps gpuvietnam_ssh_password on metadata', () => {
    const instance = mapCloreOrderToGPUInstance(
      { ...sampleOrder, gpuvietnam_ssh_password: 'GvTestPassA1' },
      'rtx3090',
      { port: 8080 },
    );
    assert.equal(instance.metadata.sshPassword, 'GvTestPassA1');
  });

  it('maps gpuvietnam_ops soft SSH flags', () => {
    const instance = mapCloreOrderToGPUInstance(
      {
        ...sampleOrder,
        gpuvietnam_ops: { ssh_ok: false, ops_degraded: true, ssh_detail: 'ECONNRESET' },
      },
      'rtx3090',
      { port: 8080 },
    );
    assert.equal(instance.metadata.sshOk, false);
    assert.equal(instance.metadata.opsDegraded, true);
  });
});
