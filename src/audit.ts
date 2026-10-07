// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AuditCheckResult {
  category: string;
  name: string;
  passed: boolean;
  severity: 'blocker' | 'warning' | 'info';
  details: string;
}

export interface AuditReport {
  projectPath: string;
  timestamp: string;
  /** Share of presence checks that found their file or script, 0-100. Not a compliance score. */
  score: number;
  scope: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  results: AuditCheckResult[];
  recommendations: string[];
}

const AUDIT_SCOPE =
  'File-presence checks only: gates are not executed and file contents are not validated. A full pass means the expected files exist, not that the project is compliant.';

/**
 * Checks that the files and scripts expected by Fredo QA Skills are present in a project.
 */
export function runComplianceAudit(projectPath: string): AuditReport {
  const resolvedPath = path.resolve(projectPath);
  const results: AuditCheckResult[] = [];

  // Check 1: AGENTS.md policy presence
  const agentsMd = path.join(resolvedPath, 'AGENTS.md');
  const hasAgentsMd = fs.existsSync(agentsMd);
  results.push({
    category: 'governance',
    name: 'AGENTS.md present',
    passed: hasAgentsMd,
    severity: 'blocker',
    details: hasAgentsMd
      ? 'AGENTS.md file present (content not evaluated).'
      : 'AGENTS.md not found. Coding agents have no repository-level QA instructions.',
  });

  // Check 2: .qa-exceptions governance
  const exceptionsFile = path.join(resolvedPath, '.qa-exceptions.yaml');
  const hasExceptions = fs.existsSync(exceptionsFile);
  results.push({
    category: 'governance',
    name: '.qa-exceptions.yaml present',
    passed: hasExceptions,
    severity: 'warning',
    details: hasExceptions
      ? 'Exception register file present (schema and expiry not checked).'
      : 'No .qa-exceptions.yaml found. Deviations from quality gates should be tracked there.',
  });

  // Check 3: RFC 9116 security.txt
  const secTxtPublic = path.join(resolvedPath, 'public', '.well-known', 'security.txt');
  const secTxtDist = path.join(resolvedPath, 'dist', '.well-known', 'security.txt');
  const secTxtRoot = path.join(resolvedPath, '.well-known', 'security.txt');
  const hasSecTxt =
    fs.existsSync(secTxtPublic) || fs.existsSync(secTxtDist) || fs.existsSync(secTxtRoot);
  results.push({
    category: 'security',
    name: 'security.txt present',
    passed: hasSecTxt,
    severity: 'blocker',
    details: hasSecTxt
      ? 'security.txt file present in a .well-known/ directory (RFC 9116 fields not checked).'
      : 'No security.txt found in public/, dist/, or root .well-known/ directories.',
  });

  // Check 4: Safe gitignore configuration
  const gitignore = path.join(resolvedPath, '.gitignore');
  const hasGitignore = fs.existsSync(gitignore);
  let ignoresEnv = false;
  if (hasGitignore) {
    const gitignoreContent = fs.readFileSync(gitignore, 'utf-8');
    ignoresEnv = gitignoreContent.includes('.env');
  }
  results.push({
    category: 'security',
    name: '.gitignore mentions .env',
    passed: hasGitignore && ignoresEnv,
    severity: 'blocker',
    details:
      hasGitignore && ignoresEnv
        ? '.gitignore contains the text ".env" (ignore rules and other secret files not evaluated).'
        : '.gitignore missing or does not mention .env (also ignore private keys and credentials).',
  });

  // Check 5: QA scripts in package.json
  const pkgJsonPath = path.join(resolvedPath, 'package.json');
  let hasQaStandard = false;
  let hasTypeCheck = false;
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      hasQaStandard = Boolean(pkg.scripts?.['qa:standard'] || pkg.scripts?.['qa:starter']);
      hasTypeCheck = Boolean(pkg.scripts?.['type-check'] || pkg.scripts?.['tsc']);
    } catch {
      // Ignored
    }
  }
  results.push({
    category: 'quality',
    name: 'qa:starter or qa:standard script declared',
    passed: hasQaStandard,
    severity: 'blocker',
    details: hasQaStandard
      ? 'package.json declares qa:starter or qa:standard (script not executed).'
      : 'No qa:starter / qa:standard script in package.json.',
  });

  results.push({
    category: 'quality',
    name: 'type-check script declared',
    passed: hasTypeCheck,
    severity: 'blocker',
    details: hasTypeCheck
      ? 'package.json declares a type-check script (script not executed).'
      : 'No type-check or tsc script in package.json.',
  });

  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.passed).length;
  const failedChecks = totalChecks - passedChecks;
  const score = Math.round((passedChecks / totalChecks) * 100);

  const recommendations: string[] = [];
  if (!hasAgentsMd) {
    recommendations.push(
      'Create an AGENTS.md in project root enforcing Fredo QA Skills rules for AI assistants.',
    );
  }
  if (!hasSecTxt) {
    recommendations.push(
      'Generate public/.well-known/security.txt with valid Contact and Expires directives.',
    );
  }
  if (!hasQaStandard) {
    recommendations.push(
      'Add "qa:starter" and "qa:standard" scripts to package.json to ensure local and CI parity.',
    );
  }

  return {
    projectPath: resolvedPath,
    timestamp: new Date().toISOString(),
    score,
    scope: AUDIT_SCOPE,
    totalChecks,
    passedChecks,
    failedChecks,
    results,
    recommendations,
  };
}
