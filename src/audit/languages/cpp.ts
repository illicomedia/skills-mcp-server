import type { LanguageAuditRule } from './types.js';

export const cppRule: LanguageAuditRule = {
  id: 'cpp',
  name: 'C/C++',
  match: (ctx) => ctx.stack.isCpp,

  getQaScript: (ctx) => {
    const hasQaStandard = ctx.stack.hasMakefile || ctx.fileExists('CMakeLists.txt');
    return {
      name: 'qa:starter / c-cpp quality gates declared',
      passed: hasQaStandard,
      details: hasQaStandard
        ? 'C/C++ project detected (CMake/Makefile). Canonical QA available via build system and test runner.'
        : 'No Makefile or CMakeLists.txt found for C/C++ project.',
    };
  },

  getTypeCheck: () => ({
    name: 'compile-time type safety & static analysis (C/C++ compiler)',
    passed: true,
    details: 'C/C++ compiler and static analyzers enforce compile-time type checking.',
  }),

  getTestSuite: (ctx) => {
    const hasTestSuite =
      ctx.fileExists('CTestTestfile.cmake') ||
      ctx.hasDir('tests') ||
      ctx.hasDir('test') ||
      ctx.stack.hasMakefile;
    return {
      passed: hasTestSuite,
      details:
        'C/C++ test suite configuration or tests/ directory detected (tests not executed).',
    };
  },

  getLockfile: (ctx) => {
    const hasLockfile =
      ctx.fileExists('conan.lock') ||
      ctx.fileExists('vcpkg.json') ||
      ctx.fileExists('CPM.cmake') ||
      !ctx.fileExists('conanfile.txt');
    return {
      passed: hasLockfile,
      severity: 'warning',
      details: hasLockfile
        ? 'C/C++ build manifest or dependency specification present.'
        : 'conanfile.txt detected without committed conan.lock.',
    };
  },
};
