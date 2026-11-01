import type { LanguageAuditRule } from './types.js';

export const rustRule: LanguageAuditRule = {
  id: 'rust',
  name: 'Rust',
  match: (ctx) => ctx.stack.isRust,

  getQaScript: () => ({
    name: 'qa:starter / cargo quality gates declared',
    passed: true,
    details:
      'Rust project detected (Cargo.toml). Canonical QA available via cargo test and cargo clippy.',
  }),

  getTypeCheck: () => ({
    name: 'compile-time type safety & borrow checking (rustc)',
    passed: true,
    details: 'Rust compiler enforces compile-time type safety and borrow checking.',
  }),

  getTestSuite: () => ({
    passed: true,
    details: 'Rust test framework declared via cargo test / Cargo.toml (tests not executed).',
  }),

  getLockfile: (ctx) => {
    const hasLockfile = ctx.fileExists('Cargo.lock');
    return {
      passed: hasLockfile,
      severity: 'warning',
      details: hasLockfile
        ? 'Cargo.lock present for reproducible dependency resolution.'
        : 'Cargo.lock missing. Binaries and end-user artifacts should commit Cargo.lock.',
    };
  },
};
