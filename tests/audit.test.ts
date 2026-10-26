import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { runComplianceAudit } from '../dist/audit.js';

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
    'LICENSE': 'MIT',
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

test('Audit: flags expired exceptions in .qa-exceptions.yaml as blocker', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    'Cargo.toml': '[package]\nname = "app"\n',
    '.gitignore': 'target/\n',
    '.qa-exceptions.yaml': 'exceptions:\n  - id: EXC-001\n    expires_at: "2020-01-01"\n    reason: "Old expired exception"\n',
  });
  const excCheck = report.results.find((r) => r.name === '.qa-exceptions.yaml present');
  assert.equal(excCheck?.passed, false);
  assert.equal(excCheck?.severity, 'blocker');
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
  const excCheck = report.results.find((r) => r.name === '.qa-exceptions.yaml present');
  assert.equal(excCheck?.passed, true);
  assert.match(excCheck?.details || '', /active/i);
});

test('Audit: Addition 1 - missing root LICENSE flags warning recommendation', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
  });
  const licCheck = report.results.find((r) => r.name === 'LICENSE file present');
  assert.equal(licCheck?.passed, false);
  assert.equal(licCheck?.severity, 'warning');
  assert.ok(report.recommendations.some((rec) => rec.includes('LICENSE or COPYING')));
});

test('Audit: Addition 2 - missing dependency lockfile on Node repo flags warning', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
    'package.json': JSON.stringify({ name: 'test-app' }),
  });
  const lockCheck = report.results.find((r) => r.name === 'dependency lockfile present');
  assert.equal(lockCheck?.passed, false);
  assert.equal(lockCheck?.severity, 'warning');
  assert.match(lockCheck?.details || '', /lockfile/i);
  assert.ok(report.recommendations.some((rec) => rec.includes('lockfile')));
});

test('Audit: Addition 3 - missing automated test suite on Node repo flags blocker', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
    'package.json': JSON.stringify({ name: 'test-app', scripts: {} }),
  });
  const testCheck = report.results.find((r) => r.name === 'automated test suite declared');
  assert.equal(testCheck?.passed, false);
  assert.equal(testCheck?.severity, 'blocker');
  assert.ok(report.recommendations.some((rec) => rec.includes('automated test runner script')));
});

test('Audit: Addition 4 - missing CI workflow definition flags warning', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
  });
  const ciCheck = report.results.find((r) => r.name === 'CI workflow definition present');
  assert.equal(ciCheck?.passed, false);
  assert.equal(ciCheck?.severity, 'warning');
  assert.ok(report.recommendations.some((rec) => rec.includes('CI workflow configuration')));
});

test('Audit: Addition 5 - raw private key file in root flags blocker', () => {
  const report = auditOf({
    'AGENTS.md': '# QA\n',
    '.gitignore': '.env\n',
    'server.key': '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n',
  });
  const keyCheck = report.results.find((r) => r.name === 'private key and secret hygiene in .gitignore');
  assert.equal(keyCheck?.passed, false);
  assert.equal(keyCheck?.severity, 'blocker');
  assert.match(keyCheck?.details || '', /Raw private key/i);
});

test('Audit: Java project passes with Maven/Gradle quality gates and type safety', () => {
  const report = auditOf({
    'AGENTS.md': '# QA Policy\n',
    'SECURITY.md': '# Vulnerability Disclosure\n',
    'LICENSE': 'Apache 2.0\n',
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
    'LICENSE': 'MIT\n',
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20)\nproject(my_engine)\n',
    'Makefile': 'all:\n\tcc main.c\ntest:\n\tctest\n',
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
    'LICENSE': 'MIT\n',
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
    'LICENSE': 'MIT\n',
    'scripts/deploy.sh': '#!/usr/bin/env bash\necho deploy\n',
    'scripts/qa.sh': '#!/usr/bin/env bash\necho qa\n',
    'Makefile': 'test:\n\tbats tests/\n',
    '.gitignore': '.env\n',
    '.shellcheckrc': 'disable=SC2086\n',
    '.github/workflows/ci.yml': 'name: Shell CI\n',
  });
  const blockers = report.results.filter((r) => r.severity === 'blocker' && !r.passed);
  assert.equal(blockers.length, 0);
  const qaCheck = report.results.find((r) => r.name.includes('shell quality gates'));
  assert.equal(qaCheck?.passed, true);
});

test('Audit: missing AGENTS.md flags warning (not a blocker) and reports prerequisites status', () => {
  const report = auditOf({
    'LICENSE': 'MIT\n',
    'SECURITY.md': '# Disclosure\n',
    '.gitignore': '.env\n',
  });
  const agentsCheck = report.results.find((r) => r.name === 'AGENTS.md present');
  assert.equal(agentsCheck?.passed, false);
  assert.equal(agentsCheck?.severity, 'warning');
  assert.match(agentsCheck?.details || '', /Recommended to provide repository-level QA guidelines/i);
  assert.equal(report.status, 'needs_attention');
  assert.match(report.prerequisites, /\d+\/\d+ met/);
});

test('Audit Robustness: commented .gitignore line (# .env) does not pass as ignoring .env', () => {
  const report = auditOf({
    'AGENTS.md': '',
    '.gitignore': '# .env\n# *.key\n',
    '.env': 'SECRET=123',
  });
  const envCheck = report.results.find((r) => r.name === '.gitignore mentions .env');
  assert.equal(envCheck?.passed, false);
  assert.equal(envCheck?.severity, 'blocker');
});

test('Audit Robustness: negated .gitignore line (!.env) does not pass as ignoring .env', () => {
  const report = auditOf({
    'AGENTS.md': '',
    '.gitignore': '.env\n!.env\n',
    '.env': 'SECRET=123',
  });
  const envCheck = report.results.find((r) => r.name === '.gitignore mentions .env');
  assert.equal(envCheck?.passed, false);
  assert.equal(envCheck?.severity, 'blocker');
});

test('Audit Robustness: private key in subfolder (certs/server.key) flags blocker', () => {
  const report = auditOf({
    'AGENTS.md': '',
    '.gitignore': '.env\n',
    'certs/server.key': '-----BEGIN PRIVATE KEY-----\nMIIE...\n',
  });
  const keyCheck = report.results.find((r) => r.name === 'private key and secret hygiene in .gitignore');
  assert.equal(keyCheck?.passed, false);
  assert.equal(keyCheck?.severity, 'blocker');
  assert.match(keyCheck?.details || '', /certs\/server\.key/);
});

test('Audit Robustness: alternative expiration syntax (valid_until / expiry) in .qa-exceptions.yaml flags blocker', () => {
  const report = auditOf({
    'AGENTS.md': '',
    'Cargo.toml': '[package]\nname = "test"\n',
    '.qa-exceptions.yaml': 'exceptions:\n  - id: EXC-999\n    valid_until: "2021-01-01"\n    reason: "Legacy waiver"\n',
  });
  const excCheck = report.results.find((r) => r.name === '.qa-exceptions.yaml present');
  assert.equal(excCheck?.passed, false);
  assert.equal(excCheck?.severity, 'blocker');
  assert.match(excCheck?.details || '', /expired entry/i);
});

test('Audit Robustness: polyglot project credits secondary stack test suite', () => {
  const report = auditOf({
    'AGENTS.md': '',
    'package.json': JSON.stringify({ name: 'frontend-and-backend', scripts: {} }),
    'Cargo.toml': '[package]\nname = "backend"\n',
  });
  const testCheck = report.results.find((r) => r.name === 'automated test suite declared');
  assert.equal(testCheck?.passed, true);
  assert.match(testCheck?.details || '', /Rust test framework/i);
});



