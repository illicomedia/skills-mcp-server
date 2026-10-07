// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { runComplianceAudit } from '../audit.js';

const OVERCLAIMS = /\b(valid|correctly|compliant|ensures?|verified|soundness)\b/i;

function auditOf(files: Record<string, string>): ReturnType<typeof runComplianceAudit> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-audit-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    return runComplianceAudit(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Audit: passing checks only claim file presence, never validity', () => {
  const report = auditOf({
    'AGENTS.md': '',
    '.qa-exceptions.yaml': 'not: [valid yaml',
    'public/.well-known/security.txt': '',
    '.gitignore': '.env\n',
    'package.json': JSON.stringify({ scripts: { 'qa:starter': 'true', 'type-check': 'true' } }),
  });
  assert.equal(report.failedChecks, 0);
  for (const result of report.results) {
    assert.doesNotMatch(`${result.name} ${result.details}`, OVERCLAIMS, result.name);
  }
});

test('Audit: the report states its scope', () => {
  const report = auditOf({});
  assert.match(report.scope, /presence/i);
  assert.match(report.scope, /not (executed|run)/i);
});
