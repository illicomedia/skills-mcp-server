import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { runComplianceAudit } from '../dist/audit/index.js';
import { expectCheck, makeProject } from './audit-fixture.ts';

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
