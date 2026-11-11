import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { runComplianceAudit } from '../../dist/audit/index.js';
import { loadSkillContent, SkillNotInstalledError } from '../../dist/skills/catalog.js';
import { runModuleInChild } from '../helpers/child.ts';
import { auditCheckPassed, repo, writeFiles } from '../helpers/git-fixture.ts';
import { distFile } from '../helpers/paths.ts';

describe('security › project-file-reads', () => {
  /**
   * Project files are hostile too: a repository can hold a named pipe, a link to an endless device
   * or a huge file where the server expects .gitignore, package.json, AGENTS.md or SKILL.md.
   * The server must neither hang nor run out of memory, and must not trust what it cannot read.
   */

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-project-reads-'));
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  const posix = process.platform !== 'win32';
  const MiB = 1024 * 1024;
  const ENV_CHECK = '.gitignore mentions .env';

  const dist = (rel: string): string => JSON.stringify(distFile(rel));

  for (const name of [
    '.gitignore',
    'package.json',
    'AGENTS.md',
    'Makefile',
    '.qa-exceptions.yaml',
  ]) {
    test(`quick_check: a named pipe as ${name} cannot hang the audit`, {
      skip: !posix,
      timeout: 60_000,
    }, async () => {
      const dir = fs.mkdtempSync(path.join(root, 'fifo-'));
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      fs.rmSync(path.join(dir, name), { force: true });
      execFileSync('mkfifo', [path.join(dir, name)]);
      const { done, out, err } = await runModuleInChild(`
      import { runComplianceAudit } from ${dist('audit/index.js')};
      const r = runComplianceAudit(${JSON.stringify(dir)}, { confirm: true });
      console.log('checks', r.results.length);
    `);
      assert.equal(done, true, `the audit blocked on ${name}`);
      assert.match(out, /^checks \d+/, err);
    });

    test(`quick_check: ${name} linked to /dev/zero cannot exhaust memory`, {
      skip: !posix,
      timeout: 60_000,
    }, async () => {
      const dir = fs.mkdtempSync(path.join(root, 'zero-'));
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      fs.rmSync(path.join(dir, name), { force: true });
      fs.symlinkSync('/dev/zero', path.join(dir, name));
      const { done, out, err } = await runModuleInChild(`
      import { runComplianceAudit } from ${dist('audit/index.js')};
      const r = runComplianceAudit(${JSON.stringify(dir)}, { confirm: true });
      console.log('checks', r.results.length);
    `);
      assert.equal(done, true, `the audit kept reading ${name}`);
      assert.match(out, /^checks \d+/, err);
    });
  }

  test('skills: a named pipe as SKILL.md or LICENSE cannot hang an install', {
    skip: !posix,
    timeout: 60_000,
  }, async () => {
    const dir = fs.mkdtempSync(path.join(root, 'skill-fifo-'));
    fs.mkdirSync(path.join(dir, 'skills', 'qa-core'), { recursive: true });
    execFileSync('mkfifo', [path.join(dir, 'skills', 'qa-core', 'SKILL.md')]);
    const other = fs.mkdtempSync(path.join(root, 'license-fifo-'));
    writeFiles(other, { 'skills/qa-core/SKILL.md': '# qa-core\n' });
    execFileSync('mkfifo', [path.join(other, 'LICENSE')]);
    const { done, out, err } = await runModuleInChild(`
    import { installSkill } from ${dist('skills/installer.js')};
    const a = installSkill('qa-core', ${JSON.stringify(dir)}, undefined, { confirm: true });
    const b = installSkill('qa-core', ${JSON.stringify(other)}, undefined, { confirm: true });
    console.log('done', a.success, b.success);
  `);
    assert.equal(done, true, 'an install blocked on a named pipe');
    assert.match(out, /^done false true/, err);
  });

  test('quick_check: a .gitignore over 1 MiB is not trusted (fail closed), up to 1 MiB it is read', () => {
    const rules = '.env\n';
    for (const [size, expected] of [
      [MiB, true],
      [MiB + 1, false],
    ] as const) {
      const dir = repo();
      writeFiles(dir, { '.env': 'S=1', '.gitignore': rules + '#'.repeat(size - rules.length) });
      assert.equal(fs.statSync(path.join(dir, '.gitignore')).size, size);
      assert.equal(auditCheckPassed(dir, ENV_CHECK), expected, `size ${size}`);
    }
  });

  test('quick_check: a huge package.json is not parsed, the audit still completes', () => {
    const dir = fs.mkdtempSync(path.join(root, 'big-pkg-'));
    fs.writeFileSync(path.join(dir, 'package.json'), `{"name":"x","pad":"${'x'.repeat(2 * MiB)}"}`);
    const report = runComplianceAudit(dir, { confirm: true });
    assert.ok(report.results.length > 0);
  });

  test('skills: a SKILL.md over 1 MiB is not served; up to 1 MiB it is', () => {
    for (const [size, served] of [
      [MiB, true],
      [MiB + 1, false],
    ] as const) {
      const dir = fs.mkdtempSync(path.join(root, 'big-skill-'));
      writeFiles(dir, { 'skills/qa-core/SKILL.md': `# qa-core\n${'x'.repeat(size - 10)}` });
      if (served) {
        assert.equal(loadSkillContent('qa-core', dir).length, size);
      } else {
        assert.throws(() => loadSkillContent('qa-core', dir), SkillNotInstalledError);
      }
    }
  });
});
