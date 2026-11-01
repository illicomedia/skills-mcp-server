// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import {
  createAuditContext,
  LANGUAGE_RULES,
  resolveLanguageRule,
  runComplianceAudit,
} from '../dist/audit/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-rules-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

/** A throwaway project: names ending in / are directories. */
function project(...names: string[]): string {
  const dir = fs.mkdtempSync(path.join(root, 'p-'));
  for (const name of names) {
    const full = path.join(dir, name);
    if (name.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, name === 'Makefile' ? 'test:\n\ttrue\n' : '');
    }
  }
  return dir;
}

function rule(id: string) {
  const found = LANGUAGE_RULES.find((candidate) => candidate.id === id);
  assert.ok(found, id);
  return found;
}

const passing: [
  string,
  'getQaScript' | 'getTypeCheck' | 'getTestSuite' | 'getLockfile',
  string[],
][] = [
  ['php', 'getQaScript', ['composer.json', 'Makefile']],
  ['php', 'getTypeCheck', ['phpstan.neon', 'phpstan.neon.dist', 'psalm.xml']],
  ['php', 'getTestSuite', ['phpunit.xml', 'phpunit.xml.dist', 'pest.php', 'tests/']],
  ['php', 'getLockfile', ['composer.lock']],
  ['python', 'getQaScript', ['pyproject.toml', 'tox.ini']],
  ['python', 'getTypeCheck', ['mypy.ini', 'pyproject.toml']],
  ['python', 'getTestSuite', ['pytest.ini', 'tox.ini', 'setup.cfg', 'tests/', 'test/']],
  [
    'python',
    'getLockfile',
    ['poetry.lock', 'Pipfile.lock', 'uv.lock', 'pdm.lock', 'requirements.lock'],
  ],
  ['bash', 'getQaScript', ['Makefile', 'scripts/qa.sh']],
  ['bash', 'getTypeCheck', ['.shellcheckrc', 'Makefile']],
  ['cpp', 'getQaScript', ['Makefile', 'CMakeLists.txt']],
  ['cpp', 'getTestSuite', ['CTestTestfile.cmake', 'tests/', 'test/', 'Makefile']],
  ['java', 'getTestSuite', ['pom.xml', 'build.gradle', 'src/test/', 'tests/']],
  ['java', 'getLockfile', ['pom.xml', 'gradle.lockfile', 'build.gradle']],
  ['go', 'getLockfile', ['go.sum']],
  ['rust', 'getLockfile', ['Cargo.lock']],
  ['makefile', 'getTestSuite', ['tests/', 'test/', 'scripts/test.sh', 'Makefile']],
];

for (const [id, method, markers] of passing) {
  test(`${id} ${method}: any one marker passes, none fails`, () => {
    for (const marker of markers) {
      const result = rule(id)[method](createAuditContext(project(marker)));
      assert.equal(result.passed, true, marker);
      assert.ok(result.details.length > 0);
    }
    const empty = rule(id)[method](createAuditContext(project()));
    assert.equal(empty.passed, false);
    assert.ok(empty.details.length > 0);
  });
}

test('cpp lockfile: only a conanfile without a lock fails', () => {
  const cpp = rule('cpp');
  assert.equal(cpp.getLockfile(createAuditContext(project())).passed, true);
  assert.equal(cpp.getLockfile(createAuditContext(project('conanfile.txt'))).passed, false);
  for (const marker of ['conan.lock', 'vcpkg.json', 'CPM.cmake']) {
    assert.equal(
      cpp.getLockfile(createAuditContext(project('conanfile.txt', marker))).passed,
      true,
      marker,
    );
  }
});

test('python and fallback rules: always-true checks and static names', () => {
  const ctx = createAuditContext(project());
  assert.equal(rule('python').getQaScript(ctx).name, 'qa:starter / python quality gates declared');
  assert.equal(rule('makefile').getQaScript(ctx).passed, true);
  assert.equal(rule('makefile').getTypeCheck(ctx).passed, true);
  assert.equal(rule('makefile').getLockfile(ctx).passed, true);
  assert.equal(rule('makefile').getLockfile(ctx).severity, 'info');
  assert.equal(rule('makefile').getTestSuite(createAuditContext(project('src/'))).passed, false);
  const noTarget = project('Makefile');
  fs.writeFileSync(path.join(noTarget, 'Makefile'), 'build:\n\ttrue\n');
  assert.equal(rule('makefile').getTestSuite(createAuditContext(noTarget)).passed, false);
});

test('resolveLanguageRule: the most specific match, else the default rule', () => {
  assert.equal(resolveLanguageRule(createAuditContext(project('go.mod'))).id, 'go');
  assert.equal(resolveLanguageRule(createAuditContext(project())).id, 'default');
});

test('context: reads tolerate directories, missing paths and unreadable folders', () => {
  const dir = project('a/b.txt', 'file.txt', 'locked/inner.txt');
  const ctx = createAuditContext(dir);
  assert.equal(ctx.readFile('a'), null);
  assert.deepEqual(ctx.readDir('file.txt'), []);
  assert.deepEqual(ctx.readDir('missing'), []);
  assert.deepEqual(ctx.readDir('a'), ['b.txt']);

  const child = path.join(dir, 'child');
  fs.mkdirSync(child);
  fs.mkdirSync(path.join(dir, 'parent-dir.txt'));
  const nested = createAuditContext(child);
  assert.equal(nested.readParentFile('parent-dir.txt'), null, 'a folder cannot be read');
  assert.equal(nested.parentFileExists('file.txt'), true);
  assert.equal(nested.parentFileExists('no-such-file-anywhere.txt'), false);

  fs.chmodSync(path.join(dir, 'locked'), 0o000);
  try {
    assert.deepEqual(
      ctx.findFiles(3, (rel) => rel.endsWith('inner.txt')),
      [],
    );
  } finally {
    fs.chmodSync(path.join(dir, 'locked'), 0o755);
  }
});

test('context: stops at the repository root, and tolerates a project that is not there', () => {
  const repo = project('.git/', 'shared.txt');
  const inner = path.join(repo, 'pkg');
  fs.mkdirSync(inner);
  assert.equal(createAuditContext(inner).parentFileExists('shared.txt'), true);
  assert.equal(createAuditContext(path.join(repo, 'pkg')).findUp('not-found-file'), null);

  const asFile = project('src');
  assert.equal(createAuditContext(asFile).stack.isPhp, false, 'src is a file here');
  const missing = createAuditContext(path.join(root, 'no-such-project'));
  assert.equal(missing.stack.isBash, false);
});

test('audit: a workflow path that is a file, and an exception file that is a folder', () => {
  const file = project('.github/workflows');
  const report = runComplianceAudit(file, { confirm: true });
  assert.ok(report.totalChecks > 0);

  const folder = project('.qa-exceptions.yaml/');
  const withFolder = runComplianceAudit(folder, { confirm: true });
  assert.ok(withFolder.totalChecks > 0);
});
