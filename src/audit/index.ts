import { validateSafeProjectPath } from '../security/path-guard.js';
import { createAuditContext } from './context.js';
import { auditDevops } from './domains/devops.js';
import { auditGovernance } from './domains/governance.js';
import { auditQuality } from './domains/quality.js';
import { auditSecurity } from './domains/security.js';
import { auditSupplyChain } from './domains/supply-chain.js';
import type { AuditCheckResult, AuditContext, AuditOptions, AuditReport } from './types.js';

export * from './constants.js';
export * from './context.js';
export * from './domains/devops.js';
export * from './domains/governance.js';
export * from './domains/quality.js';
export * from './domains/security.js';
export * from './domains/supply-chain.js';
export * from './languages/index.js';
export * from './types.js';

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

  // Advisory checks with severity 'info' do not dock the quality score when absent.
  const scoreEligibleChecks = results.filter((r) => r.severity !== 'info' || r.passed);
  const passedScoreChecks = scoreEligibleChecks.filter((r) => r.passed).length;
  const score = Math.round((passedScoreChecks / scoreEligibleChecks.length) * 100);

  // Status is ready if all required blocker and warning checks pass. Advisory info checks do not block readiness.
  const hasBlockersOrWarnings = results.some(
    (r) => !r.passed && (r.severity === 'blocker' || r.severity === 'warning'),
  );
  const status: 'ready' | 'needs_attention' = hasBlockersOrWarnings ? 'needs_attention' : 'ready';
  const prerequisites = `${passedChecks}/${totalChecks} met`;

  const recommendations = buildRecommendations(ctx, results);

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

function getForgeCiRecommendation(ctx: AuditContext): string {
  if (ctx.detectedForge === 'gitlab') {
    return 'Add a GitLab CI workflow configuration (.gitlab-ci.yml) or local QA runner (scripts/qa.sh / Makefile).';
  }
  if (ctx.detectedForge === 'forgejo') {
    return 'Add a Forgejo/Gitea Actions workflow configuration (.forgejo/workflows/ci.yml) or local QA runner.';
  }
  if (ctx.detectedForge === 'bitbucket') {
    return 'Add a Bitbucket Pipelines configuration (bitbucket-pipelines.yml) or local QA runner.';
  }
  if (ctx.detectedForge === 'azure') {
    return 'Add an Azure Pipelines configuration (azure-pipelines.yml) or local QA runner.';
  }
  if (ctx.stack.isOfflineCliProject) {
    return 'Add a canonical local QA runner (scripts/qa.sh or Makefile with qa: target) or CI workflow for automated validation.';
  }
  return 'Add a CI workflow configuration (e.g. .github/workflows/ci.yml) or local QA runner (scripts/qa.sh) for automated PR validation.';
}

function buildRecommendations(ctx: AuditContext, results: AuditCheckResult[]): string[] {
  const recommendations: string[] = [];

  const agentsCheck = results.find((r) => r.name === 'AGENTS.md present');
  if (agentsCheck && !agentsCheck.passed) {
    recommendations.push(
      'Create an AGENTS.md in project root enforcing Fredo QA Skills rules for AI assistants.',
    );
  }

  const exceptionsCheck = results.find((r) => r.name === '.qa-exceptions.yaml present');
  if (exceptionsCheck && !exceptionsCheck.passed) {
    recommendations.push('Review and renew or remove expired exceptions in .qa-exceptions.yaml.');
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
    recommendations.push(getForgeCiRecommendation(ctx));
  }

  return recommendations;
}
