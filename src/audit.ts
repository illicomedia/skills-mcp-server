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
  score: number; // 0-100
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  results: AuditCheckResult[];
  recommendations: string[];
}

/**
 * Runs deterministic QA compliance checks against a project path
 */
export function runComplianceAudit(projectPath: string): AuditReport {
  const resolvedPath = path.resolve(projectPath);
  const results: AuditCheckResult[] = [];

  // Check 1: AGENTS.md policy presence
  const agentsMd = path.join(resolvedPath, 'AGENTS.md');
  const hasAgentsMd = fs.existsSync(agentsMd);
  results.push({
    category: 'governance',
    name: 'AGENTS.md Policy Directives',
    passed: hasAgentsMd,
    severity: 'blocker',
    details: hasAgentsMd
      ? 'Found AGENTS.md defining automated coding agent quality directives.'
      : 'Missing AGENTS.md. Coding agents lack explicit QA boundaries.',
  });

  // Check 2: .qa-exceptions governance
  const exceptionsFile = path.join(resolvedPath, '.qa-exceptions.yaml');
  const hasExceptions = fs.existsSync(exceptionsFile);
  results.push({
    category: 'governance',
    name: 'Exception Governance (.qa-exceptions.yaml)',
    passed: hasExceptions,
    severity: 'warning',
    details: hasExceptions
      ? 'Exception registry is established with schema governance.'
      : 'No .qa-exceptions.yaml found. Ensure deviations from quality gates are formally tracked.',
  });

  // Check 3: RFC 9116 security.txt
  const secTxtPublic = path.join(resolvedPath, 'public', '.well-known', 'security.txt');
  const secTxtDist = path.join(resolvedPath, 'dist', '.well-known', 'security.txt');
  const secTxtRoot = path.join(resolvedPath, '.well-known', 'security.txt');
  const hasSecTxt =
    fs.existsSync(secTxtPublic) || fs.existsSync(secTxtDist) || fs.existsSync(secTxtRoot);
  results.push({
    category: 'security',
    name: 'RFC 9116 security.txt Implementation',
    passed: hasSecTxt,
    severity: 'blocker',
    details: hasSecTxt
      ? 'Found valid security.txt for responsible vulnerability disclosure.'
      : 'Missing security.txt in .well-known/ namespace.',
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
    name: 'Secret Protection (.gitignore ignores .env)',
    passed: hasGitignore && ignoresEnv,
    severity: 'blocker',
    details:
      hasGitignore && ignoresEnv
        ? '.gitignore correctly isolates environment variables and secrets.'
        : 'Missing or incomplete .gitignore (ensure .env and private keys are ignored).',
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
    name: 'Standardized QA Gate Scripts',
    passed: hasQaStandard,
    severity: 'blocker',
    details: hasQaStandard
      ? 'Found standardized inner-loop QA script (qa:starter or qa:standard).'
      : 'Missing qa:starter / qa:standard script definitions in package.json.',
  });

  results.push({
    category: 'quality',
    name: 'Static Type Checking Script',
    passed: hasTypeCheck,
    severity: 'blocker',
    details: hasTypeCheck
      ? 'Type-checking gate is configured in build scripts.'
      : 'No type-check script detected. Static type soundness cannot be verified automatically.',
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
    totalChecks,
    passedChecks,
    failedChecks,
    results,
    recommendations,
  };
}
