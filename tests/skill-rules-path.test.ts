import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { FredoQaMcpServer } from '../dist/server/server.js';
import { MCP_TOOLS } from '../dist/server/tools.js';
import { signedLicense, TEST_LICENSE_OPTIONS } from './license-fixture.ts';
import { callToolText } from './mcp-fixture.ts';
import { writeSkillSources } from './skill-fixture.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-rules-path-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function projectWith(...skills: string[]): string {
  const dir = fs.mkdtempSync(path.join(root, 'p-'));
  writeSkillSources(dir, skills);
  return dir;
}

const server = () => new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);

test('get_skill_rules: declares an optional project_path', () => {
  const tool = MCP_TOOLS.find((t) => t.name === 'get_skill_rules');
  assert.ok(tool);
  assert.ok('project_path' in tool.inputSchema.properties);
  assert.deepEqual(tool.inputSchema.required, ['skill_id']);
});

test('get_skill_rules: reads the skill from the given project, not from the server folder', () => {
  const dir = projectWith('qa-core');
  const text = callToolText(server(), 'get_skill_rules', {
    skill_id: 'qa-core',
    project_path: dir,
  });
  assert.match(text, /# qa-core \(test fixture\)/);
});

test('get_skill_rules: a skill missing from the given project says where it looked', () => {
  const dir = projectWith('dev-flow');
  const res = server().handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_skill_rules', arguments: { skill_id: 'qa-core', project_path: dir } },
  });
  const result = res.result as { isError: boolean; content: { text: string }[] };
  assert.equal(result.isError, true);
  assert.ok(result.content[0].text.includes(fs.realpathSync(dir)));
});

test('get_skill_rules: refuses a system directory or a missing folder as project_path', () => {
  for (const bad of ['/etc', path.join(root, 'does-not-exist')]) {
    const res = server().handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_skill_rules', arguments: { skill_id: 'qa-core', project_path: bad } },
    });
    const result = res.result as { isError: boolean; content: { text: string }[] };
    assert.equal(result.isError, true, bad);
    assert.match(result.content[0].text, /get_skill_rules/);
  }
});

test('get_skill_rules: the license tier still gates paid skills when project_path is given', () => {
  const dir = projectWith('qa-security');
  const free = callToolText(server(), 'get_skill_rules', {
    skill_id: 'qa-security',
    project_path: dir,
  });
  assert.match(free, /Access Restricted/);

  const licensed = server();
  licensed.setLicenseKey(signedLicense());
  const text = callToolText(licensed, 'get_skill_rules', {
    skill_id: 'qa-security',
    project_path: dir,
  });
  assert.match(text, /# qa-security \(test fixture\)/);
});

function call(args: Record<string, unknown>): {
  error?: { code: number; message: string };
  text: string;
  isError: boolean;
} {
  const res = server().handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_skill_rules', arguments: args },
  });
  if (res.error) {
    return { error: res.error, text: '', isError: true };
  }
  const result = res.result as { isError?: boolean; content: { text: string }[] };
  return { text: result.content[0].text, isError: result.isError === true };
}

test('get_skill_rules: project_path of the wrong JSON type is rejected before any read', () => {
  for (const bad of [42, true, ['a'], { a: 1 }]) {
    const res = call({ skill_id: 'qa-core', project_path: bad });
    assert.equal(res.error?.code, -32602, JSON.stringify(bad));
    assert.match(res.error?.message ?? '', /project_path/);
  }
});

test('get_skill_rules: an empty project_path counts as omitted (working directory)', () => {
  const res = call({ skill_id: 'qa-core', project_path: '' });
  assert.equal(res.error, undefined);
  assert.doesNotMatch(res.text, /# qa-core \(test fixture\)/);
});

test('get_skill_rules: a null project_path counts as omitted (working directory)', () => {
  const res = call({ skill_id: 'qa-core', project_path: null });
  assert.equal(res.error, undefined);
});

test('get_skill_rules: a relative project_path is resolved and accepted', () => {
  const dir = projectWith('qa-core');
  const relative = path.relative(process.cwd(), dir);
  assert.match(call({ skill_id: 'qa-core', project_path: relative }).text, /test fixture/);
});

test('get_skill_rules: a trailing slash, dot segments and spaces in the path are fine', () => {
  const dir = fs.mkdtempSync(path.join(root, 'with space é-'));
  writeSkillSources(dir, ['qa-core']);
  for (const variant of [`${dir}/`, `${dir}/./`, path.join(dir, 'x', '..')]) {
    fs.mkdirSync(path.join(dir, 'x'), { recursive: true });
    assert.match(call({ skill_id: 'qa-core', project_path: variant }).text, /test fixture/);
  }
});

test('get_skill_rules: a project_path that is a file is refused', () => {
  const dir = projectWith('qa-core');
  const res = call({
    skill_id: 'qa-core',
    project_path: path.join(dir, 'skills/qa-core/SKILL.md'),
  });
  assert.equal(res.isError, true);
  assert.match(res.text, /not a directory/);
});

test('get_skill_rules: a symlink to a project works, a symlink to a system directory does not', () => {
  const dir = projectWith('qa-core');
  const good = path.join(root, 'link-to-project');
  fs.symlinkSync(dir, good);
  assert.match(call({ skill_id: 'qa-core', project_path: good }).text, /test fixture/);

  const bad = path.join(root, 'link-to-etc');
  fs.symlinkSync('/etc', bad);
  const res = call({ skill_id: 'qa-core', project_path: bad });
  assert.equal(res.isError, true);
  assert.match(res.text, /system directory/);
});

test('get_skill_rules: finds the skill in each supported layout under project_path', () => {
  for (const layout of [
    'skills/free/qa-core',
    'skills/pro/qa-core',
    'skills/enterprise/qa-core',
    'skills/qa-core',
    '.agents/skills/qa-core',
  ]) {
    const dir = fs.mkdtempSync(path.join(root, 'layout-'));
    fs.mkdirSync(path.join(dir, layout), { recursive: true });
    fs.writeFileSync(path.join(dir, layout, 'SKILL.md'), `# from ${layout}\n`);
    assert.match(
      call({ skill_id: 'qa-core', project_path: dir }).text,
      new RegExp(`from ${layout}`),
    );
  }
});

test('get_skill_rules: an unknown skill id or a traversal id never reads outside the catalog', () => {
  const dir = projectWith('qa-core');
  fs.writeFileSync(path.join(root, 'SKILL.md'), '# outside\n');
  for (const id of ['nope', '../SKILL', '..', 'qa-core/../../SKILL', '']) {
    const res = call({ skill_id: id, project_path: dir });
    assert.ok(res.isError || res.error, id);
    assert.doesNotMatch(res.text, /outside/);
    assert.doesNotMatch(res.text, /Access Restricted|commercial/, id);
    if (id !== '') {
      assert.match(res.text, /Unknown skill/, id);
    }
  }
});

test('get_skill_rules: reading never writes into the project', () => {
  const dir = projectWith('qa-core');
  const before = fs.readdirSync(dir, { recursive: true }).sort();
  call({ skill_id: 'qa-core', project_path: dir });
  call({ skill_id: 'qa-security', project_path: dir });
  assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before);
});

test('get_skill_rules: a license file inside project_path is not read for the tier', () => {
  const dir = projectWith('qa-security');
  fs.writeFileSync(path.join(dir, '.qa-license.json'), signedLicense());
  assert.match(call({ skill_id: 'qa-security', project_path: dir }).text, /Access Restricted/);
});

test('get_skill_rules: each call uses its own project_path (no state kept between calls)', () => {
  const a = projectWith('qa-core');
  const b = fs.mkdtempSync(path.join(root, 'empty-'));
  const s = server();
  assert.match(
    callToolText(s, 'get_skill_rules', { skill_id: 'qa-core', project_path: a }),
    /fixture/,
  );
  const res = s.handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'get_skill_rules', arguments: { skill_id: 'qa-core', project_path: b } },
  });
  assert.equal((res.result as { isError?: boolean }).isError, true);
});
