import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { runComplianceAudit } from '../dist/audit/index.js';
import { expectCheck } from './audit-fixture.ts';

const OVERCLAIMS = /\b(valid|correctly|compliant|ensures?|verified|soundness)\b/i;

function auditOf(files: Record<string, string>): ReturnType<typeof runComplianceAudit> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-audit-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    return runComplianceAudit(dir, { confirm: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Audits a project with AGENTS.md and `files`, and asserts its CI check passes. */
function passingCiCheck(files: Record<string, string>) {
  const report = auditOf({ 'AGENTS.md': '', ...files });
  return expectCheck(report, 'CI workflow definition present', {
    passed: true,
    context: JSON.stringify(files),
  });
}

test('Audit: requires confirmation when confirm is false or omitted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-preview-'));
  try {
    const preview = runComplianceAudit(dir);
    assert.strictEqual(preview.previewOnly, true);
    assert.strictEqual(preview.requiresConfirmation, true);
    assert.strictEqual(preview.score, 0);
    assert.strictEqual(preview.totalChecks, 0);
    assert.match(preview.message || '', /requires explicit user confirmation/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Audit: passing checks only claim file presence, never validity', () => {
  const report = auditOf({
    'AGENTS.md': '',
    '.qa-exceptions.yaml': 'not: [valid yaml',
    LICENSE: 'MIT',
    'public/.well-known/security.txt': '',
    '.gitignore': '.env\n*.pem\n*.key\n',
    'package.json': JSON.stringify({
      scripts: {
        'qa:starter': 'true',
        'type-check': 'true',
        test: 'true',
      },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"',
    '.github/workflows/ci.yml': 'name: CI',
  });
  assert.equal(report.failedChecks, 0);
  assert.equal(report.passedChecks, 11);
  assert.equal(report.totalChecks, 11);
  for (const result of report.results) {
    assert.doesNotMatch(`${result.name} ${result.details}`, OVERCLAIMS, result.name);
  }
});

test('Audit: the report states its scope', () => {
  const report = auditOf({});
  assert.match(report.scope, /presence/i);
  assert.match(report.scope, /not (executed|run)/i);
});

test('Audit: report lists stack, summary.ok, and summary.attention', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
    'SECURITY.md': '# Disclosure\n',
    LICENSE: 'MIT\n',
    'package.json': JSON.stringify({
      name: 'cli',
      mcpName: 'io.github.demo/cli',
      scripts: { 'qa:starter': 'true', 'type-check': 'true', test: 'true' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"',
    'dist/index.js': 'export {};\n',
    '.gitignore': '.env\n',
    '.github/workflows/ci.yml': 'name: CI\n',
    '.git/config': '[remote "origin"]\n  url = https://github.com/org/repo.git\n',
  });
  assert.deepEqual(report.stack.languages, ['node']);
  assert.equal(report.stack.isWebProject, false);
  assert.equal(report.stack.detectedForge, 'github');
  assert.ok(report.summary.ok.length >= 8, 'most checks should be listed as ok');
  assert.ok(
    report.summary.ok.some((line) => line.includes('SECURITY.md present')),
    'passing disclosure check appears under summary.ok',
  );
  assert.ok(
    report.summary.attention.some((line) => line.includes('private key')),
    'failing key hygiene appears under summary.attention',
  );
  assert.equal(report.summary.ok.length + report.summary.attention.length, report.totalChecks);
});

test('Audit: pure Rust CLI project (e.g. mdbro) passes without Node.js artifacts', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    'Cargo.toml': '[package]\nname = "mdbro"\nversion = "0.1.0"\n',
    '.gitignore': 'target/\n',
  });
  const blockers = report.results.filter((r) => r.severity === 'blocker' && !r.passed);
  assert.equal(blockers.length, 0);
  const qaCheck = report.results.find((r) => r.category === 'quality');
  assert.equal(qaCheck?.passed, true);
  assert.match(qaCheck?.details || '', /Rust/i);
});

test('Audit: pure Go project passes without package.json or security.txt', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    'go.mod': 'module example.com/service\n',
    '.gitignore': 'bin/\n',
  });
  const blockers = report.results.filter((r) => r.severity === 'blocker' && !r.passed);
  assert.equal(blockers.length, 0);
});

test('Audit: Node CLI/MCP with dist/ and SECURITY.md does not require security.txt', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    LICENSE: 'MIT\n',
    'package.json': JSON.stringify({
      name: 'example-mcp',
      scripts: { 'qa:starter': 'true', 'type-check': 'true', test: 'true' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"',
    'dist/index.js': 'export {};\n',
    '.gitignore': '.env\n*.pem\n*.key\n',
    '.github/workflows/ci.yml': 'name: CI\n',
  });
  const secCheck = expectCheck(report, 'SECURITY.md present', { passed: true });
  assert.match(secCheck?.details || '', /security\.txt not required/i);
  assert.ok(
    !report.recommendations.some((rec) => rec.includes('security.txt')),
    'must not recommend security.txt for non-web Node packages',
  );
});

test('Audit: Vite website without security.txt fails web disclosure check', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    LICENSE: 'MIT\n',
    'index.html': '<!doctype html><title>app</title>\n',
    'vite.config.ts': 'export default {};\n',
    'public/favicon.ico': '',
    'package.json': JSON.stringify({
      scripts: { 'qa:starter': 'true', 'type-check': 'true', test: 'true' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"',
    '.gitignore': '.env\n*.pem\n',
    '.github/workflows/ci.yml': 'name: CI\n',
  });
  expectCheck(report, 'security.txt present', { passed: false, severity: 'blocker' });
  assert.ok(report.recommendations.some((rec) => rec.includes('security.txt')));
});

test('Audit: website with SECURITY.md still requires security.txt', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Disclosure\n',
    LICENSE: 'MIT\n',
    'index.html': '<!doctype html><title>app</title>\n',
    'vite.config.ts': 'export default {};\n',
    'public/favicon.ico': '',
    'package.json': JSON.stringify({
      scripts: { 'qa:starter': 'true', 'type-check': 'true', test: 'true' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"',
    '.gitignore': '.env\n*.pem\n*.key\n',
    '.github/workflows/ci.yml': 'name: CI\n',
  });
  const sec = expectCheck(report, 'security.txt present', { passed: false, severity: 'blocker' });
  assert.match(sec.details, /web projects should also publish/i);
});

test('Audit: non-web project without SECURITY.md warns for missing disclosure', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    LICENSE: 'MIT\n',
    'Cargo.toml': '[package]\nname = "cli"\nversion = "0.1.0"\n',
    'Cargo.lock': '# lock\n',
    '.gitignore': 'target/\n',
  });
  const sec = expectCheck(report, 'SECURITY.md present', { passed: false, severity: 'warning' });
  assert.match(sec.details, /No SECURITY\.md found/i);
});

test('Audit: flags expired exceptions in .qa-exceptions.yaml as blocker', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    'Cargo.toml': '[package]\nname = "app"\n',
    '.gitignore': 'target/\n',
    '.qa-exceptions.yaml':
      'exceptions:\n  - id: EXC-001\n    expires_at: "2020-01-01"\n    reason: "Old expired exception"\n',
  });
  const excCheck = expectCheck(report, '.qa-exceptions.yaml present', {
    passed: false,
    severity: 'blocker',
  });
  assert.match(excCheck?.details || '', /expired entry/i);
  assert.ok(report.recommendations.some((rec) => rec.includes('expired exceptions')));
});

test('Audit: active unexpired exceptions in .qa-exceptions.yaml pass without blocker', () => {
  const futureYear = new Date().getFullYear() + 2;
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    'Cargo.toml': '[package]\nname = "app"\n',
    '.gitignore': 'target/\n',
    '.qa-exceptions.yaml': `exceptions:\n  - id: EXC-002\n    expires_at: "${futureYear}-12-31"\n    reason: "Active temporary exception"\n`,
  });
  const excCheck = expectCheck(report, '.qa-exceptions.yaml present', { passed: true });
  assert.match(excCheck?.details || '', /active/i);
});

test('Audit: Addition 1 - missing root LICENSE flags warning recommendation', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
  });
  expectCheck(report, 'LICENSE file present', {
    passed: false,
    severity: 'warning',
  });
  assert.ok(report.recommendations.some((rec) => rec.includes('LICENSE or COPYING')));
});

test('Audit: Addition 2 - missing dependency lockfile on Node repo flags warning', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
    'package.json': JSON.stringify({ name: 'test-app' }),
  });
  const lockCheck = expectCheck(report, 'dependency lockfile present', {
    passed: false,
    severity: 'warning',
  });
  assert.match(lockCheck?.details || '', /lockfile/i);
  assert.ok(report.recommendations.some((rec) => rec.includes('lockfile')));
});

test('Audit: Addition 3 - missing automated test suite on Node repo flags blocker', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
    'package.json': JSON.stringify({ name: 'test-app', scripts: {} }),
  });
  expectCheck(report, 'automated test suite declared', {
    passed: false,
    severity: 'blocker',
  });
  assert.ok(report.recommendations.some((rec) => rec.includes('automated test runner script')));
});

test('Audit: Addition 4 - missing CI workflow definition flags advisory info without blocking', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
  });
  expectCheck(report, 'CI workflow definition present', {
    passed: false,
    severity: 'info',
  });
  assert.ok(report.recommendations.some((rec) => rec.includes('CI workflow configuration')));
});

test('Audit: Addition 5 - raw private key file in root flags blocker', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
    '.gitignore': '.env\n',
    'server.key': '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n',
  });
  const keyCheck = expectCheck(report, 'private key and secret hygiene in .gitignore', {
    passed: false,
    severity: 'blocker',
  });
  assert.match(keyCheck?.details || '', /Raw private key/i);
});

test('Audit: Java project passes with Maven/Gradle quality gates and type safety', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    LICENSE: 'Apache 2.0\n',
    'pom.xml': '<project><modelVersion>4.0.0</modelVersion></project>\n',
    '.gitignore': 'target/\n',
    '.github/workflows/ci.yml': 'name: Java CI\n',
    'src/test/java/AppTest.java': 'class AppTest {}\n',
  });
  const blockers = report.results.filter((r) => r.severity === 'blocker' && !r.passed);
  assert.equal(blockers.length, 0);
  const qaCheck = report.results.find((r) => r.name.includes('java quality gates'));
  assert.equal(qaCheck?.passed, true);
  const typeCheck = report.results.find((r) => r.name.includes('javac'));
  assert.equal(typeCheck?.passed, true);
});

test('Audit: C/C++ project passes with CMake/Makefile quality gates and type safety', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    LICENSE: 'MIT\n',
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20)\nproject(my_engine)\n',
    Makefile: 'all:\n\tcc main.c\ntest:\n\tctest\n',
    '.gitignore': 'build/\n',
    '.github/workflows/ci.yml': 'name: C++ CI\n',
    'tests/test_main.c': 'int main() { return 0; }\n',
  });
  const blockers = report.results.filter((r) => r.severity === 'blocker' && !r.passed);
  assert.equal(blockers.length, 0);
  const qaCheck = report.results.find((r) => r.name.includes('c-cpp quality gates'));
  assert.equal(qaCheck?.passed, true);
});

test('Audit: PHP project passes with Composer and PHPUnit/PHPStan gates', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    LICENSE: 'MIT\n',
    'composer.json': JSON.stringify({ name: 'acme/service', require: {} }),
    'composer.lock': JSON.stringify({}),
    'phpstan.neon': 'parameters:\n  level: max\n',
    'phpunit.xml': '<phpunit></phpunit>\n',
    '.gitignore': 'vendor/\n',
    '.github/workflows/ci.yml': 'name: PHP CI\n',
  });
  const blockers = report.results.filter((r) => r.severity === 'blocker' && !r.passed);
  assert.equal(blockers.length, 0);
  const qaCheck = report.results.find((r) => r.name.includes('php quality gates'));
  assert.equal(qaCheck?.passed, true);
  const typeCheck = report.results.find((r) => r.name.includes('PHPStan'));
  assert.equal(typeCheck?.passed, true);
});

test('Audit: Shell project passes without Node/Rust artifacts', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    LICENSE: 'MIT\n',
    'scripts/deploy.sh': '#!/usr/bin/env bash\necho deploy\n',
    'scripts/qa.sh': '#!/usr/bin/env bash\necho qa\n',
    Makefile: 'test:\n\tbats tests/\n',
    '.gitignore': '.env\n',
    '.shellcheckrc': 'disable=SC2086\n',
    '.github/workflows/ci.yml': 'name: Shell CI\n',
  });
  const blockers = report.results.filter((r) => r.severity === 'blocker' && !r.passed);
  assert.equal(blockers.length, 0);
  const qaCheck = report.results.find((r) => r.name.includes('shell quality gates'));
  assert.equal(qaCheck?.passed, true);
});

test('Audit: missing AGENTS.md in agent-configured repository flags warning and requires attention', () => {
  const report = auditOf({
    LICENSE: 'MIT\n',
    'SECURITY.md': '# Disclosure\n',
    '.gitignore': '.env\n',
    '.cursor/rules/qa.md': '# Cursor QA rules\n',
  });
  const agentsCheck = expectCheck(report, 'AGENTS.md present', {
    passed: false,
    severity: 'warning',
  });
  assert.match(
    agentsCheck?.details || '',
    /Recommended to provide repository-level QA guidelines/i,
  );
  assert.equal(report.status, 'needs_attention');
  assert.match(report.prerequisites, /\d+\/\d+ met/);
});

test('Audit: missing AGENTS.md in human-only repository passes with advisory info and status ready', () => {
  const report = auditOf({
    LICENSE: 'MIT\n',
    'SECURITY.md': '# Disclosure\n',
    '.gitignore': '.env\n',
    'scripts/qa.sh': '#!/usr/bin/env bash\nexit 0\n',
    'Cargo.toml': '[package]\nname = "cli"\nversion = "0.1.0"\n',
    'Cargo.lock': '# lock\n',
    'deny.toml': '[licenses]\n',
  });
  const agentsCheck = expectCheck(report, 'AGENTS.md present', { passed: true, severity: 'info' });
  assert.match(agentsCheck?.details || '', /Optional for human-only workflows/i);
  assert.equal(report.status, 'ready');
  assert.equal(report.score, 100);
});

test('Audit Robustness: commented .gitignore line (# .env) does not pass as ignoring .env', () => {
  const report = auditOf({
    'AGENTS.md': '',
    '.gitignore': '# .env\n# *.key\n',
    '.env': 'SECRET=123',
  });
  expectCheck(report, '.gitignore mentions .env', {
    passed: false,
    severity: 'blocker',
  });
});

test('Audit Robustness: negated .gitignore line (!.env) does not pass as ignoring .env', () => {
  const report = auditOf({
    'AGENTS.md': '',
    '.gitignore': '.env\n!.env\n',
    '.env': 'SECRET=123',
  });
  expectCheck(report, '.gitignore mentions .env', {
    passed: false,
    severity: 'blocker',
  });
});

test('Audit Robustness: private key in subfolder (certs/server.key) flags blocker', () => {
  const report = auditOf({
    'AGENTS.md': '',
    '.gitignore': '.env\n',
    'certs/server.key': '-----BEGIN PRIVATE KEY-----\nMIIE...\n',
  });
  const keyCheck = expectCheck(report, 'private key and secret hygiene in .gitignore', {
    passed: false,
    severity: 'blocker',
  });
  assert.match(keyCheck?.details || '', /certs\/server\.key/);
});

test('Audit Robustness: alternative expiration syntax (valid_until / expiry) in .qa-exceptions.yaml flags blocker', () => {
  const report = auditOf({
    'AGENTS.md': '',
    'Cargo.toml': '[package]\nname = "test"\n',
    '.qa-exceptions.yaml':
      'exceptions:\n  - id: EXC-999\n    valid_until: "2021-01-01"\n    reason: "Legacy waiver"\n',
  });
  const excCheck = expectCheck(report, '.qa-exceptions.yaml present', {
    passed: false,
    severity: 'blocker',
  });
  assert.match(excCheck?.details || '', /expired entry/i);
});

test('Audit Robustness: polyglot project credits secondary stack test suite', () => {
  const report = auditOf({
    'AGENTS.md': '',
    'package.json': JSON.stringify({ name: 'frontend-and-backend', scripts: {} }),
    'Cargo.toml': '[package]\nname = "backend"\n',
  });
  const testCheck = expectCheck(report, 'automated test suite declared', { passed: true });
  assert.match(testCheck?.details || '', /Rust test framework/i);
});

test('Audit: Multi-Forge CI detection recognizes diverse providers', () => {
  const providers: Record<string, string>[] = [
    { '.gitlab-ci.yml': 'stages:\n  - test\n' },
    { '.gitlab/ci/test.yml': 'test:\n  script: echo 1\n' },
    { '.forgejo/workflows/ci.yml': 'name: Forgejo CI\n' },
    { '.gitea/workflows/ci.yaml': 'name: Gitea CI\n' },
    { '.woodpecker.yml': 'pipeline:\n  test:\n    image: node\n' },
    { '.woodpecker/ci.yaml': 'pipeline:\n  test:\n    image: node\n' },
    { '.cirrus.yml': 'test_task:\n  script: echo 1\n' },
  ];

  for (const files of providers) {
    assert.equal(passingCiCheck(files).severity, 'info', JSON.stringify(files));
  }
});

test('Audit: Local QA runners satisfy CI requirement without cloud CI', () => {
  const runners: Record<string, string>[] = [
    { 'scripts/qa': '#!/usr/bin/env bash\necho qa\n' },
    { justfile: 'test:\n\tcargo test\n' },
    { 'Taskfile.yml': 'version: "3"\n' },
    { 'Taskfile.yaml': 'version: "3"\n' },
    { Taskfile: 'version: "3"\n' },
    { '.githooks/pre-push': '#!/bin/sh\nexit 0\n' },
    { '.git/hooks/pre-push': '#!/bin/sh\nexit 0\n' },
    { '.git/hooks/pre-commit': '#!/bin/sh\nexit 0\n' },
    { Makefile: 'qa:\n\t./scripts/qa.sh\n' },
    { Makefile: 'test:\n\tpytest\n' },
  ];

  for (const files of runners) {
    assert.match(passingCiCheck(files).details || '', /Local QA automation detected/i);
  }
});

test('Audit: Context-aware recommendations for forge and offline CLI projects', () => {
  // 1. GitLab remote
  const gitlabReport = auditOf({
    '.git/config': '[remote "origin"]\n  url = git@gitlab.com:org/repo.git\n',
  });
  assert.ok(gitlabReport.recommendations.some((r) => r.includes('GitLab CI')));

  // 2. Forgejo remote
  const forgejoReport = auditOf({
    '.git/config': '[remote "origin"]\n  url = https://codeberg.org/org/repo.git\n',
  });
  assert.ok(forgejoReport.recommendations.some((r) => r.includes('Forgejo/Gitea')));

  // 3. Bitbucket remote
  const bitbucketReport = auditOf({
    '.git/config': '[remote "origin"]\n  url = https://bitbucket.org/org/repo.git\n',
  });
  assert.ok(bitbucketReport.recommendations.some((r) => r.includes('Bitbucket Pipelines')));

  // 4. Azure DevOps remote
  const azureReport = auditOf({
    '.git/config': '[remote "origin"]\n  url = https://dev.azure.com/org/proj/_git/repo\n',
  });
  assert.ok(azureReport.recommendations.some((r) => r.includes('Azure Pipelines')));

  // 5. Offline CLI project (no remote, CLI stack)
  const cliReport = auditOf({
    'Cargo.toml': '[package]\nname = "mycli"\n',
  });
  assert.ok(cliReport.recommendations.some((r) => r.includes('canonical local QA runner')));

  // 6. Web project with GitHub remote
  const githubWebReport = auditOf({
    'index.html': '<html></html>\n',
    '.git/config': '[remote "origin"]\n  url = https://github.com/org/repo.git\n',
  });
  assert.ok(githubWebReport.recommendations.some((r) => r.includes('.github/workflows/ci.yml')));
});

test('Audit: Agent configuration folders without AGENTS.md', () => {
  for (const folder of ['.agents/config.json', '.claude/config.json', '.windsurf/rules.md']) {
    const report = auditOf({
      [folder]: '{}',
    });
    expectCheck(report, 'AGENTS.md present', {
      passed: false,
      severity: 'warning',
    });
    assert.ok(report.recommendations.some((r) => r.includes('Create an AGENTS.md')));
  }
});

test('Audit: Unreadable or directory .git/config handled safely', () => {
  const report = auditOf({
    '.git/config/dummy': 'nested',
  });
  assert.ok(report.totalChecks > 0);
});
