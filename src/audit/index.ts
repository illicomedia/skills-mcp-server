import type { AuditCheckResult, AuditReport, AuditOptions } from './types.js';
import { createAuditContext } from './context.js';
import { auditGovernance } from './domains/governance.js';
import { auditSecurity } from './domains/security.js';
import { auditQuality } from './domains/quality.js';
import { auditSupplyChain } from './domains/supply-chain.js';
import { auditDevops } from './domains/devops.js';
import { validateSafeProjectPath } from '../security/path-guard.js';

export * from './types.js';
export * from './context.js';
export * from './languages/index.js';
export * from './domains/governance.js';
export * from './domains/security.js';
export * from './domains/quality.js';
export * from './domains/supply-chain.js';
export * from './domains/devops.js';

const AUDIT_SCOPE =
  'Fast preflight sanity check: verifies presence of scaffolding, agent directives, and baseline hygiene. Gates are not executed and compilers are not run.';

export function runComplianceAudit(projectPath: string, options?: AuditOptions): AuditReport {
  const safePath = validateSafeProjectPath(projectPath, 'quick_check');

  if (!options?.confirm) {
    return {
      projectPath: safePath,
      timestamp: new Date().toISOString(),
      status: 'needs_attention',
      prerequisites: 'Confirmation required',
      score: 0,
      scope: AUDIT_SCOPE,
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      results: [],
      recommendations: [
        `Directory traversal inspection on "${safePath}" requires user confirmation. Re-run quick_check with confirm: true to scan project files.`,
      ],
      previewOnly: true,
      requiresConfirmation: true,
      message: `Preview: preflight audit is ready to inspect "${safePath}". Directory traversal requires explicit user confirmation. Set confirm: true to proceed.`,
    };
  }

  const ctx = createAuditContext(safePath);

  // Run audits by domain (preserving exact canonical check order 1-11)
  const results: AuditCheckResult[] = [
    ...auditGovernance(ctx),
    ...auditSecurity(ctx),
    ...auditQuality(ctx),
    ...auditSupplyChain(ctx),
    ...auditDevops(ctx),
  ];

  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.passed).length;
  const failedChecks = totalChecks - passedChecks;
  const score = Math.round((passedChecks / totalChecks) * 100);
  const status: 'ready' | 'needs_attention' = failedChecks === 0 ? 'ready' : 'needs_attention';
  const prerequisites = `${passedChecks}/${totalChecks} met`;

  // Recommendations extraction
  const recommendations: string[] = [];

  const agentsCheck = results.find((r) => r.name === 'AGENTS.md present');
  if (agentsCheck && !agentsCheck.passed) {
    recommendations.push(
      'Create an AGENTS.md in project root enforcing Fredo QA Skills rules for AI assistants.',
    );
  }

  const exceptionsCheck = results.find((r) => r.name === '.qa-exceptions.yaml present');
  if (exceptionsCheck && !exceptionsCheck.passed) {
    recommendations.push(
      'Review and renew or remove expired exceptions in .qa-exceptions.yaml.',
    );
  }

  const licenseCheck = results.find((r) => r.name === 'LICENSE file present');
  if (licenseCheck && !licenseCheck.passed) {
    recommendations.push(
      'Add a LICENSE or COPYING file in project root declaring usage and distribution terms.',
    );
  }

  const secCheck = results.find(
    (r) => r.name === 'security.txt present' || r.name === 'SECURITY.md present',
  );
  if (secCheck && !secCheck.passed) {
    recommendations.push(
      ctx.stack.isWebProject
        ? 'Generate public/.well-known/security.txt with RFC 9116 Contact and Expires directives.'
        : 'Add a SECURITY.md file at repository root with responsible vulnerability disclosure instructions.',
    );
  }

  const keyCheck = results.find((r) => r.name === 'private key and secret hygiene in .gitignore');
  if (keyCheck && !keyCheck.passed) {
    if (keyCheck.severity === 'blocker') {
      recommendations.push(
        'Remove unignored private key or certificate files from the workspace root immediately.',
      );
    } else {
      recommendations.push(
        'Add pattern rules to .gitignore ignoring private key and credential files (*.pem, *.key, *.p12).',
      );
    }
  }

  const qaCheck = results.find((r) => r.category === 'quality' && r.name.includes('qa:'));
  if (qaCheck && !qaCheck.passed && ctx.stack.isNode) {
    recommendations.push(
      'Add "qa:starter" and "qa:standard" scripts to package.json for local and CI parity.',
    );
  }

  const testCheck = results.find((r) => r.name === 'automated test suite declared');
  if (testCheck && !testCheck.passed) {
    recommendations.push(
      'Declare an automated test runner script in package manifest or provide a tests/ directory.',
    );
  }

  const lockCheck = results.find((r) => r.name === 'dependency lockfile present');
  if (lockCheck && !lockCheck.passed && ctx.stack.hasManifest) {
    recommendations.push(
      'Commit a dependency lockfile (e.g. pnpm-lock.yaml, Cargo.lock, go.sum) for reproducible dependency resolution.',
    );
  }

  const ciCheck = results.find((r) => r.name === 'CI workflow definition present');
  if (ciCheck && !ciCheck.passed) {
    recommendations.push(
      'Add a CI workflow configuration (e.g. .github/workflows/ci.yml) for automated PR validation.',
    );
  }

  return {
    projectPath: ctx.resolvedPath,
    timestamp: new Date().toISOString(),
    status,
    prerequisites,
    score,
    scope: AUDIT_SCOPE,
    totalChecks,
    passedChecks,
    failedChecks,
    results,
    recommendations,
  };
}
