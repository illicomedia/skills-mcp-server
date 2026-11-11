import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import test, { describe } from 'node:test';
import { SERVER_VERSION } from '../../dist/version.js';
import { writeSkillSources } from '../helpers/skill-fixture.ts';

describe('e2e › e2e-website', () => {
  interface JsonRpcMessage {
    jsonrpc: string;
    id?: number | string | null;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  }

  /**
   * End-to-End Client Harness testing MCP Server against real production codebase: website/
   */
  class McpTestClient {
    private child: ReturnType<typeof spawn>;
    private pending = new Map<number, (res: JsonRpcMessage) => void>();
    private nextId = 1;
    public stderrLogs = '';

    constructor(cliPath: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
      this.child = spawn(process.execPath, [cliPath], {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.child.stderr?.on('data', (d) => {
        this.stderrLogs += d.toString();
      });

      const rl = createInterface({ input: this.child.stdout! });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }
        try {
          const msg = JSON.parse(trimmed) as JsonRpcMessage;
          if (msg.id !== undefined && msg.id !== null) {
            const resolver = this.pending.get(Number(msg.id));
            if (resolver) {
              this.pending.delete(Number(msg.id));
              resolver(msg);
            }
          }
        } catch {
          process.stderr.write(`[McpTestClient] Parse error on line: ${line}\n`);
        }
      });
    }

    public sendRequest(method: string, params?: unknown): Promise<JsonRpcMessage> {
      const id = this.nextId++;
      const req = { jsonrpc: '2.0', id, method, params };
      return new Promise((resolve, reject) => {
        this.pending.set(id, resolve);
        this.child.stdin?.write(`${JSON.stringify(req)}\n`, (err) => {
          if (err) {
            reject(err);
          }
        });
      });
    }

    public sendNotification(method: string, params?: unknown): void {
      const notif = { jsonrpc: '2.0', method, params };
      this.child.stdin?.write(`${JSON.stringify(notif)}\n`);
    }

    public async close(): Promise<number | null> {
      return new Promise((resolve) => {
        this.child.on('close', (code) => resolve(code));
        this.child.stdin?.end();
      });
    }
  }

  test('E2E Real Website: Full MCP Agent Lifecycle against website/ application', async () => {
    const cliPath = path.resolve('dist/index.js');
    const websiteDir = path.resolve(import.meta.dirname, '..', 'fixtures/sample-website');

    // Run from the repository root, where real skill sources live under skills/ (the package ships none)
    const client = new McpTestClient(cliPath, path.resolve(import.meta.dirname, '..', 'fixtures'));

    try {
      // 1. Handshake (initialize)
      const initRes = await client.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'Antigravity Agent', version: '2.0.0' },
        capabilities: {},
      });
      assert.strictEqual(initRes.error, undefined);
      const initResult = initRes.result as {
        protocolVersion: string;
        serverInfo: { name: string; version: string };
      };
      assert.strictEqual(initResult.protocolVersion, '2024-11-05');
      assert.strictEqual(initResult.serverInfo.name, '@illicomedia/skills-mcp-server');
      assert.strictEqual(initResult.serverInfo.version, SERVER_VERSION);
      assert.match(SERVER_VERSION, /^\d+\.\d+\.\d+$/);

      // Send initialized notification
      client.sendNotification('notifications/initialized', {});

      // 2. Discover Tools (tools/list)
      const toolsRes = await client.sendRequest('tools/list', {});
      assert.strictEqual(toolsRes.error, undefined);
      const tools = (toolsRes.result as { tools: Array<{ name: string }> }).tools;
      const toolNames = tools.map((t) => t.name);
      assert.ok(toolNames.includes('list_skills'));
      assert.ok(toolNames.includes('get_skill_rules'));
      assert.ok(toolNames.includes('install_skill'));
      assert.ok(toolNames.includes('sync_workspace_skills'));
      assert.ok(toolNames.includes('prune_skills'));
      assert.ok(toolNames.includes('quick_check'));
      assert.ok(toolNames.includes('set_license_key'));
      assert.ok(toolNames.includes('verify_license'));
      assert.ok(toolNames.includes('get_version'));

      // 3. Quick Check directly against website/
      const auditRes = await client.sendRequest('tools/call', {
        name: 'quick_check',
        arguments: { project_path: websiteDir, confirm: true },
      });
      assert.strictEqual(auditRes.error, undefined);
      const auditText = (auditRes.result as { content: Array<{ text: string }> }).content[0].text;
      if ((auditRes.result as { isError?: boolean }).isError) {
        throw new Error(`Tool execution error: ${auditText}`);
      }
      const auditReport = JSON.parse(auditText);
      assert.strictEqual(auditReport.status, 'ready');
      assert.strictEqual(auditReport.prerequisites, '11/11 met');
      assert.strictEqual(auditReport.score, 100);
      assert.strictEqual(auditReport.failedChecks, 0);
      assert.strictEqual(auditReport.passedChecks, 11);
      assert.strictEqual(auditReport.totalChecks, 11);
      assert.strictEqual(auditReport.recommendations.length, 0);

      // Verify all 11 checks passed on website/
      const checkNames = auditReport.results.map((r: { name: string }) => r.name);
      assert.ok(checkNames.includes('AGENTS.md present'));
      assert.ok(checkNames.includes('.qa-exceptions.yaml present'));
      assert.ok(checkNames.includes('LICENSE file present'));
      assert.ok(checkNames.includes('security.txt present'));
      assert.ok(checkNames.includes('.gitignore mentions .env'));
      assert.ok(checkNames.includes('private key and secret hygiene in .gitignore'));
      assert.ok(checkNames.includes('qa:starter or qa:standard script declared'));
      assert.ok(checkNames.includes('type-check script declared'));
      assert.ok(checkNames.includes('automated test suite declared'));
      assert.ok(checkNames.includes('dependency lockfile present'));
      assert.ok(checkNames.includes('CI workflow definition present'));

      // 4. Auto-detect & Inspect Skills for website/ stack in an isolated sandbox
      const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'website-mcp-e2e-'));
      writeSkillSources(sandboxDir);
      try {
        fs.copyFileSync(
          path.join(websiteDir, 'package.json'),
          path.join(sandboxDir, 'package.json'),
        );
        fs.copyFileSync(
          path.join(websiteDir, 'tsconfig.json'),
          path.join(sandboxDir, 'tsconfig.json'),
        );
        fs.mkdirSync(path.join(sandboxDir, 'public/api'), { recursive: true });
        fs.writeFileSync(path.join(sandboxDir, 'public/api/test.php'), '<?php echo "ok";');
        fs.mkdirSync(path.join(sandboxDir, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(sandboxDir, 'scripts/build.sh'), '#!/bin/bash\n');

        const syncRes = await client.sendRequest('tools/call', {
          name: 'sync_workspace_skills',
          arguments: { project_path: sandboxDir, confirm: true },
        });
        assert.strictEqual(syncRes.error, undefined);
        const syncText = (syncRes.result as { content: Array<{ text: string }> }).content[0].text;
        assert.match(syncText, /# Fredo QA Skills Workspace Sync/);
        assert.match(syncText, /Active Plan: \*\*FREE\*\*/);
        assert.match(syncText, /qa-javascript-typescript/);
        assert.match(syncText, /qa-core/);
        assert.match(syncText, /dev-flow/);
        assert.match(syncText, /qa-bash/);
        assert.match(syncText, /qa-php/);
      } finally {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      }

      // 5. Inspect Skill Rules for Free skill (qa-core)
      const rulesRes = await client.sendRequest('tools/call', {
        name: 'get_skill_rules',
        arguments: { skill_id: 'qa-core' },
      });
      assert.strictEqual(rulesRes.error, undefined);
      const rulesText = (rulesRes.result as { content: Array<{ text: string }> }).content[0].text;
      assert.match(rulesText, /qa-core/i);
      assert.match(rulesText, /qa:starter/);

      // 6. Test Free Tier Access Protection on Pro Skill (qa-security)
      const secRulesRes = await client.sendRequest('tools/call', {
        name: 'get_skill_rules',
        arguments: { skill_id: 'qa-security' },
      });
      assert.strictEqual(secRulesRes.error, undefined);
      const secRulesText = (secRulesRes.result as { content: Array<{ text: string }> }).content[0]
        .text;
      assert.match(secRulesText, /Access Restricted: qa-security/);
      assert.match(secRulesText, /https:\/\/www\.illicomedia\.com\/qa-skills\/pricing/);

      // 7. Verify License Status under Free mode
      const licStatusRes = await client.sendRequest('tools/call', {
        name: 'verify_license',
        arguments: {},
      });
      assert.strictEqual(licStatusRes.error, undefined);
      const licStatusText = (licStatusRes.result as { content: Array<{ text: string }> }).content[0]
        .text;
      const licReport = JSON.parse(licStatusText);
      assert.strictEqual(licReport.tier, 'FREE');
      assert.strictEqual(licReport.status, 'FREE_TIER');
    } finally {
      const exitCode = await client.close();
      assert.strictEqual(exitCode, 0);
    }
  });
});
