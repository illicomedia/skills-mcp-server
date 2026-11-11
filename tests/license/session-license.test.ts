import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { FredoQaMcpServer } from '../../dist/server/server.js';
import { signedLicense, TEST_LICENSE_OPTIONS } from '../helpers/license-fixture.ts';
import { callToolText } from '../helpers/mcp-fixture.ts';
import { writeSkillSources } from '../helpers/skill-fixture.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-session-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const VALID = signedLicense();
const ENTERPRISE = signedLicense({ tier: 'enterprise', license_id: 'LIC-ENT-1' });
const EXPIRED = signedLicense({ updates_until: '2026-01-01T00:00:00Z' });
const INVALID = [
  'garbage',
  '{}',
  '{"schema_version":1}',
  '/nonexistent/license.json',
  VALID.replace('pro', 'enterprise'),
];

function sessionWith(key?: string): FredoQaMcpServer {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  if (key) {
    callToolText(server, 'set_license_key', { license_key: key });
  }
  return server;
}

function sessionStatus(server: FredoQaMcpServer): {
  status: string;
  tier: string;
  licenseId: string | null;
} {
  return JSON.parse(callToolText(server, 'verify_license'));
}

function project(): string {
  const dir = fs.mkdtempSync(path.join(root, 'p-'));
  writeSkillSources(dir, ['qa-core', 'qa-security', 'qa-devops']);
  return dir;
}

test('session: an invalid license_key on a tool call never replaces a valid session license', () => {
  for (const bad of INVALID) {
    for (const [tool, args] of [
      ['install_skill', { skill_id: 'qa-core', project_path: project() }],
      ['sync_workspace_skills', { project_path: project(), skills: ['qa-core'] }],
    ] as const) {
      const server = sessionWith(VALID);
      callToolText(server, tool, { ...args, license_key: bad });
      assert.equal(sessionStatus(server).status, 'ACTIVE', `${tool} with ${bad.slice(0, 30)}`);
    }
  }
});

test('session: the call that carries an invalid license_key runs with that key, not the session one', () => {
  const server = sessionWith(VALID);
  const result = JSON.parse(
    callToolText(server, 'install_skill', {
      skill_id: 'qa-security',
      project_path: project(),
      license_key: 'garbage',
    }),
  );
  assert.equal(result.success, false);
  assert.equal(result.requiresAuth, true);
});

test('session: a valid license_key on a tool call becomes the session license', () => {
  const server = sessionWith();
  callToolText(server, 'install_skill', {
    skill_id: 'qa-core',
    project_path: project(),
    license_key: VALID,
  });
  assert.equal(sessionStatus(server).status, 'ACTIVE');
});

test('session: verify_license with a license_key inspects it without touching the session', () => {
  const free = sessionWith();
  const inspected = JSON.parse(callToolText(free, 'verify_license', { license_key: VALID }));
  assert.equal(inspected.status, 'ACTIVE');
  assert.equal(sessionStatus(free).status, 'FREE_TIER');

  const pro = sessionWith(VALID);
  callToolText(pro, 'verify_license', { license_key: ENTERPRISE });
  assert.equal(sessionStatus(pro).tier, 'PRO');
  callToolText(pro, 'verify_license', { license_key: 'garbage' });
  assert.equal(sessionStatus(pro).status, 'ACTIVE');
});

test('session: set_license_key with an invalid license keeps the previous one and says so', () => {
  for (const bad of [...INVALID, EXPIRED]) {
    const server = sessionWith(VALID);
    const answer = JSON.parse(callToolText(server, 'set_license_key', { license_key: bad }));
    assert.equal(answer.valid, false, bad.slice(0, 30));
    assert.equal(answer.sessionUpdated, false);
    assert.match(answer.message, /session license is unchanged/i);
    assert.equal(sessionStatus(server).status, 'ACTIVE');
  }
});

test('session: set_license_key with a valid license replaces the session license and says so', () => {
  const server = sessionWith(VALID);
  const answer = JSON.parse(callToolText(server, 'set_license_key', { license_key: ENTERPRISE }));
  assert.equal(answer.valid, true);
  assert.equal(answer.sessionUpdated, true);
  assert.equal(sessionStatus(server).tier, 'ENTERPRISE');
  assert.equal(sessionStatus(server).licenseId, 'LIC-ENT-1');
});

test('session: an expired license is not stored, even on an empty session', () => {
  const server = sessionWith();
  const answer = JSON.parse(callToolText(server, 'set_license_key', { license_key: EXPIRED }));
  assert.equal(answer.sessionUpdated, false);
  assert.equal(sessionStatus(server).status, 'FREE_TIER');
});

test('session: blank or whitespace license_key arguments are ignored', () => {
  const server = sessionWith(VALID);
  for (const blank of ['', '   ', '\n\t']) {
    callToolText(server, 'install_skill', {
      skill_id: 'qa-core',
      project_path: project(),
      license_key: blank,
    });
  }
  assert.equal(sessionStatus(server).status, 'ACTIVE');
});

test('session: a license path is stored as given and re-read on each call', () => {
  const file = path.join(root, 'license.json');
  fs.writeFileSync(file, VALID);
  const server = sessionWith(file);
  assert.equal(sessionStatus(server).status, 'ACTIVE');
  fs.writeFileSync(file, 'tampered');
  assert.equal(sessionStatus(server).status, 'FREE_TIER');
});

test('session: set_license_key with a whitespace-only key is refused, the session is kept', () => {
  const server = sessionWith(VALID);
  const res = server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'set_license_key', arguments: { license_key: '  \n ' } },
  });
  const result = res.result as { isError?: boolean; content: { text: string }[] };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /license_key is empty/);
  assert.equal(sessionStatus(server).status, 'ACTIVE');
});
