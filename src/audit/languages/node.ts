import type { AuditContext } from '../types.js';
import type { LanguageAuditRule } from './types.js';

function parsePackageJson(ctx: AuditContext): any {
  const content = ctx.readFile('package.json');
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export const nodeRule: LanguageAuditRule = {
  id: 'node',
  name: 'Node.js / TypeScript',
  match: (ctx) => ctx.stack.isNode,

  getQaScript: (ctx) => {
    const pkg = parsePackageJson(ctx);
    const hasQaStandard = Boolean(
      pkg?.scripts?.['qa:standard'] ||
        pkg?.scripts?.['qa:starter'] ||
        pkg?.scripts?.['test'],
    );
    return {
      name: 'qa:starter or qa:standard script declared',
      passed: hasQaStandard,
      details: hasQaStandard
        ? 'package.json declares qa:starter or qa:standard (script not executed).'
        : 'No qa:starter / qa:standard script in package.json.',
    };
  },

  getTypeCheck: (ctx) => {
    const pkg = parsePackageJson(ctx);
    const hasTypeCheck = Boolean(
      pkg?.scripts?.['type-check'] ||
        pkg?.scripts?.['tsc'] ||
        pkg?.scripts?.['check'] ||
        ctx.fileExists('tsconfig.json'),
    );
    return {
      name: 'type-check script declared',
      passed: hasTypeCheck,
      details: hasTypeCheck
        ? 'package.json declares a type-check script (script not executed).'
        : 'No type-check or tsc script in package.json.',
    };
  },

  getTestSuite: (ctx) => {
    const pkg = parsePackageJson(ctx);
    const hasTestScript = Boolean(
      pkg?.scripts?.test ||
        pkg?.scripts?.['test:unit'] ||
        pkg?.scripts?.['test:all'] ||
        pkg?.scripts?.['test:e2e'] ||
        pkg?.scripts?.['test:run'],
    );
    const hasTestConfigFile =
      ctx.fileExists('vitest.config.ts') ||
      ctx.fileExists('vitest.config.js') ||
      ctx.fileExists('vitest.config.mjs') ||
      ctx.fileExists('jest.config.js') ||
      ctx.fileExists('jest.config.ts') ||
      ctx.fileExists('playwright.config.ts');

    const hasTestSuite =
      hasTestScript || hasTestConfigFile || ctx.hasDir('tests') || ctx.hasDir('test');

    return {
      passed: hasTestSuite,
      details: hasTestSuite
        ? 'package.json declares test script or test runner configuration (tests not executed).'
        : 'No test runner script or test config declared in package.json.',
    };
  },

  getLockfile: (ctx) => {
    const hasLockfile =
      ctx.fileExists('pnpm-lock.yaml') ||
      ctx.fileExists('package-lock.json') ||
      ctx.fileExists('yarn.lock') ||
      ctx.fileExists('bun.lockb') ||
      ctx.parentFileExists('pnpm-lock.yaml') ||
      ctx.parentFileExists('package-lock.json');

    return {
      passed: hasLockfile,
      severity: 'warning',
      details: hasLockfile
        ? 'Dependency lockfile present for reproducible dependency resolution.'
        : 'Node package.json detected without committed lockfile (pnpm-lock.yaml, package-lock.json).',
    };
  },
};
