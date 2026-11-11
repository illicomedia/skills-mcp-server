import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FredoQaMcpServer } from '../../dist/server/server.js';
import { signedLicense, TEST_LICENSE_OPTIONS } from '../helpers/license-fixture.ts';
import { callToolText as callTool } from '../helpers/mcp-fixture.ts';
import { writeSkillSources } from '../helpers/skill-fixture.ts';

const CLI = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

interface Workspace {
  root: string;
  home: string;
  project: string;
}

function withWorkspace(run: (ws: Workspace) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-license-e2e-'));
  const ws = { root, home: path.join(root, 'home'), project: path.join(root, 'project') };
  fs.mkdirSync(path.join(ws.home, '.config', 'fredo-qa'), { recursive: true });
  fs.mkdirSync(ws.project);
  writeSkillSources(ws.project, ['qa-gdpr-rgpd']);
  fs.writeFileSync(path.join(ws.project, 'LICENSE'), 'MIT License\n');
  try {
    run(ws);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Writes `license` to the user config folder of the workspace and starts a server there. */
function serverWithUserLicense(ws: Workspace, license: string): FredoQaMcpServer {
  const file = path.join(ws.home, '.config', 'fredo-qa', 'license.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, license);
  return new FredoQaMcpServer(undefined, {
    ...TEST_LICENSE_OPTIONS,
    homeDir: ws.home,
    projectRoot: ws.project,
  });
}

/** Runs verify_license through the real compiled CLI in the workspace; returns its status. */
function verifyLicenseThroughCli(
  ws: Workspace,
  extraEnv: Record<string, string> = {},
): { status: string; tier: string; message: string } {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'verify_license', arguments: {} },
  };
  const run = spawnSync(process.execPath, [CLI], {
    cwd: ws.project,
    env: { ...process.env, HOME: ws.home, USERPROFILE: ws.home, ...extraEnv },
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const response = JSON.parse(run.stdout.trim().split('\n').at(-1) as string);
  return JSON.parse(response.result.content[0].text);
}

test('E2E: a license file in the user config unlocks enterprise across the tool surface', () => {
  withWorkspace((ws) => {
    const server = serverWithUserLicense(
      ws,
      signedLicense({ tier: 'enterprise', licensee: 'Fred V.' }),
    );

    const status = JSON.parse(callTool(server, 'verify_license'));
    assert.equal(status.status, 'ACTIVE');
    assert.equal(status.tier, 'ENTERPRISE');
    assert.equal(status.customer, 'Fred V.');
    assert.equal(status.licenseId, 'LIC-2026-000123');

    assert.match(callTool(server, 'list_skills'), /25 accessible under ENTERPRISE plan/);

    const install = JSON.parse(
      callTool(server, 'install_skill', {
        skill_id: 'qa-gdpr-rgpd',
        project_path: ws.project,
        confirm: true,
      }),
    );
    assert.equal(install.success, true);
    const licenseText = fs.readFileSync(
      path.join(ws.project, '.agents', 'skills', 'qa-gdpr-rgpd', 'LICENSE'),
      'utf8',
    );
    assert.match(licenseText, /Fred V./);
    assert.match(licenseText, /LIC-2026-000123/);
  });
});

test('E2E: a license whose updates ended before this release keeps the session free', () => {
  withWorkspace((ws) => {
    const server = serverWithUserLicense(
      ws,
      signedLicense({ updates_until: '2026-01-01T00:00:00Z' }),
    );

    const status = JSON.parse(callTool(server, 'verify_license'));
    assert.equal(status.status, 'UPDATES_ENDED');
    assert.equal(status.tier, 'FREE');
    const install = JSON.parse(
      callTool(server, 'install_skill', {
        skill_id: 'qa-security',
        project_path: ws.project,
        confirm: true,
      }),
    );
    assert.equal(install.success, false);
  });
});

test('E2E: set_license_key accepts a license file path', () => {
  withWorkspace((ws) => {
    const file = path.join(ws.root, 'license.json');
    fs.writeFileSync(file, signedLicense({ licensee: 'Path Customer' }));
    const server = new FredoQaMcpServer(undefined, {
      ...TEST_LICENSE_OPTIONS,
      homeDir: ws.home,
      projectRoot: ws.project,
    });
    const result = JSON.parse(callTool(server, 'set_license_key', { license_key: file }));
    assert.equal(result.status, 'AUTHENTICATED');
    assert.equal(result.customer, 'Path Customer');
    assert.match(callTool(server, 'list_skills'), /accessible under PRO plan/);
  });
});

test('E2E: the compiled release server ignores licenses signed with the test key', () => {
  withWorkspace((ws) => {
    fs.writeFileSync(
      path.join(ws.project, '.qa-license.json'),
      signedLicense({ tier: 'enterprise' }),
    );
    const status = verifyLicenseThroughCli(ws);
    assert.equal(status.status, 'FREE_TIER');
    assert.equal(status.tier, 'FREE');
    assert.match(status.message, /not trusted/);
  });
});

test('E2E: FREDO_QA_LICENSE_FILE from 2.x is ignored; licenses come from fixed locations only', () => {
  withWorkspace((ws) => {
    const file = path.join(ws.root, 'env-license.json');
    fs.writeFileSync(file, signedLicense({ tier: 'enterprise' }));
    const status = verifyLicenseThroughCli(ws, { FREDO_QA_LICENSE_FILE: file });
    assert.equal(status.status, 'FREE_TIER');
    assert.match(status.message, /No license file found/);
    assert.match(status.message, /~\/\.config\/fredo-qa\/license\.json/);
  });
});
