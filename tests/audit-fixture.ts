import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LANGUAGE_RULES, type runComplianceAudit } from '../dist/audit/index.js';

/**
 * A throwaway project under `root`: names ending in / are directories, other names are files
 * with the content `contentOf(name)` (empty by default).
 */
export function makeProject(
  root: string,
  names: string[],
  contentOf: (name: string) => string = () => '',
): string {
  const dir = fs.mkdtempSync(path.join(root, 'p-'));
  for (const name of names) {
    const full = path.join(dir, name);
    if (name.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contentOf(name));
    }
  }
  return dir;
}

/** A language rule by id; fails the test when it does not exist. */
export function rule(id: string) {
  const found = LANGUAGE_RULES.find((candidate) => candidate.id === id);
  assert.ok(found, id);
  return found;
}

type AuditReport = ReturnType<typeof runComplianceAudit>;

/** Finds an audit check by name and asserts its outcome; returns it for further assertions. */
export function expectCheck(
  report: AuditReport,
  name: string,
  expected: { passed: boolean; severity?: string; context?: string },
): AuditReport['results'][number] {
  const label = expected.context ? `${name} (${expected.context})` : name;
  const check = report.results.find((result) => result.name === name);
  assert.ok(check, `no check named ${label}`);
  assert.equal(check.passed, expected.passed, label);
  if (expected.severity !== undefined) {
    assert.equal(check.severity, expected.severity, label);
  }
  return check;
}
