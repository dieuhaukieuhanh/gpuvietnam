/**
 * Architecture Freeze v3.2 - golden contract tests for external endpoint state.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildConsumerEndpoint,
  buildEndpointFromMachine,
  buildExternalEndpoint,
  INTERNAL_CONTAINER_PORT,
  isEndpointPending,
  isEndpointReadyForTraffic,
  isEndpointResolved,
  isHealthOk,
} from './endpoint-utils.js';

describe('Architecture Freeze v3.2 - endpoint golden contract', () => {
  it('Pending A: ip=null, port=null, comfyUrl=null', () => {
    const input = { ip: null, port: null };
    assert.equal(isEndpointPending(input), true);
    assert.equal(isEndpointResolved(input), false);

    const endpoint = buildExternalEndpoint(null, null);
    assert.equal(endpoint.ip, null);
    assert.equal(endpoint.port, null);
    assert.equal(endpoint.comfyUrl, null);
  });

  it('Pending B: ip!=null, port=null, comfyUrl=null (never http://ip:8080)', () => {
    const ip = '116.127.115.27';
    const input = { ip_address: ip, port: null };
    assert.equal(isEndpointPending(input), true);
    assert.equal(isEndpointResolved(input), false);

    const endpoint = buildExternalEndpoint(ip, null);
    assert.equal(endpoint.ip, ip);
    assert.equal(endpoint.port, null);
    assert.equal(endpoint.comfyUrl, null);
  });

  it('Resolved: ip!=null, port=HostPort, comfyUrl=http://ip:HostPort', () => {
    const ip = '116.127.115.27';
    const hostPort = 30954;
    const input = { ip_address: ip, port: hostPort };
    assert.equal(isEndpointPending(input), false);
    assert.equal(isEndpointResolved(input), true);

    const endpoint = buildExternalEndpoint(ip, hostPort);
    assert.equal(endpoint.ip, ip);
    assert.equal(endpoint.port, hostPort);
    assert.equal(endpoint.comfyUrl, `http://${ip}:${hostPort}`);
    assert.notEqual(endpoint.port, INTERNAL_CONTAINER_PORT);
  });

  it('Destroyed: comfyUrl=null', () => {
    const endpoint = buildEndpointFromMachine({
      status: 'destroyed',
      ip_address: '116.127.115.27',
      port: 30954,
    });
    assert.equal(endpoint.comfyUrl, null);
  });
});

describe('Architecture Freeze v3.2 - endpoint contract edge cases', () => {
  it('legacy port=8080 is not Resolved and must not produce external URL', () => {
    const ip = '116.127.115.27';
    const input = { ip_address: ip, port: 8080 };
    assert.equal(isEndpointResolved(input), false);

    const endpoint = buildExternalEndpoint(ip, 8080);
    assert.equal(endpoint.comfyUrl, null);
    assert.equal(endpoint.port, null);
  });

  it('buildExternalEndpoint(null, HostPort) returns comfyUrl=null', () => {
    const endpoint = buildExternalEndpoint(null, 30954);
    assert.equal(endpoint.comfyUrl, null);
  });
});

describe('Architecture Freeze v3.2 Phase 4 - EndpointReady gate', () => {
  const ip = '116.127.115.27';
  const hostPort = 30954;
  const resolvedMachine = { ip_address: ip, port: hostPort };

  it('Pending: port=null, comfyUrl=null', () => {
    const pending = { ip_address: ip, port: null };
    assert.equal(isEndpointReadyForTraffic(pending, true), false);
    const endpoint = buildConsumerEndpoint(pending, true);
    assert.equal(endpoint.port, null);
    assert.equal(endpoint.comfyUrl, null);
  });

  it('Resolved + health fail: port=HostPort, comfyUrl=null', () => {
    assert.equal(isEndpointResolved(resolvedMachine), true);
    assert.equal(isEndpointReadyForTraffic(resolvedMachine, false), false);
    assert.equal(isHealthOk(false), false);

    const endpoint = buildConsumerEndpoint(resolvedMachine, false);
    assert.equal(endpoint.ip, ip);
    assert.equal(endpoint.port, hostPort);
    assert.equal(endpoint.comfyUrl, null);
  });

  it('Resolved + health OK: port=HostPort, comfyUrl=http://ip:HostPort', () => {
    assert.equal(isEndpointReadyForTraffic(resolvedMachine, true), true);

    const endpoint = buildConsumerEndpoint(resolvedMachine, true);
    assert.equal(endpoint.port, hostPort);
    assert.equal(endpoint.comfyUrl, `http://${ip}:${hostPort}`);
  });

  it('buildEndpointFromMachine unchanged for write-path Resolved (Phase 3)', () => {
    const endpoint = buildEndpointFromMachine(resolvedMachine);
    assert.equal(endpoint.comfyUrl, `http://${ip}:${hostPort}`);
  });
});
