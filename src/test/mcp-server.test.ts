import * as assert from 'node:assert';
import test from 'node:test';
import { generateCanaryWatermark, validateLicenseKey } from '../license.js';
import { FredoQaMcpServer } from '../server.js';
import type { JsonRpcRequest } from '../types.js';

test('License Validator: No key defaults cleanly to Free Foundation tier', () => {
  const res = validateLicenseKey(undefined);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.tier, 'free');
  assert.strictEqual(res.fallbackMode, true);
  assert.match(res.message, /Free Foundation mode/);
});

test('License Validator: Valid Pro live key activates Pro tier', () => {
  const res = validateLicenseKey('fqa_live_pro_acme_7fffffff_abcdef123456');
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.tier, 'pro');
  assert.strictEqual(res.fallbackMode, false);
  assert.strictEqual(res.customerName, 'acme');
});

test('License Validator: Valid Enterprise live key activates Enterprise tier', () => {
  const res = validateLicenseKey('fqa_live_ent_bigcorp_7fffffff_abcdef123456');
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.tier, 'enterprise');
  assert.strictEqual(res.fallbackMode, false);
});

test('License Validator: Expired key gracefully falls back to Free tier without throwing', () => {
  // Epoch in the past (e.g. 100000 = year 1970)
  const expiredKey = 'fqa_live_pro_oldcorp_000186a0_abcdef123456';
  const res = validateLicenseKey(expiredKey);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.tier, 'free');
  assert.strictEqual(res.isExpired, true);
  assert.strictEqual(res.fallbackMode, true);
  assert.match(res.message, /expired/i);
});

test('Canary Watermark: Generates non-empty deterministic cryptographic token', () => {
  const token = generateCanaryWatermark('user_123', 'qa-security');
  assert.match(token, /Fredo QA Skills Provenance/);
  assert.match(token, /Licensee=user_123/);
  assert.match(token, /Skill=qa-security/);
});

test('MCP Server: Handles initialize handshake', () => {
  const server = new FredoQaMcpServer();
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  };
  const res = server.handleRequest(req);
  assert.strictEqual(res.id, 1);
  const result = res.result as { serverInfo: { name: string } };
  assert.strictEqual(result.serverInfo.name, 'fredo-qa-mcp-server');
});

test('MCP Server: tools/list returns all registered MCP tools', () => {
  const server = new FredoQaMcpServer();
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  };
  const res = server.handleRequest(req);
  const tools = (res.result as { tools: Array<{ name: string }> }).tools;
  assert.strictEqual(tools.length, 4);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('list_skills'));
  assert.ok(names.includes('get_skill_rules'));
  assert.ok(names.includes('audit_compliance'));
  assert.ok(names.includes('verify_license'));
});

test('MCP Server: list_skills under Free tier returns exactly 7 MIT skills', () => {
  const server = new FredoQaMcpServer(); // no key
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
  assert.match(text, /7 accessible under FREE plan/);
  assert.match(text, /qa-core/);
  assert.match(text, /dev-flow/);
  assert.ok(!text.includes('qa-security [PRO]'));
});

test('MCP Server: list_skills under Pro tier returns 14 skills', () => {
  const server = new FredoQaMcpServer('fqa_live_pro_team_7fffffff_hash');
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
  assert.match(text, /14 accessible under PRO plan/);
  assert.match(text, /qa-security/);
  assert.match(text, /qa-accessibility/);
});

test('MCP Server: get_skill_rules returns watermark and content', () => {
  const server = new FredoQaMcpServer('fqa_live_pro_team_7fffffff_hash');
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

test('MCP Server: audit_compliance returns valid structured audit report', () => {
  const server = new FredoQaMcpServer();
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'audit_compliance',
      arguments: { project_path: process.cwd() },
    },
  };
  const res = server.handleRequest(req);
  const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
  const report = JSON.parse(text);
  assert.ok(typeof report.score === 'number');
  assert.ok(report.totalChecks > 0);
  assert.ok(Array.isArray(report.results));
});
