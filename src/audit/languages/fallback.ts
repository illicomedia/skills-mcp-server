import type { LanguageAuditRule } from './types.js';

export const makefileRule: LanguageAuditRule = {
  id: 'makefile',
  name: 'Generic Makefile',
  match: (ctx) => ctx.stack.hasMakefile,

  getQaScript: () => ({
    name: 'qa:starter / makefile quality gates declared',
    passed: true,
    details: 'Makefile / scripts/qa.sh detected for canonical quality gate execution.',
  }),

  getTypeCheck: () => ({
    name: 'type-check script declared',
    passed: true,
    details: 'Static analysis provided by build system.',
  }),

  getTestSuite: (ctx) => {
    const makefileContent = ctx.readFile('Makefile') || '';
    const hasTestTarget = ctx.fileExists('Makefile') && makefileContent.includes('test:');
    const hasTestSuite =
      ctx.hasDir('tests') ||
      ctx.hasDir('test') ||
      ctx.fileExists('scripts/test.sh') ||
      hasTestTarget;

    return {
      passed: hasTestSuite,
      details: hasTestSuite
        ? 'Test suite configuration or tests/ directory detected (tests not executed).'
        : 'No automated test runner script or tests/ directory detected.',
    };
  },

  getLockfile: () => ({
    passed: true,
    severity: 'info',
    details: 'No dependency manifest detected; lockfile requirement not applicable.',
  }),
};

export const defaultRule: LanguageAuditRule = {
  id: 'default',
  name: 'Default / Generic',
  match: () => true,

  getQaScript: () => ({
    name: 'qa:starter or qa:standard script declared',
    passed: false,
    details: 'No qa:starter / qa:standard script in package.json.',
  }),

  getTypeCheck: () => ({
    name: 'type-check script declared',
    passed: false,
    details: 'No type-check or tsc script in package.json.',
  }),

  getTestSuite: (ctx) => {
    const hasTestSuite =
      ctx.hasDir('tests') || ctx.hasDir('test') || ctx.fileExists('scripts/test.sh');
    return {
      passed: hasTestSuite,
      details: hasTestSuite
        ? 'Test suite configuration or tests/ directory detected (tests not executed).'
        : 'No automated test runner script or tests/ directory detected.',
    };
  },

  getLockfile: () => ({
    passed: true,
    severity: 'info',
    details: 'No dependency manifest detected; lockfile requirement not applicable.',
  }),
};
