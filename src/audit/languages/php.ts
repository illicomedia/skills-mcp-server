import type { LanguageAuditRule } from './types.js';

export const phpRule: LanguageAuditRule = {
  id: 'php',
  name: 'PHP',
  match: (ctx) => ctx.stack.isPhp,

  getQaScript: (ctx) => {
    const hasQaStandard = ctx.fileExists('composer.json') || ctx.stack.hasMakefile;
    return {
      name: 'qa:starter / php quality gates declared',
      passed: hasQaStandard,
      details: hasQaStandard
        ? 'PHP project detected. Canonical QA available via composer scripts / PHPUnit.'
        : 'No composer.json or Makefile found for PHP project.',
    };
  },

  getTypeCheck: (ctx) => {
    const hasTypeCheck =
      ctx.fileExists('phpstan.neon') ||
      ctx.fileExists('phpstan.neon.dist') ||
      ctx.fileExists('psalm.xml');
    return {
      name: 'static analysis configured (PHPStan / Psalm)',
      passed: hasTypeCheck,
      details: hasTypeCheck
        ? 'PHP static analysis configuration detected (PHPStan / Psalm).'
        : 'No PHPStan or Psalm configuration detected for PHP static analysis.',
    };
  },

  getTestSuite: (ctx) => {
    const hasTestSuite =
      ctx.fileExists('phpunit.xml') ||
      ctx.fileExists('phpunit.xml.dist') ||
      ctx.fileExists('pest.php') ||
      ctx.hasDir('tests');
    return {
      passed: hasTestSuite,
      details: hasTestSuite
        ? 'PHPUnit or Pest test configuration detected (tests not executed).'
        : 'No phpunit.xml or tests/ directory found for PHP project.',
    };
  },

  getLockfile: (ctx) => {
    const hasLockfile = ctx.fileExists('composer.lock');
    return {
      passed: hasLockfile,
      severity: 'warning',
      details: hasLockfile
        ? 'composer.lock present for reproducible dependency resolution.'
        : 'composer.lock missing for PHP Composer project.',
    };
  },
};
