import type { LanguageAuditRule } from './types.js';

export const goRule: LanguageAuditRule = {
  id: 'go',
  name: 'Go',
  match: (ctx) => ctx.stack.isGo,

  getQaScript: () => ({
    name: 'qa:starter / go quality gates declared',
    passed: true,
    details: 'Go project detected (go.mod). Canonical QA available via go test and golangci-lint.',
  }),

  getTypeCheck: () => ({
    name: 'compile-time type safety (go build)',
    passed: true,
    details: 'Go compiler enforces compile-time type safety.',
  }),

  getTestSuite: () => ({
    passed: true,
    details: 'Go test framework declared via go test / go.mod (tests not executed).',
  }),

  getLockfile: (ctx) => {
    const hasLockfile = ctx.fileExists('go.sum');
    return {
      passed: hasLockfile,
      severity: 'warning',
      details: hasLockfile
        ? 'go.sum present for reproducible dependency resolution.'
        : 'go.sum missing for Go module dependency resolution.',
    };
  },
};
