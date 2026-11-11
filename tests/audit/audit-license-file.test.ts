import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { runComplianceAudit } from '../../dist/audit/index.js';
import { expectCheck, makeProject } from '../helpers/audit-fixture.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-licfile-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const NAME = 'license file kept out of git';

function audit(files: Record<string, string>) {
  const dir = makeProject(root, Object.keys(files), (name) => files[name] ?? '');
  return runComplianceAudit(dir, { confirm: true });
}

test('license file: no check when the project has no .qa-license.json', () => {
  const report = audit({ '.gitignore': '.env\n' });
  assert.equal(
    report.results.find((r) => r.name === NAME),
    undefined,
  );
});

test('license file: a .qa-license.json that .gitignore does not ignore is a warning', () => {
  const report = audit({ '.qa-license.json': '{}', '.gitignore': '.env\n' });
  const check = expectCheck(report, NAME, { passed: false, severity: 'warning' });
  assert.match(check.details, /\.gitignore/);
  assert.match(check.details, /shares/i);
});

test('license file: a project without any .gitignore is a warning too', () => {
  expectCheck(audit({ '.qa-license.json': '{}' }), NAME, { passed: false });
});

for (const rule of [
  '.qa-license.json',
  '/.qa-license.json',
  '**/.qa-license.json',
  '.qa-license*',
  '.qa-license.*',
]) {
  test(`license file: ignored by the rule ${rule}`, () => {
    const report = audit({ '.qa-license.json': '{}', '.gitignore': `# keys\n${rule}\n` });
    expectCheck(report, NAME, { passed: true, severity: 'warning' });
  });
}

test('license file: a later negation puts it back in git', () => {
  const report = audit({
    '.qa-license.json': '{}',
    '.gitignore': '.qa-license.json\n!.qa-license.json\n',
  });
  expectCheck(report, NAME, { passed: false });
});

test('license file: unrelated rules do not count', () => {
  const report = audit({
    '.qa-license.json': '{}',
    '.gitignore': '.qa-exceptions.yaml\nlicense.json\n',
  });
  expectCheck(report, NAME, { passed: false });
});

test('license file: the check lowers readiness while it fails', () => {
  const report = audit({ '.qa-license.json': '{}', '.gitignore': '.env\n' });
  assert.equal(report.status, 'needs_attention');
});

test('license file: CRLF line endings, a BOM, trailing spaces and globs still count (as in git)', () => {
  for (const gitignore of [
    '.env\r\n.qa-license.json\r\n',
    '\uFEFF.qa-license.json\n',
    '.qa-license.json   \n',
    '.qa-license.json',
    '*.json\n',
    '.qa-*\n',
  ]) {
    expectCheck(audit({ '.qa-license.json': '{}', '.gitignore': gitignore }), NAME, {
      passed: true,
      context: JSON.stringify(gitignore),
    });
  }
});

test('license file: comments, leading or trailing tabs, mismatches and path rules do not count (as in git)', () => {
  for (const gitignore of [
    '#.qa-license.json\n',
    '# .qa-license.json\n',
    '.qa-license.jsonx\n',
    'x.qa-license.json\n',
    '.qa-license.json/\n',
    '/sub/.qa-license.json\n',
    '.QA-LICENSE.JSON\n',
    ' .qa-license.json\n',
    '\t.qa-license.json\n',
    '.qa-license.json\t\n',
    '\n\n   \n',
  ]) {
    expectCheck(audit({ '.qa-license.json': '{}', '.gitignore': gitignore }), NAME, {
      passed: false,
      context: JSON.stringify(gitignore),
    });
  }
});

test('license file: ignore, negate, ignore again ends up ignored', () => {
  const gitignore = '.qa-license.json\n!.qa-license.json\n.qa-license.json\n';
  expectCheck(audit({ '.qa-license.json': '{}', '.gitignore': gitignore }), NAME, { passed: true });
});

test('license file: a negation alone, or of a different rule, changes nothing', () => {
  expectCheck(audit({ '.qa-license.json': '{}', '.gitignore': '!.qa-license.json\n' }), NAME, {
    passed: false,
  });
  expectCheck(
    audit({ '.qa-license.json': '{}', '.gitignore': '.qa-license.json\n!.env\n!other.json\n' }),
    NAME,
    { passed: true },
  );
});

test('license file: a huge .gitignore is read in time', () => {
  const gitignore = `${'node_modules/\n'.repeat(200_000)}.qa-license.json\n`;
  const started = Date.now();
  expectCheck(audit({ '.qa-license.json': '{}', '.gitignore': gitignore }), NAME, { passed: true });
  assert.ok(Date.now() - started < 5000);
});

test('license file: a parent .gitignore is used when the project has none', () => {
  const parent = fs.mkdtempSync(path.join(root, 'parent-'));
  fs.writeFileSync(path.join(parent, '.gitignore'), '.qa-license.json\n');
  fs.mkdirSync(path.join(parent, '.git'));
  const child = path.join(parent, 'child');
  fs.mkdirSync(child);
  fs.writeFileSync(path.join(child, '.qa-license.json'), '{}');
  const report = runComplianceAudit(child, { confirm: true });
  expectCheck(report, NAME, { passed: true });
});

test('license file: the license content is never read or echoed by the audit', () => {
  const secret = 'SECRET-LICENSE-BODY';
  const report = audit({ '.qa-license.json': `{"licensee":"${secret}"}`, '.gitignore': '' });
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test('license file: an empty file, a directory or a symlink with that name is still checked once', () => {
  const emptyFile = audit({ '.qa-license.json': '' });
  assert.equal(emptyFile.results.filter((r) => r.name === NAME).length, 1);

  const dir = makeProject(root, ['.qa-license.json/keep']);
  const asDirectory = runComplianceAudit(dir, { confirm: true });
  assert.ok(asDirectory.results.filter((r) => r.name === NAME).length <= 1);

  const linked = makeProject(root, ['real.json', '.gitignore'], (n) =>
    n === '.gitignore' ? '.qa-license.json\n' : '{}',
  );
  fs.symlinkSync(path.join(linked, 'real.json'), path.join(linked, '.qa-license.json'));
  const report = runComplianceAudit(linked, { confirm: true });
  const checks = report.results.filter((r) => r.name === NAME);
  assert.equal(checks.length, 1);
});

test('license file: the check counts in the totals and the score', () => {
  const without = audit({ '.gitignore': '.env\n' });
  const failing = audit({ '.qa-license.json': '{}', '.gitignore': '.env\n' });
  const passing = audit({ '.qa-license.json': '{}', '.gitignore': '.env\n.qa-license.json\n' });
  assert.equal(failing.totalChecks, without.totalChecks + 1);
  assert.equal(failing.failedChecks, without.failedChecks + 1);
  assert.equal(passing.totalChecks, without.totalChecks + 1);
  assert.equal(passing.failedChecks, without.failedChecks);
  assert.ok(failing.score <= passing.score);
});

test('license file: the unconfirmed preview scans nothing, so it reports nothing', () => {
  const dir = makeProject(root, ['.qa-license.json']);
  const preview = runComplianceAudit(dir);
  assert.equal(preview.results.length, 0);
  assert.equal(preview.previewOnly, true);
});

test('license file: summary lists the failing check under attention with its severity', () => {
  const report = audit({ '.qa-license.json': '{}', '.gitignore': '.env\n' });
  assert.ok(
    report.summary.attention.some((line) => line.includes('[warning]') && line.includes(NAME)),
  );
  const ok = audit({ '.qa-license.json': '{}', '.gitignore': '.qa-license.json\n' });
  assert.ok(ok.summary.ok.some((line) => line.includes(NAME)));
});
