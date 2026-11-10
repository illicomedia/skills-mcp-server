import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { runComplianceAudit } from '../dist/audit/index.js';

/**
 * Differential test: the audit's reading of .gitignore is checked against git itself.
 * The audit may warn when git would ignore the file (fail closed), but it must never say
 * "ignored" when git would commit the file.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-gitdiff-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const NAME = 'license file kept out of git';
const gitAvailable = spawnSync('git', ['--version']).status === 0;
const emptyConfig = path.join(root, 'empty-gitconfig');
fs.writeFileSync(emptyConfig, '');

function git(cwd: string, args: string[], ignoreCase: boolean): number | null {
  return spawnSync(
    'git',
    ['-c', `core.ignorecase=${ignoreCase}`, '-c', `core.excludesFile=${emptyConfig}`, ...args],
    {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' },
    },
  ).status;
}

let counter = 0;
function repo(): string {
  counter += 1;
  const dir = path.join(root, `r${counter}`);
  fs.mkdirSync(dir);
  assert.equal(git(dir, ['init', '-q', '.'], false), 0);
  return dir;
}

function auditSays(project: string): boolean {
  const check = runComplianceAudit(project, { confirm: true }).results.find((r) => r.name === NAME);
  assert.ok(check);
  return check.passed;
}

/** [gitignore content, does the audit have to agree exactly with git?] */
const OWN: [string, boolean][] = [
  ['.qa-license.json\n', true],
  [' .qa-license.json\n', true],
  ['\t.qa-license.json\n', true],
  ['.qa-license.json   \n', true],
  ['.qa-license.json\t\n', true],
  ['.qa-license.json\r\n', true],
  ['\uFEFF.qa-license.json\n', true],
  ['.qa-license.json', true],
  ['.QA-LICENSE.JSON\n', false],
  ['*.json\n', true],
  ['.qa-*\n', true],
  ['?qa-license.json\n', true],
  ['.qa-license.js?n\n', true],
  ['*\n', true],
  ['**\n', true],
  ['**/.qa-license.json\n', true],
  ['/**/.qa-license.json\n', true],
  ['/.qa-license.json\n', true],
  ['/*.json\n', true],
  ['.qa-license.json/\n', true],
  ['.qa-license.json\\ \n', false],
  ['#.qa-license.json\n', true],
  ['\\#.qa-license.json\n', false],
  ['\\!.qa-license.json\n', false],
  ['x/.qa-license.json\n', true],
  ['*/.qa-license.json\n', true],
  ['[.]qa-license.json\n', false],
  ['.qa-license.json\n!.qa-license.json\n', true],
  ['.qa-license.json\n!*.json\n', true],
  ['*.json\n!.qa-license.json\n', true],
  ['.qa-license.json\n!/.qa-license.json\n', true],
  ['.qa-license.json\n!**/.qa-license.json\n', true],
  ['.qa-license.json\n!.QA-LICENSE.JSON\n', false],
  ['.qa-license.json\n!sub/../.qa-license.json\n', false],
  ['.qa-license.json\n!.qa-license.jso[n]\n', false],
  ['.qa-license.json\n!.qa-license.json/\n', true],
  ['.qa-license.json\n!\n', true],
  ['.qa-license.json\n#!.qa-license.json\n', true],
  ['.qa-license.json\n!.qa-license.json\n.qa-license.json\n', true],
  ['\n\n   \n', true],
  ['', true],
];

/** Rules in the repository root's .gitignore, the audited project being a sub-folder. */
const PARENT: [string, boolean][] = [
  ['.qa-license.json\n', true],
  ['/.qa-license.json\n', true],
  ['**/.qa-license.json\n', true],
  ['/**/.qa-license.json\n', true],
  ['child/.qa-license.json\n', false],
  ['*.json\n', true],
  ['/*.json\n', true],
  ['.qa-license.json\n!/.qa-license.json\n', true],
  ['.qa-license.json\n!child/.qa-license.json\n', false],
  ['.qa-license.json\n!*.json\n', true],
];

for (const ignoreCase of [false, true]) {
  for (const [content, exact] of OWN) {
    test(`gitignore vs git (own, ignorecase=${ignoreCase}): ${JSON.stringify(content)}`, {
      skip: !gitAvailable,
    }, () => {
      const dir = repo();
      fs.writeFileSync(path.join(dir, '.qa-license.json'), '{}');
      fs.writeFileSync(path.join(dir, '.gitignore'), content);
      const gitIgnores = git(dir, ['check-ignore', '-q', '.qa-license.json'], ignoreCase) === 0;
      const ours = auditSays(dir);
      assert.ok(!(ours && !gitIgnores), 'audit says ignored but git would commit the file');
      if (exact && !ignoreCase) {
        assert.equal(ours, gitIgnores);
      }
    });
  }

  for (const [content, exact] of PARENT) {
    test(`gitignore vs git (parent, ignorecase=${ignoreCase}): ${JSON.stringify(content)}`, {
      skip: !gitAvailable,
    }, () => {
      const top = repo();
      const child = path.join(top, 'child');
      fs.mkdirSync(child);
      fs.writeFileSync(path.join(child, '.qa-license.json'), '{}');
      fs.writeFileSync(path.join(top, '.gitignore'), content);
      const gitIgnores =
        git(top, ['check-ignore', '-q', 'child/.qa-license.json'], ignoreCase) === 0;
      const ours = auditSays(child);
      assert.ok(!(ours && !gitIgnores), 'audit says ignored but git would commit the file');
      if (exact && !ignoreCase) {
        assert.equal(ours, gitIgnores);
      }
    });
  }
}
