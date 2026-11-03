import { isDirectory, listDir } from '../../security/path-guard.js';
import type { AuditCheckResult, AuditContext } from '../types.js';

function checkCiWorkflows(ctx: AuditContext): AuditCheckResult {
  const checkCiDir = (fullDir: string | null): boolean =>
    fullDir !== null &&
    isDirectory(fullDir) &&
    listDir(fullDir).some((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  const hasGithubCi = checkCiDir(ctx.findUp('.github/workflows'));
  const hasGitlabCi =
    ctx.fileExists('.gitlab-ci.yml') ||
    ctx.parentFileExists('.gitlab-ci.yml') ||
    checkCiDir(ctx.findUp('.gitlab/ci'));
  const hasForgejoCi =
    checkCiDir(ctx.findUp('.forgejo/workflows')) || checkCiDir(ctx.findUp('.gitea/workflows'));
  const hasWoodpeckerCi =
    ctx.fileExists('.woodpecker.yml') ||
    ctx.parentFileExists('.woodpecker.yml') ||
    checkCiDir(ctx.findUp('.woodpecker'));

  const hasCiWorkflow =
    hasGithubCi ||
    hasGitlabCi ||
    hasForgejoCi ||
    hasWoodpeckerCi ||
    ctx.fileExists('.circleci/config.yml') ||
    ctx.parentFileExists('.circleci/config.yml') ||
    ctx.fileExists('azure-pipelines.yml') ||
    ctx.parentFileExists('azure-pipelines.yml') ||
    ctx.fileExists('bitbucket-pipelines.yml') ||
    ctx.parentFileExists('bitbucket-pipelines.yml') ||
    ctx.fileExists('Jenkinsfile') ||
    ctx.parentFileExists('Jenkinsfile') ||
    ctx.fileExists('.travis.yml') ||
    ctx.fileExists('.drone.yml') ||
    ctx.fileExists('.cirrus.yml');

  if (hasCiWorkflow) {
    return {
      category: 'devops',
      name: 'CI workflow definition present',
      passed: true,
      severity: 'info',
      details: 'CI workflow definition file present (workflow execution not evaluated).',
    };
  }

  if (ctx.stack.hasLocalQaRunner) {
    return {
      category: 'devops',
      name: 'CI workflow definition present',
      passed: true,
      severity: 'info',
      details:
        'Local QA automation detected (scripts/qa.sh / Makefile). Cloud CI workflow is optional and depends on team deployment choices.',
    };
  }

  return {
    category: 'devops',
    name: 'CI workflow definition present',
    passed: false,
    severity: 'info',
    details:
      'No CI workflow configuration or local QA runner found (.github/workflows, .gitlab-ci.yml, scripts/qa.sh, Makefile).',
  };
}

export function auditDevops(ctx: AuditContext): AuditCheckResult[] {
  return [checkCiWorkflows(ctx)];
}
