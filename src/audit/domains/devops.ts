import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AuditCheckResult, AuditContext } from '../types.js';

export function checkCiWorkflows(ctx: AuditContext): AuditCheckResult {
  const checkCiDir = (fullDir: string): boolean =>
    fs.statSync(fullDir).isDirectory() &&
    fs.readdirSync(fullDir).some((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  const workflowDir = ctx.findUp('.github/workflows');
  const hasGithubCi = workflowDir !== null && checkCiDir(workflowDir);

  const hasCiWorkflow =
    hasGithubCi ||
    ctx.fileExists('.gitlab-ci.yml') ||
    ctx.parentFileExists('.gitlab-ci.yml') ||
    ctx.fileExists('.circleci/config.yml') ||
    ctx.parentFileExists('.circleci/config.yml') ||
    ctx.fileExists('azure-pipelines.yml') ||
    ctx.parentFileExists('azure-pipelines.yml') ||
    ctx.fileExists('bitbucket-pipelines.yml') ||
    ctx.parentFileExists('bitbucket-pipelines.yml') ||
    ctx.fileExists('Jenkinsfile') ||
    ctx.parentFileExists('Jenkinsfile') ||
    ctx.fileExists('.travis.yml') ||
    ctx.fileExists('.woodpecker.yml') ||
    ctx.fileExists('.drone.yml');

  return {
    category: 'devops',
    name: 'CI workflow definition present',
    passed: Boolean(hasCiWorkflow),
    severity: 'warning',
    details: hasCiWorkflow
      ? 'CI workflow definition file present (workflow execution not evaluated).'
      : 'No CI workflow configuration found (.github/workflows, .gitlab-ci.yml, etc.).',
  };
}

export function auditDevops(ctx: AuditContext): AuditCheckResult[] {
  return [checkCiWorkflows(ctx)];
}
