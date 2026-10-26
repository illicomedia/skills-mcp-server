import type { LanguageAuditRule } from './types.js';

export const pythonRule: LanguageAuditRule = {
  id: 'python',
  name: 'Python',
  match: (ctx) => ctx.stack.isPython,

  getQaScript: (ctx) => {
    const hasQaStandard =
      ctx.fileExists('pyproject.toml') || ctx.fileExists('tox.ini') || ctx.stack.hasMakefile;
    return {
      name: 'qa:starter / python quality gates declared',
      passed: hasQaStandard,
      details: hasQaStandard
        ? 'Python project detected. QA configured via pyproject.toml / test runner.'
        : 'No test runner or pyproject.toml found for Python project.',
    };
  },

  getTypeCheck: (ctx) => {
    const hasTypeCheck = ctx.fileExists('mypy.ini') || ctx.fileExists('pyproject.toml');
    return {
      name: 'static typing / type-check configured',
      passed: hasTypeCheck,
      details: hasTypeCheck
        ? 'Python type checking or linter configuration detected.'
        : 'No mypy.ini or type checking configuration detected.',
    };
  },

  getTestSuite: (ctx) => {
    const hasTestSuite =
      ctx.fileExists('pytest.ini') ||
      ctx.fileExists('tox.ini') ||
      ctx.fileExists('setup.cfg') ||
      ctx.hasDir('tests') ||
      ctx.hasDir('test');
    return {
      passed: hasTestSuite,
      details: hasTestSuite
        ? 'Python test runner configuration or tests/ directory detected (tests not executed).'
        : 'No pytest.ini, tox.ini, or tests/ directory found for Python project.',
    };
  },

  getLockfile: (ctx) => {
    const hasLockfile =
      ctx.fileExists('poetry.lock') ||
      ctx.fileExists('Pipfile.lock') ||
      ctx.fileExists('uv.lock') ||
      ctx.fileExists('pdm.lock') ||
      ctx.fileExists('requirements.lock');
    return {
      passed: hasLockfile,
      severity: 'warning',
      details: hasLockfile
        ? 'Python dependency lockfile present for reproducible dependency resolution.'
        : 'No Python dependency lockfile found (poetry.lock, uv.lock, Pipfile.lock).',
    };
  },
};
