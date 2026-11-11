import * as assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  SUPPORTED_NODE_RANGE,
  unsupportedRuntimeReason,
} from '../../dist/security/runtime-guard.js';

test('Runtime guard: runs on maintained Node.js lines only', () => {
  for (const version of ['v22.0.0', 'v22.23.4', 'v24.0.0', 'v24.22.2', 'v26.0.0', 'v28.1.0']) {
    assert.strictEqual(unsupportedRuntimeReason(version), null, version);
  }
  for (const version of ['v18.20.8', 'v20.20.2', 'v21.7.3', 'v23.11.1', 'v25.9.0']) {
    assert.match(String(unsupportedRuntimeReason(version)), /no longer receives security fixes/);
  }
  assert.match(String(unsupportedRuntimeReason('not-a-version')), /not supported/);
});

test('Runtime guard: enforces exactly what package.json "engines" declares', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.strictEqual(pkg.engines.node, SUPPORTED_NODE_RANGE);
});

test('Runtime guard: the Node.js running these tests is supported', () => {
  assert.strictEqual(unsupportedRuntimeReason(process.version), null);
});

test('Runtime guard: the server refuses to start on an unsupported Node.js, before reading anything', () => {
  const cli = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
  const pretendNode20 =
    "data:text/javascript,Object.defineProperty(process,'version',{value:'v20.20.2'})";
  const run = spawnSync(process.execPath, ['--import', pretendNode20, cli], {
    input: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.strictEqual(run.status, 1);
  assert.strictEqual(run.stdout, '', 'no JSON-RPC answer: the session never starts');
  assert.match(run.stderr, /\[FATAL\] Node\.js v20\.20\.2 is not supported/);
});
