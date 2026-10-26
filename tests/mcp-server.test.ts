import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { generateCanaryWatermark } from '../dist/license.js';
import { FredoQaMcpServer } from '../dist/server.js';
import type { JsonRpcRequest } from '../dist/types.js';
import { SERVER_VERSION } from '../dist/version.js';
import { TEST_LICENSE_OPTIONS, signedLicense } from './license-fixture.ts';

test('Canary Watermark: Generates non-empty deterministic cryptographic token', () => {
  const token = generateCanaryWatermark('user_123', 'qa-security');
  assert.match(token, /Fredo QA Skills Provenance/);
  assert.match(token, /Licensee=user_123/);
  assert.match(token, /Skill=qa-security/);
});

test('MCP Server: Handles initialize handshake', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  };
  const res = server.handleRequest(req);
  assert.strictEqual(res.id, 1);
  const result = res.result as { serverInfo: { name: string } };
  assert.strictEqual(result.serverInfo.name, '@illicomedia/skills-mcp-server');
});

test('MCP Server: tools/list returns all registered MCP tools', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  };
  const res = server.handleRequest(req);
  const tools = (res.result as { tools: Array<{ name: string }> }).tools;
  assert.strictEqual(tools.length, 8);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('list_skills'));
  assert.ok(names.includes('get_skill_rules'));
  assert.ok(names.includes('quick_check'));
  assert.ok(names.includes('verify_license'));
  assert.ok(names.includes('install_skill'));
  assert.ok(names.includes('sync_workspace_skills'));
  assert.ok(names.includes('set_license_key'));
  assert.ok(names.includes('get_version'));
});

test('MCP Server: list_skills under Free tier returns exactly 11 MIT skills', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS); // no key
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'list_skills',
      arguments: {},
    },
  };
  const res = server.handleRequest(req);
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
  assert.match(text, /11 accessible under FREE plan/);
  assert.match(text, /qa-core/);
  assert.match(text, /dev-flow/);
  assert.match(text, /qa-c-cpp/);
  assert.match(text, /qa-rust/);
  assert.match(text, /qa-go/);
  assert.match(text, /qa-java/);
  assert.ok(!text.includes('qa-security [PRO]'));
});

const listSkillsText = (server: FredoQaMcpServer, args: Record<string, unknown> = {}): string => {
  const res = server.handleRequest({
    jsonrpc: '2.0',
    id: 30,
    method: 'tools/call',
    params: { name: 'list_skills', arguments: args },
  });
  return (res.result as { content: Array<{ text: string }> }).content[0].text;
};

test('MCP Server: list_skills renders every tier in a table with Tier and Access columns', () => {
  const text = listSkillsText(new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS));
  assert.match(text, /\| Skill \| Tier \| Access \| Category \| Description \|/);
  assert.match(text, /11 accessible under FREE plan, 25 listed/);
  assert.match(text, /\| `qa-core` \| FREE \| ✅ Available \|/);
  assert.match(text, /\| `qa-security` \| PRO \| 🔒 Requires Pro license \|/);
  assert.match(text, /\| `qa-ai-infrastructure-compliance` \| ENTERPRISE \| 🔒 Requires Enterprise license \|/);
  assert.match(text, /\.qa-license\.json/);
});

test('MCP Server: list_skills explains why a plain license key string does not unlock paid skills', () => {
  const text = listSkillsText(
    new FredoQaMcpServer('fqa_pro_0123abcd_deadbeef0000', TEST_LICENSE_OPTIONS),
  );
  assert.match(text, /11 accessible under FREE plan/);
  assert.match(text, /could not be read|Invalid license/);
  assert.match(text, /🔒 Requires Pro license/);
});

test('MCP Server: list_skills under Pro tier unlocks Pro rows and keeps Enterprise rows locked', () => {
  const text = listSkillsText(
    new FredoQaMcpServer(signedLicense({ licensee: 'Fred V.' }), TEST_LICENSE_OPTIONS),
  );
  assert.match(text, /\| `qa-security` \| PRO \| ✅ Available \|/);
  assert.match(text, /\| `qa-ai-infrastructure-compliance` \| ENTERPRISE \| 🔒 Requires Enterprise license \|/);
});

test('MCP Server: list_skills category filter and Enterprise tier show no lock advisory', () => {
  const server = new FredoQaMcpServer(
    signedLicense({ tier: 'enterprise', licensee: 'Fred V.' }),
    TEST_LICENSE_OPTIONS,
  );
  const text = listSkillsText(server, { category: 'compliance' });
  assert.ok(!text.includes('🔒'));
  assert.ok(!text.includes('[!NOTE]'));
  assert.ok(!text.includes('`qa-core`'));
});

test('MCP Server: list_skills under Pro tier returns 18 skills', () => {
  const server = new FredoQaMcpServer(signedLicense({ licensee: 'team' }), TEST_LICENSE_OPTIONS);
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'list_skills',
      arguments: {},
    },
  };
  const res = server.handleRequest(req);
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
  assert.match(text, /19 accessible under PRO plan/);
  assert.match(text, /qa-security/);
  assert.match(text, /qa-accessibility/);
  assert.match(text, /qa-c-cpp/);
});

test('MCP Server: list_skills under Enterprise tier returns 25 skills', () => {
  const server = new FredoQaMcpServer(
    signedLicense({ tier: 'enterprise', licensee: 'bigcorp' }),
    TEST_LICENSE_OPTIONS,
  );
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: {
      name: 'list_skills',
      arguments: {},
    },
  };
  const res = server.handleRequest(req);
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
  assert.match(text, /25 accessible under ENTERPRISE plan/);
  assert.match(text, /qa-gdpr-rgpd/);
  assert.match(text, /qa-ai-infrastructure-compliance/);
});

test('MCP Server: get_skill_rules returns watermark and content', () => {
  const server = new FredoQaMcpServer(signedLicense({ licensee: 'team' }), TEST_LICENSE_OPTIONS);
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'get_skill_rules',
      arguments: { skill_id: 'qa-security' },
    },
  };
  const res = server.handleRequest(req);
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
  assert.match(text, /Fredo QA Skills Provenance/);
  assert.match(text, /qa-security/);
});

test('MCP Server: quick_check without confirm returns preview and requires confirmation', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 55,
    method: 'tools/call',
    params: {
      name: 'quick_check',
      arguments: { project_path: process.cwd() },
    },
  };
  const res = server.handleRequest(req);
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
  const preview = JSON.parse(text);
  assert.strictEqual(preview.previewOnly, true);
  assert.strictEqual(preview.requiresConfirmation, true);
  assert.strictEqual(preview.score, 0);
  assert.match(preview.message, /requires explicit user confirmation/i);
});

test('MCP Server: quick_check with confirm: true returns structured preflight report', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'quick_check',
      arguments: { project_path: process.cwd(), confirm: true },
    },
  };
  const res = server.handleRequest(req);
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
  const report = JSON.parse(text);
  assert.ok(report.status === 'ready' || report.status === 'needs_attention');
  assert.match(report.prerequisites, /^\d+\/\d+ met$/);
  assert.ok(typeof report.score === 'number');
  assert.ok(report.totalChecks > 0);
  assert.ok(Array.isArray(report.results));
});

test('MCP Server: install_skill allows free skills without license key', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS); // no license key
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-test-free-'));
  try {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'install_skill',
        arguments: { skill_id: 'qa-go', project_path: tmpDir, confirm: true },
      },
    };
    const res = server.handleRequest(req);
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    const result = JSON.parse(text);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.tier, 'free');
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-go', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-go', 'LICENSE')));
    const licenseContent = fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'qa-go', 'LICENSE'), 'utf-8');
    assert.ok(licenseContent.includes('MIT License'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Server: install_skill without confirm returns preview and writes 0 files to disk', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-test-preview-'));
  try {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 88,
      method: 'tools/call',
      params: {
        name: 'install_skill',
        arguments: { skill_id: 'qa-go', project_path: tmpDir },
      },
    };
    const res = server.handleRequest(req);
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    const result = JSON.parse(text);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.previewOnly, true);
    assert.strictEqual(result.requiresConfirmation, true);
    assert.match(result.message, /PREVIEW ONLY - 0 files written to disk/);
    assert.match(result.message, /USER CONFIRMATION REQUIRED/);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-go')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Server: install_skill blocks paid skill without auth and reports required tier', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS); // no license key
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-test-paid-block-'));
  try {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'install_skill',
        arguments: { skill_id: 'qa-security', project_path: tmpDir },
      },
    };
    const res = server.handleRequest(req);
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    const result = JSON.parse(text);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.requiresAuth, true);
    assert.strictEqual(result.requiredTier, 'pro');
    assert.match(result.message, /Authentication required/);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-security')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Server: install_skill succeeds for paid skill with valid license key', () => {
  const server = new FredoQaMcpServer(signedLicense({ licensee: 'acmecorp' }), TEST_LICENSE_OPTIONS);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-test-paid-ok-'));
  try {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'install_skill',
        arguments: { skill_id: 'qa-security', project_path: tmpDir, confirm: true },
      },
    };
    const res = server.handleRequest(req);
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    const result = JSON.parse(text);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.tier, 'pro');
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-security', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-security', 'LICENSE')));
    const skillContent = fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'qa-security', 'SKILL.md'), 'utf-8');
    assert.match(skillContent, /Fredo QA Skills Provenance/);
    const licenseContent = fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'qa-security', 'LICENSE'), 'utf-8');
    assert.match(licenseContent, /Commercial Skills License/);
    assert.match(licenseContent, /acmecorp/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Server: set_license_key dynamically unlocks session', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS); // start free
  const req1: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: {
      name: 'set_license_key',
      arguments: {
        license_key: signedLicense({ tier: 'enterprise', licensee: 'megaenterprise' }),
      },
    },
  };
  const res1 = server.handleRequest(req1);
  const text1 = (res1.result as { content: Array<{ text: string }> }).content[0].text;
  const result1 = JSON.parse(text1);
  assert.strictEqual(result1.status, 'AUTHENTICATED');
  assert.strictEqual(result1.tier, 'ENTERPRISE');
  assert.strictEqual(result1.customer, 'megaenterprise');

  // Verify list_skills now returns enterprise tier
  const req2: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/call',
    params: { name: 'list_skills', arguments: {} },
  };
  const res2 = server.handleRequest(req2);
  const text2 = (res2.result as { content: Array<{ text: string }> }).content[0].text;
  assert.match(text2, /25 accessible under ENTERPRISE plan/);
});

test('MCP Server: sync_workspace_skills auto-detects stack and reports auth status', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS); // free
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-test-sync-'));
  try {
    // Create a mock Go project with Dockerfile
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/app\ngo 1.22\n');
    fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM golang:1.22\n');

    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'sync_workspace_skills',
        arguments: { project_path: tmpDir, confirm: true },
      },
    };
    const res = server.handleRequest(req);
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    assert.match(text, /Fredo QA Skills Workspace Sync/);
    assert.match(text, /Successfully Installed/);
    assert.match(text, /qa-go/);
    assert.match(text, /qa-core/);
    assert.match(text, /Requires Authentication/);
    assert.match(text, /qa-security/);
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-go', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-core', 'SKILL.md')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Server: sync_workspace_skills without confirm returns preview and writes 0 files', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-test-sync-preview-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/app\ngo 1.22\n');
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 89,
      method: 'tools/call',
      params: {
        name: 'sync_workspace_skills',
        arguments: { project_path: tmpDir },
      },
    };
    const res = server.handleRequest(req);
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    assert.match(text, /\[DRY-RUN PREVIEW\]/);
    assert.match(text, /0 files written to disk/);
    assert.match(text, /User agreement is required/i);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'qa-go')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Server: get_version returns package version and protocol metadata', () => {
  const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 100,
    method: 'tools/call',
    params: {
      name: 'get_version',
      arguments: {},
    },
  };
  const res = server.handleRequest(req);
  assert.strictEqual(res.error, undefined);
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
  const parsed = JSON.parse(text);
  assert.strictEqual(parsed.version, SERVER_VERSION);
  assert.strictEqual(parsed.package, '@illicomedia/skills-mcp-server');
  assert.strictEqual(parsed.protocolVersion, '2024-11-05');
  assert.strictEqual(parsed.skillsCount, 25);
  assert.strictEqual(parsed.licenseTier, 'FREE');
});
