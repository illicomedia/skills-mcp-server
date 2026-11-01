import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  bumpVersion,
  changelogHasVersion,
  nextDistTagAfterPromotion,
  parseReleaseArgs,
  smokeTestServer,
} from '../scripts/release-lib.mjs';

test('Release args: a publish needs nothing but accepts a bump, and the npm "--" separator is ignored', () => {
  assert.deepStrictEqual(parseReleaseArgs([]), { action: 'publish', dryRun: false, bump: null });
  assert.deepStrictEqual(parseReleaseArgs(['--', '--dry-run', '--bump', 'minor']), {
    action: 'publish',
    dryRun: true,
    bump: 'minor',
  });
});

test('Release args: promote and deprecate target one exact version', () => {
  assert.deepStrictEqual(parseReleaseArgs(['--promote', '1.5.0']), {
    action: 'promote',
    dryRun: false,
    version: '1.5.0',
  });
  assert.deepStrictEqual(
    parseReleaseArgs(['--deprecate', '1.5.0', '--message', 'Broken. Use 1.5.1.']),
    {
      action: 'deprecate',
      dryRun: false,
      version: '1.5.0',
      message: 'Broken. Use 1.5.1.',
    },
  );
});

test('Release args: ship is one action, with or without a bump', () => {
  assert.deepStrictEqual(parseReleaseArgs(['--ship']), {
    action: 'ship',
    dryRun: false,
    bump: null,
  });
  assert.deepStrictEqual(parseReleaseArgs(['--ship', '--bump', 'minor', '--dry-run']), {
    action: 'ship',
    dryRun: true,
    bump: 'minor',
  });
  assert.throws(() => parseReleaseArgs(['--ship', '--promote', '1.5.0']), /Choose one action/);
  assert.throws(() => parseReleaseArgs(['--ship', '--bump', 'huge']), /--bump expects/);
});

test('A release needs its changelog section', () => {
  assert.equal(changelogHasVersion('# Changelog\n\n## 1.5.0 - 2026-11-02\n', '1.5.0'), true);
  assert.equal(changelogHasVersion('## 1.5.0 - 2026-11-02\n', '1.5.1'), false);
  assert.equal(changelogHasVersion('## 1.5.01 - 2026-11-02\n', '1.5.0'), false);
});

test('Release args: smoke-only runs without the registry', () => {
  assert.deepStrictEqual(parseReleaseArgs(['--smoke-only']), { action: 'smoke', dryRun: false });
});

test('Release args: rejects removed lifecycle flags instead of ignoring them', () => {
  assert.throws(() => parseReleaseArgs(['--unpublish-older']), /Unknown option: --unpublish-older/);
  assert.throws(() => parseReleaseArgs(['--deprecate-only']), /Unknown option: --deprecate-only/);
});

test('Release args: rejects bad values and ambiguous actions', () => {
  assert.throws(() => parseReleaseArgs(['--bump', 'huge']), /--bump expects/);
  assert.throws(() => parseReleaseArgs(['--promote']), /--promote expects an exact version/);
  assert.throws(
    () => parseReleaseArgs(['--promote', '<1.5.0']),
    /--promote expects an exact version/,
  );
  assert.throws(
    () => parseReleaseArgs(['--deprecate', '<1.5.0', '--message', 'x']),
    /--deprecate expects an exact version/,
  );
  assert.throws(() => parseReleaseArgs(['--deprecate', '1.5.0']), /--deprecate needs --message/);
  assert.throws(
    () => parseReleaseArgs(['--message', 'x']),
    /--message only applies to --deprecate/,
  );
  assert.throws(() => parseReleaseArgs(['--promote', '1.5.0', '--smoke-only']), /one action/);
  assert.throws(
    () => parseReleaseArgs(['--promote', '1.5.0', '--bump', 'patch']),
    /--bump only applies to a publish/,
  );
});

test('bumpVersion: follows semantic versioning', () => {
  assert.strictEqual(bumpVersion('1.4.1', 'patch'), '1.4.2');
  assert.strictEqual(bumpVersion('1.4.1', 'minor'), '1.5.0');
  assert.strictEqual(bumpVersion('1.4.1', 'major'), '2.0.0');
  assert.throws(() => bumpVersion('1.4', 'patch'), /Cannot parse/);
});

test('nextDistTagAfterPromotion: next is dropped only when it points at the promoted version', () => {
  assert.strictEqual(nextDistTagAfterPromotion({ latest: '1.4.1', next: '1.5.0' }, '1.5.0'), true);
  assert.strictEqual(nextDistTagAfterPromotion({ latest: '1.5.0', next: '1.6.0' }, '1.4.1'), false);
  assert.strictEqual(nextDistTagAfterPromotion({ latest: '1.5.0' }, '1.4.1'), false);
});

function fakeServer(body: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-smoke-')), 'server.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}

const RESPONDER = (version: string, tools: string) => `
import * as readline from 'node:readline';
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line);
  const result = method === 'initialize'
    ? { serverInfo: { name: 'fake', version: '${version}' } }
    : { tools: ${tools} };
  console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
});`;

test('smokeTestServer: accepts a server that reports the release version and exposes tools', async () => {
  const bin = fakeServer(RESPONDER('1.5.0', '[{ name: "list_skills" }]'));
  assert.deepStrictEqual(await smokeTestServer(bin, '1.5.0'), { tools: 1 });
});

test('smokeTestServer: rejects a version mismatch', async () => {
  const bin = fakeServer(RESPONDER('1.4.1', '[{ name: "list_skills" }]'));
  await assert.rejects(smokeTestServer(bin, '1.5.0'), /reports version 1\.4\.1, expected 1\.5\.0/);
});

test('smokeTestServer: rejects a server without tools', async () => {
  const bin = fakeServer(RESPONDER('1.5.0', '[]'));
  await assert.rejects(smokeTestServer(bin, '1.5.0'), /exposes no tools/);
});

test('smokeTestServer: rejects a server that crashes on start', async () => {
  const bin = fakeServer("throw new Error('missing dist file');");
  await assert.rejects(smokeTestServer(bin, '1.5.0'), /exited/);
});

test('smokeTestServer: rejects a server that never answers', async () => {
  const bin = fakeServer('setInterval(() => {}, 1000);');
  await assert.rejects(smokeTestServer(bin, '1.5.0', 200), /no answer/);
});
