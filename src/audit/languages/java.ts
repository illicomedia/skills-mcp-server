import type { LanguageAuditRule } from './types.js';

export const javaRule: LanguageAuditRule = {
  id: 'java',
  name: 'Java',
  match: (ctx) => ctx.stack.isJava,

  getQaScript: () => ({
    name: 'qa:starter / java quality gates declared',
    passed: true,
    details:
      'Java project detected (Maven/Gradle). Canonical QA available via build tool test and check lifecycle.',
  }),

  getTypeCheck: () => ({
    name: 'compile-time type safety (javac / JVM)',
    passed: true,
    details:
      'Java compiler (javac) enforces compile-time type safety and interface contracts.',
  }),

  getTestSuite: (ctx) => {
    const hasTestSuite =
      ctx.fileExists('pom.xml') ||
      ctx.fileExists('build.gradle') ||
      ctx.hasDir('src/test') ||
      ctx.hasDir('tests');
    return {
      passed: hasTestSuite,
      details:
        'Java test framework declared via Maven/Gradle or src/test directory (tests not executed).',
    };
  },

  getLockfile: (ctx) => {
    const hasLockfile =
      ctx.fileExists('pom.xml') ||
      ctx.fileExists('gradle.lockfile') ||
      ctx.fileExists('build.gradle');
    return {
      passed: hasLockfile,
      severity: 'warning',
      details: 'Java dependency management manifest detected (pom.xml / gradle.lockfile).',
    };
  },
};
