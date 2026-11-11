import * as assert from 'node:assert/strict';
import test from 'node:test';
import { ToolExecutor } from '../../dist/server/executor.js';
import {
  LATEST_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '../../dist/server/protocol.js';
import { FredoQaMcpServer } from '../../dist/server/server.js';
import { TEST_LICENSE_OPTIONS } from '../helpers/license-fixture.ts';

const server = () => new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);

function initialize(params?: Record<string, unknown>) {
  return server().handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params }).result as {
    protocolVersion: string;
    capabilities: unknown;
    serverInfo: { name: string; version: string };
  };
}

test('protocol: the latest supported version is one of the supported versions, newest first', () => {
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.length >= 1);
  assert.equal(LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS[0]);
  assert.deepEqual([...SUPPORTED_PROTOCOL_VERSIONS].sort().reverse(), [
    ...SUPPORTED_PROTOCOL_VERSIONS,
  ]);
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    assert.match(version, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('protocol: every supported version is echoed back when the client asks for it', () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    assert.equal(negotiateProtocolVersion(version), version);
    assert.equal(initialize({ protocolVersion: version }).protocolVersion, version);
  }
});

test('protocol: an unsupported, future or malformed version gets the latest supported one', () => {
  const requests: unknown[] = [
    '1999-01-01',
    '2099-12-31',
    '2026-07-28 ',
    ' 2024-11-05',
    '2024-11-05\n',
    '2024-11-05\u0000',
    '2024-1-5',
    'latest',
    '',
    '__proto__',
    'constructor',
    'toString',
    'x'.repeat(100_000),
    undefined,
    null,
    0,
    20241105,
    true,
    false,
    [],
    ['2024-11-05'],
    {},
    { toString: () => '2024-11-05' },
  ];
  for (const requested of requests) {
    assert.equal(
      negotiateProtocolVersion(requested),
      LATEST_PROTOCOL_VERSION,
      `${typeof requested}: ${JSON.stringify(requested)?.slice(0, 40)}`,
    );
  }
});

test('protocol: initialize survives missing, empty and odd params', () => {
  for (const params of [undefined, {}, { protocolVersion: 5 }, { protocolVersion: null }]) {
    const result = initialize(params as Record<string, unknown> | undefined);
    assert.equal(result.protocolVersion, LATEST_PROTOCOL_VERSION);
    assert.deepEqual(result.capabilities, { tools: {} });
    assert.equal(result.serverInfo.name, '@illicomedia/skills-mcp-server');
  }
});

test('protocol: initialize ignores unrelated client fields and never echoes them', () => {
  const result = initialize({
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: { roots: {} },
    clientInfo: { name: 'evil', version: '9' },
  });
  assert.equal(JSON.stringify(result).includes('evil'), false);
});

test('protocol: get_version reports the latest supported version and the supported list', () => {
  const text = ToolExecutor.execute(
    'get_version',
    {},
    undefined,
    () => undefined,
    TEST_LICENSE_OPTIONS,
  );
  const info = JSON.parse(text);
  assert.equal(info.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.deepEqual(info.supportedProtocolVersions, [...SUPPORTED_PROTOCOL_VERSIONS]);
});

test('protocol: the supported list cannot be changed from outside', () => {
  assert.throws(() => (SUPPORTED_PROTOCOL_VERSIONS as unknown as string[]).push('2099-01-01'));
  assert.equal(Object.isFrozen(SUPPORTED_PROTOCOL_VERSIONS), true);
});
