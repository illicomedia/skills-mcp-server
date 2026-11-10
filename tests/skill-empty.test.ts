import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { FredoQaMcpServer } from '../dist/server/server.js';
import {
  loadSkillContent,
  SkillFileEmptyError,
  SkillNotInstalledError,
} from '../dist/skills/catalog.js';
import { installSkill, syncWorkspaceSkills } from '../dist/skills/installer.js';
import { TEST_LICENSE_OPTIONS } from './license-fixture.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-empty-skill-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(root, 'p-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const installedCore = (dir: string): string =>
  fs.readFileSync(path.join(dir, '.agents/skills/qa-core/SKILL.md'), 'utf8');

const EMPTY_VARIANTS: Record<string, string> = {
  'zero bytes': '',
  spaces: '    ',
  newline: '\n',
  'CRLF lines': '\r\n\r\n',
  tabs: '\t\t\n',
  'byte order mark only': '\uFEFF',
  'byte order mark and blank': '\uFEFF \n',
  'non-breaking spaces': '\u00A0\u00A0',
};

for (const [label, content] of Object.entries(EMPTY_VARIANTS)) {
  test(`loadSkillContent: a SKILL.md of ${label} is refused`, () => {
    const dir = project({ '.agents/skills/qa-core/SKILL.md': content });
    assert.throws(
      () => loadSkillContent('qa-core', dir),
      (error: unknown) =>
        error instanceof SkillFileEmptyError &&
        error.message.includes('.agents/skills/qa-core/SKILL.md') &&
        error.message.includes('qa-core') &&
        error.skillId === 'qa-core',
    );
  });
}

test('loadSkillContent: a one-character SKILL.md, even "0", is real content', () => {
  for (const content of ['x', '0', '#', 'false']) {
    const dir = project({ 'skills/qa-core/SKILL.md': content });
    assert.equal(loadSkillContent('qa-core', dir), content);
  }
});

test('loadSkillContent: content is returned untouched, blank edges included', () => {
  const dir = project({ 'skills/qa-core/SKILL.md': '\n# Title\n\nbody\n\n' });
  assert.equal(loadSkillContent('qa-core', dir), '\n# Title\n\nbody\n\n');
});

test('loadSkillContent: an empty file earlier in the search order does not hide a real one', () => {
  const dir = project({
    'skills/free/qa-core/SKILL.md': '',
    'skills/qa-core/SKILL.md': '   ',
    '.agents/skills/qa-core/SKILL.md': '# real\n',
  });
  assert.equal(loadSkillContent('qa-core', dir), '# real\n');
});

test('loadSkillContent: when every candidate is empty the error names the first empty one', () => {
  const dir = project({
    'skills/free/qa-core/SKILL.md': '',
    '.agents/skills/qa-core/SKILL.md': '',
  });
  try {
    loadSkillContent('qa-core', dir);
    assert.fail('expected an error');
  } catch (error) {
    assert.ok(error instanceof SkillFileEmptyError);
    assert.ok(error.message.includes(path.join(dir, 'skills', 'free', 'qa-core', 'SKILL.md')));
    assert.match(error.message, /illicomedia\.com\/qa-skills\/skills\/qa-core/);
    assert.equal(error instanceof SkillNotInstalledError, false);
  }
});

test('loadSkillContent: no file at all is still "not installed", not "empty"', () => {
  assert.throws(() => loadSkillContent('qa-core', project({})), SkillNotInstalledError);
});

test('loadSkillContent: a SKILL.md that is a directory is not installed, not empty', () => {
  const dir = project({ 'skills/qa-core/SKILL.md/keep': 'x' });
  assert.throws(() => loadSkillContent('qa-core', dir), SkillNotInstalledError);
});

test('loadSkillContent: a symlink to an empty file is empty, to a real file is real', () => {
  const dir = project({ 'real.md': '# linked\n', 'blank.md': '' });
  fs.mkdirSync(path.join(dir, 'skills', 'qa-core'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'blank.md'), path.join(dir, 'skills', 'qa-core', 'SKILL.md'));
  assert.throws(() => loadSkillContent('qa-core', dir), SkillFileEmptyError);
  fs.rmSync(path.join(dir, 'skills', 'qa-core', 'SKILL.md'));
  fs.symlinkSync(path.join(dir, 'real.md'), path.join(dir, 'skills', 'qa-core', 'SKILL.md'));
  assert.equal(loadSkillContent('qa-core', dir), '# linked\n');
});

test('loadSkillContent: an unknown skill is still unknown', () => {
  assert.throws(() => loadSkillContent('nope', project({})), /Unknown skill/);
});

test('installSkill: an empty source fails for preview and for confirm, and writes nothing', () => {
  for (const confirm of [false, true]) {
    const dir = project({ 'skills/qa-core/SKILL.md': ' \n' });
    const res = installSkill('qa-core', dir, undefined, { confirm });
    assert.equal(res.success, false, `confirm=${confirm}`);
    assert.equal(res.requiresAuth, undefined);
    assert.deepEqual(res.installedFiles, []);
    assert.match(res.message, /empty/);
    assert.equal(fs.existsSync(path.join(dir, '.agents')), false);
  }
});

test('installSkill: a real source still installs', () => {
  const dir = project({ 'skills/qa-core/SKILL.md': '# ok\n' });
  const res = installSkill('qa-core', dir, undefined, { confirm: true });
  assert.equal(res.success, true);
  assert.equal(
    fs.readFileSync(path.join(dir, '.agents/skills/qa-core/SKILL.md'), 'utf8'),
    '# ok\n',
  );
});

test('installSkill: an empty source next to an installed copy installs from the installed copy', () => {
  const dir = project({
    'skills/qa-core/SKILL.md': '',
    '.agents/skills/qa-core/SKILL.md': '# installed\n',
  });
  const res = installSkill('qa-core', dir, undefined, { confirm: true });
  assert.equal(res.success, true);
  assert.equal(installedCore(dir), '# installed\n');
});

test('installSkill: an installed copy that went empty is refused and left as it is', () => {
  const dir = project({ '.agents/skills/qa-core/SKILL.md': '' });
  const res = installSkill('qa-core', dir, undefined, { confirm: true });
  assert.equal(res.success, false);
  assert.equal(installedCore(dir), '');
});

test('syncWorkspaceSkills: an empty source is reported as failed, other skills still install', () => {
  const dir = project({
    'package.json': '{}',
    'skills/qa-core/SKILL.md': '',
    'skills/dev-flow/SKILL.md': '# flow\n',
    'skills/qa-javascript-typescript/SKILL.md': '# js\n',
  });
  const res = syncWorkspaceSkills(dir, undefined, undefined, { confirm: true });
  assert.ok(res.failed.some((r) => r.skillId === 'qa-core' && /empty/.test(r.message)));
  assert.ok(res.installed.some((r) => r.skillId === 'dev-flow'));
  assert.equal(
    res.skippedUnauthorized.some((r) => r.skillId === 'qa-core'),
    false,
  );
});

test('get_skill_rules: an empty SKILL.md is an error, never a watermark over nothing', () => {
  const dir = project({ 'skills/qa-core/SKILL.md': '\n' });
  const res = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS).handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_skill_rules', arguments: { skill_id: 'qa-core', project_path: dir } },
  });
  const result = res.result as { isError?: boolean; content: { text: string }[] };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /empty/);
  assert.doesNotMatch(result.content[0].text, /Provenance/);
});
