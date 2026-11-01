// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import * as assert from 'node:assert/strict';
import fsModule, * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, mock, test } from 'node:test';
import { createAuditContext, LANGUAGE_RULES, runComplianceAudit } from '../dist/audit/index.js';
import { validateLicense } from '../dist/license/license.js';
import { getCommercialLicenseText, resolveSkillLicense } from '../dist/license/templates.js';
import { validateSafeProjectPath, validateSafeWriteTarget } from '../dist/security/path-guard.js';
import { ToolExecutor } from '../dist/server/executor.js';
import { FredoQaMcpServer, MAX_REQUEST_BYTES } from '../dist/server/server.js';
import { findSkill, loadSkillContent } from '../dist/skills/catalog.js';
import {
  detectProjectSkills,
  installSkill,
  pruneSkills,
  syncWorkspaceSkills,
} from '../dist/skills/installer.js';
import { smokeTestServer } from '../scripts/release-lib.mjs';
import { signedLicense, TEST_LICENSE_OPTIONS } from './license-fixture.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-edge-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function project(...names: string[]): string {
  const dir = fs.mkdtempSync(path.join(root, 'p-'));
  for (const name of names) {
    const full = path.join(dir, name);
    if (name.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
  }
  return dir;
}

function rule(id: string) {
  const found = LANGUAGE_RULES.find((candidate) => candidate.id === id);
  assert.ok(found, id);
  return found;
}

test('context and rules: shell at the root, YAML workflows, default tests, no package.json', () => {
  assert.equal(createAuditContext(project('run.sh')).stack.isBash, true);
  assert.ok(
    runComplianceAudit(project('.github/workflows/ci.yaml'), { confirm: true }).totalChecks > 0,
  );
  assert.equal(rule('default').getTestSuite(createAuditContext(project('tests/'))).passed, true);
  assert.equal(rule('node').getQaScript(createAuditContext(project())).passed, false);
});

test('loadSkillContent: an unreadable candidate falls through to "not installed"', () => {
  const dir = project('skills/free/qa-core/SKILL.md/');
  assert.throws(() => loadSkillContent('qa-core', dir), /not installed|SKILL\.md/i);
});

test('installSkill: refuses a bad project and a symlink escape, without writing', () => {
  assert.match(installSkill('qa-core', path.join(root, 'absent')).message, /Failed to install/);

  const dir = project('skills/free/qa-core/SKILL.md');
  const outside = project();
  fs.symlinkSync(outside, path.join(dir, '.agents'));
  const result = installSkill('qa-core', dir, undefined, { confirm: true });
  assert.equal(result.success, false);
  assert.match(result.message, /Security restriction/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('installSkill: a write failure is reported', () => {
  const dir = project('skills/free/qa-core/SKILL.md', '.agents');
  const result = installSkill('qa-core', dir, undefined, { confirm: true });
  assert.equal(result.success, false);
  assert.match(result.message, /Failed to install/);
});

test('detectProjectSkills: well-known and DNS projects', () => {
  assert.ok(detectProjectSkills(project('.well-known/')).includes('qa-well-known'));
  for (const marker of ['dns/', 'infra/dns/', 'scripts/deploy-ovh.js']) {
    assert.ok(detectProjectSkills(project(marker)).includes('qa-emails-dns'), marker);
  }
});

test('syncWorkspaceSkills: reads the license itself, and reports skills it cannot install', () => {
  const dir = project();
  assert.ok(syncWorkspaceSkills(dir).summaryMessage.length > 0);
  assert.ok(
    syncWorkspaceSkills(dir, []).summaryMessage.length > 0,
    'an empty list means detection',
  );

  const requested = syncWorkspaceSkills(project('skills/free/qa-core/SKILL.md'), [
    'qa-core',
    'qa-security',
    'no-such-skill',
  ]);
  assert.ok(requested.summaryMessage.includes('qa-core'));
  assert.ok(requested.summaryMessage.includes('qa-security'));
  assert.ok(requested.summaryMessage.includes('no-such-skill'));
});

test('pruneSkills: nothing installed, unreadable folder, and symlinked skills', () => {
  const empty = pruneSkills(project());
  assert.equal(empty.success, true);
  assert.match(empty.summaryMessage, /Nothing to do/);

  const broken = pruneSkills(project('.agents/skills'));
  assert.equal(broken.success, false);
  assert.match(broken.summaryMessage, /Failed to read/);

  const dir = project('.agents/skills/plain/SKILL.md');
  const target = project('SKILL.md');
  fs.symlinkSync(target, path.join(dir, '.agents/skills/linked'));
  fs.symlinkSync('/etc', path.join(dir, '.agents/skills/refused'));
  fs.symlinkSync(path.join(dir, 'gone'), path.join(dir, '.agents/skills/dangling'));
  const preview = pruneSkills(dir);
  assert.ok(preview.archivedSkills.includes('linked'));
  assert.ok(
    !preview.archivedSkills.includes('refused'),
    'a link to a system folder is not touched',
  );
  assert.ok(!preview.archivedSkills.includes('dangling'));
});

test('pruneSkills: a known skill folder counts, and archive failures are reported', () => {
  const dir = project('.agents/skills/qa-security/', '.agents/.archive');
  const refused = pruneSkills(dir, { confirm: true });
  assert.equal(refused.success, false);
  assert.ok(refused.summaryMessage.length > 0);
});

test('pruneSkills: replaces an older archive, copies when a move fails, reports what it cannot do', () => {
  const again = project('.agents/skills/old/SKILL.md', '.agents/.archive/old/SKILL.md');
  assert.deepEqual(pruneSkills(again, { confirm: true }).archivedSkills, ['old']);

  const crossDevice = project('.agents/skills/old/SKILL.md');
  const rename = mock.method(fsModule, 'renameSync', () => {
    throw new Error('EXDEV');
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(pruneSkills(crossDevice, { confirm: true }).archivedSkills, ['old']);
    assert.equal(fs.existsSync(path.join(crossDevice, '.agents/skills/old')), false);

    const stuck = project('.agents/skills/old/SKILL.md', '.agents/.archive/');
    fs.chmodSync(path.join(stuck, '.agents/.archive'), 0o555);
    try {
      const result = pruneSkills(stuck, { confirm: true });
      assert.deepEqual(result.archivedSkills, []);
      assert.match(result.summaryMessage, /old/);
    } finally {
      fs.chmodSync(path.join(stuck, '.agents/.archive'), 0o755);
    }
  } finally {
    rename.mock.restore();
    syncBuiltinESMExports();
  }
});

test('license text: placeholders when the license carries no detail', () => {
  const meta = findSkill('qa-security');
  assert.ok(meta);
  const text = getCommercialLicenseText(meta, {} as never);
  assert.match(text, /Licensed Organization/);
  assert.match(text, /License: unknown/);
  assert.match(text, /Updates Until: unknown/);
  assert.ok(
    resolveSkillLicense(meta, {} as never).length > 0,
    'searches from the working directory',
  );
});

test('validateLicense: uses the release date of this build by default', () => {
  const { releaseDate: _ignored, ...options } = TEST_LICENSE_OPTIONS;
  assert.equal(typeof validateLicense(signedLicense(), options).tier, 'string');
});

test('security guard: bad input, files, and symlinks that leave the project', () => {
  assert.throws(() => validateSafeProjectPath('', 'op'), /non-empty string/);
  assert.throws(() => validateSafeProjectPath(7 as never, 'op'), /non-empty string/);
  const file = path.join(project('file.txt'), 'file.txt');
  assert.throws(() => validateSafeProjectPath(file, 'op'), /not a directory/);

  const dir = project('real/');
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'inside'));
  fs.symlinkSync(project(), path.join(dir, 'outside'));
  validateSafeWriteTarget(dir, path.join(dir, 'inside', 'x'));
  assert.throws(
    () => validateSafeWriteTarget(dir, path.join(dir, 'outside', 'x')),
    /Security restriction/,
  );
  validateSafeWriteTarget(path.parse(dir).root, dir);
});

test('tools/call works without arguments', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const response = server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_version' },
  });
  assert.equal(response.error, undefined);
});

test('tools: license tools report valid, invalid and empty licenses', () => {
  const run = (name: string, args: Record<string, unknown> = {}, key?: string) =>
    JSON.parse(ToolExecutor.execute(name, args, key, () => undefined, TEST_LICENSE_OPTIONS));

  const valid = run('set_license_key', { license_key: signedLicense({ licensee: 'Fred V.' }) });
  assert.equal(valid.status, 'AUTHENTICATED');
  assert.equal(valid.customer, 'Fred V.');
  assert.equal(typeof valid.licenseId, 'string');

  const invalid = run('set_license_key', { license_key: 'not-a-license' });
  assert.equal(invalid.status, 'FREE_TIER_FALLBACK');
  assert.equal(invalid.customer, 'Community User');
  assert.equal(invalid.licenseId, null);
  assert.equal(invalid.updatesUntil, null);

  assert.equal(run('verify_license', { license_key: signedLicense() }).status, 'ACTIVE');
  assert.equal(run('verify_license').status, 'FREE_TIER');
});

test('tools: project tools use the given folder, or the working directory', () => {
  const run = (args: Record<string, unknown>) =>
    ToolExecutor.execute('prune_skills', args, undefined, () => undefined, TEST_LICENSE_OPTIONS);
  assert.match(run({ project_path: project() }), /Nothing to do/);
  assert.ok(run({}).length > 0);
});

test('pruneSkills: stray files are not skills', () => {
  const dir = project('.agents/skills/notes.txt', '.agents/skills/old/SKILL.md');
  assert.deepEqual(pruneSkills(dir).archivedSkills, ['old']);
});

test('stdio lines: size limit, blank lines, notifications, bad JSON, requests', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const tooLong = JSON.parse(String(server.handleLine('x'.repeat(MAX_REQUEST_BYTES + 1))));
  assert.equal(tooLong.error.code, -32700);
  assert.match(tooLong.error.message, /maximum allowed size/);
  assert.equal(server.handleLine('   '), null);
  assert.equal(server.handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}'), null);
  assert.match(String(server.handleLine('{oops')), /Parse error/);
  assert.equal(
    JSON.parse(String(server.handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}'))).id,
    1,
  );
});

function fakeServer(body: string): string {
  const file = path.join(fs.mkdtempSync(path.join(root, 'smoke-')), 'server.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}

test('smoke test: ignores log lines, refuses a missing tool list, reports a binary that cannot start', async () => {
  const noise = fakeServer(`
import * as readline from 'node:readline';
console.log('starting up');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id } = JSON.parse(line);
  console.log(JSON.stringify({ id, result: id === 1 ? { serverInfo: { version: '9.9.9' } } : {} }));
});`);
  await assert.rejects(smokeTestServer(noise, '9.9.9'), /no tools/);
  await assert.rejects(smokeTestServer(path.join(root, 'absent-binary'), '9.9.9'), /ENOENT/);

  const hangsUp = fakeServer(`
import * as readline from 'node:readline';
readline.createInterface({ input: process.stdin }).once('line', () => {
  console.log(JSON.stringify({ id: 1, result: { serverInfo: { version: '9.9.9' } } }));
  process.stdin.destroy();
  setTimeout(() => process.exit(0), 600);
});`);
  await assert.rejects(smokeTestServer(hangsUp, '9.9.9', 2000), /EPIPE|exited early|no answer/);

  const closed = path.join(fs.mkdtempSync(path.join(root, 'smoke-')), 'server.sh');
  fs.writeFileSync(closed, '#!/bin/sh\nexec 0<&-\nsleep 0.3\n', { mode: 0o755 });
  await assert.rejects(smokeTestServer(closed, '9.9.9', 2000), /EPIPE|exited early|no answer/);
});
