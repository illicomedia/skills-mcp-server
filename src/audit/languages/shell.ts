import type { LanguageAuditRule } from './types.js';

export const shellRule: LanguageAuditRule = {
  id: 'bash',
  name: 'Shell / Bash',
  match: (ctx) => ctx.stack.isBash,

  getQaScript: (ctx) => {
    const hasQaStandard = ctx.stack.hasMakefile || ctx.fileExists('scripts/qa.sh');
    return {
      name: 'qa:starter / shell quality gates declared',
      passed: hasQaStandard,
      details: hasQaStandard
        ? 'Shell project detected. Canonical QA available via scripts/qa.sh or Makefile (ShellCheck, bats).'
        : 'No scripts/qa.sh or Makefile found for Shell project.',
    };
  },

  getTypeCheck: (ctx) => {
    const hasTypeCheck = ctx.fileExists('.shellcheckrc') || ctx.stack.hasMakefile;
    return {
      name: 'static analysis configured (ShellCheck / shfmt)',
      passed: hasTypeCheck,
      details: hasTypeCheck
        ? 'Shell script static analysis or formatting runner detected.'
        : 'No .shellcheckrc or shell quality runner detected.',
    };
  },

  getTestSuite: (ctx) => {
    const hasTestSuite =
      ctx.hasDir('tests') ||
      ctx.hasDir('test') ||
      ctx.fileExists('scripts/test.sh') ||
      ctx.stack.hasMakefile;
    return {
      passed: hasTestSuite,
      details: 'Shell test runner or tests/ directory detected (tests not executed).',
    };
  },

  getLockfile: () => ({
    passed: true,
    severity: 'info',
    details: 'No dependency manifest detected; lockfile requirement not applicable.',
  }),
};
