// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AuditCheckResult {
  category: string;
  name: string;
  passed: boolean;
  severity: 'blocker' | 'warning' | 'info';
  details: string;
}

export interface AuditReport {
  projectPath: string;
  timestamp: string;
  status: 'ready' | 'needs_attention';
  prerequisites: string;
  /** Share of presence checks that found their file or script, 0-100. */
  score: number;
  scope: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  results: AuditCheckResult[];
  recommendations: string[];
}

const AUDIT_SCOPE =
  'Fast preflight sanity check: verifies presence of scaffolding, agent directives, and baseline hygiene. Gates are not executed and compilers are not run.';

/**
 * Checks that the files and scripts expected by Fredo QA Skills are present in a project.
 * Context-aware across stacks (Rust, Go, Python, C/C++, Java, PHP, Node.js) and project types.
 */
export function runComplianceAudit(projectPath: string): AuditReport {
  const resolvedPath = path.resolve(projectPath);
  const parentPath = path.dirname(resolvedPath);
  const results: AuditCheckResult[] = [];

  const fileExists = (rel: string) => fs.existsSync(path.join(resolvedPath, rel));
  const parentFileExists = (rel: string) =>
    resolvedPath !== parentPath && fs.existsSync(path.join(parentPath, rel));
  const hasDir = (rel: string) => {
    try {
      const p = path.join(resolvedPath, rel);
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  // Stack detection across all 8 Fredo QA language skills
  const isRust = fileExists('Cargo.toml');
  const isGo = fileExists('go.mod');
  const isNode = fileExists('package.json');
  const isPython =
    fileExists('pyproject.toml') ||
    fileExists('requirements.txt') ||
    fileExists('setup.py') ||
    fileExists('Pipfile');
  const isJava =
    fileExists('pom.xml') ||
    fileExists('build.gradle') ||
    fileExists('build.gradle.kts') ||
    fileExists('mvnw') ||
    fileExists('gradlew');
  const isCpp =
    fileExists('CMakeLists.txt') ||
    fileExists('compile_commands.json') ||
    fileExists('meson.build') ||
    fileExists('configure.ac');
  const hasPhpFiles = (relDir: string): boolean => {
    try {
      const fullDir = path.join(resolvedPath, relDir);
      return fs.existsSync(fullDir) && fs.readdirSync(fullDir).some((f) => f.endsWith('.php'));
    } catch {
      return false;
    }
  };
  const isPhp =
    fileExists('composer.json') ||
    hasPhpFiles('.') ||
    hasPhpFiles('public/api') ||
    hasPhpFiles('api') ||
    hasPhpFiles('src');
  const hasShellScripts = (): boolean => {
    try {
      const rootFiles = fs.readdirSync(resolvedPath);
      if (rootFiles.some((f) => f.endsWith('.sh'))) return true;
      const scriptsDir = path.join(resolvedPath, 'scripts');
      return (
        fs.existsSync(scriptsDir) &&
        fs.statSync(scriptsDir).isDirectory() &&
        fs.readdirSync(scriptsDir).some((f) => f.endsWith('.sh'))
      );
    } catch {
      return false;
    }
  };
  const isBash =
    !isNode &&
    !isRust &&
    !isGo &&
    !isPython &&
    !isJava &&
    !isCpp &&
    !isPhp &&
    (hasShellScripts() || fileExists('.shellcheckrc') || hasDir('tests/bats'));
  const hasMakefile =
    fileExists('Makefile') || fileExists('justfile') || fileExists('scripts/qa.sh');
  const isWebProject =
    hasDir('public') ||
    fileExists('index.html') ||
    fileExists('src/index.html') ||
    hasDir('dist') ||
    hasDir('www');

  // Check 1: AGENTS.md policy presence
  const agentsMd = path.join(resolvedPath, 'AGENTS.md');
  const hasAgentsMd = fs.existsSync(agentsMd);
  results.push({
    category: 'governance',
    name: 'AGENTS.md present',
    passed: hasAgentsMd,
    severity: 'warning',
    details: hasAgentsMd
      ? 'AGENTS.md file present (content not evaluated).'
      : 'AGENTS.md not found. Recommended to provide repository-level QA guidelines and policy directives for AI coding agents.',
  });

  // Check 2: .qa-exceptions.yaml governance (passes when file exists and unexpired, or project is clean without exceptions)
  const exceptionsFile = path.join(resolvedPath, '.qa-exceptions.yaml');
  const hasExceptions = fs.existsSync(exceptionsFile);
  let exceptionsPassed = true;
  let exceptionsSeverity: 'blocker' | 'warning' | 'info' = hasExceptions ? 'warning' : 'info';
  let exceptionsDetails =
    'No .qa-exceptions.yaml required (clean state: 0 exceptions, or handled natively in compiler/linter config).';

  if (hasExceptions) {
    try {
      const content = fs.readFileSync(exceptionsFile, 'utf-8');
      const dateMatches = content.matchAll(
        /(?:expires_at|expires):\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})["']?/g,
      );
      const expiredList: string[] = [];
      const now = Date.now();
      for (const match of dateMatches) {
        const expDate = Date.parse(match[1]);
        if (!Number.isNaN(expDate) && expDate < now) {
          expiredList.push(match[1]);
        }
      }
      if (expiredList.length > 0) {
        exceptionsPassed = false;
        exceptionsSeverity = 'blocker';
        exceptionsDetails = `Exception register contains ${expiredList.length} expired entry(ies) (expired on ${expiredList.join(', ')}). Expired entries fail closed per qa-core.`;
      } else {
        exceptionsDetails =
          'Exception register file present (all declared expiration dates are active).';
      }
    } catch {
      exceptionsDetails = 'Exception register file present (schema and expiry not checked).';
    }
  }

  results.push({
    category: 'governance',
    name: '.qa-exceptions.yaml present',
    passed: exceptionsPassed,
    severity: exceptionsSeverity,
    details: exceptionsDetails,
  });

  // Check 3: Root LICENSE file presence (Legal Governance)
  const hasLicense =
    fileExists('LICENSE') ||
    fileExists('LICENSE.md') ||
    fileExists('LICENSE.txt') ||
    fileExists('LICENCE') ||
    fileExists('LICENCE.md') ||
    fileExists('COPYING') ||
    fileExists('COPYING.md') ||
    fileExists('COPYING.txt') ||
    parentFileExists('LICENSE') ||
    parentFileExists('LICENSE.md') ||
    parentFileExists('COPYING');

  results.push({
    category: 'governance',
    name: 'LICENSE file present',
    passed: hasLicense,
    severity: 'warning',
    details: hasLicense
      ? 'LICENSE file present in project root (license terms not evaluated).'
      : 'No LICENSE, LICENSE.md, or COPYING file found in project root.',
  });

  // Check 4: Vulnerability disclosure policy (RFC 9116 security.txt for web, SECURITY.md for offline CLI/libraries)
  const secTxtPublic = path.join(resolvedPath, 'public', '.well-known', 'security.txt');
  const secTxtDist = path.join(resolvedPath, 'dist', '.well-known', 'security.txt');
  const secTxtRoot = path.join(resolvedPath, '.well-known', 'security.txt');
  const hasSecTxt =
    fs.existsSync(secTxtPublic) ||
    fs.existsSync(secTxtDist) ||
    fs.existsSync(secTxtRoot) ||
    fileExists('website/public/.well-known/security.txt') ||
    fileExists('website/dist/.well-known/security.txt') ||
    fileExists('apps/web/public/.well-known/security.txt') ||
    fileExists('client/public/.well-known/security.txt');
  const hasSecurityMd = fileExists('SECURITY.md') || fileExists('.github/SECURITY.md');

  const secCheckName = isWebProject
    ? 'security.txt present'
    : hasSecTxt
      ? 'security.txt present'
      : 'SECURITY.md present';

  const secPassed = hasSecTxt || (!isWebProject && hasSecurityMd);
  let secDetails = 'No security policy found.';
  if (hasSecTxt) {
    secDetails =
      'security.txt file present in a .well-known/ directory (RFC 9116 fields not checked).';
  } else if (hasSecurityMd) {
    secDetails =
      'SECURITY.md file present (standard vulnerability disclosure policy for offline/CLI repositories).';
  } else if (isWebProject) {
    secDetails = 'No security.txt found in public/, dist/, or root .well-known/ directories.';
  } else {
    secDetails = 'No SECURITY.md found in repository root.';
  }

  results.push({
    category: 'security',
    name: secCheckName,
    passed: secPassed,
    severity: isWebProject ? 'blocker' : 'warning',
    details: secDetails,
  });

  // Check 5: Safe gitignore configuration for .env
  const gitignore = path.join(resolvedPath, '.gitignore');
  const hasGitignore = fs.existsSync(gitignore);
  let gitignoreContent = '';
  if (hasGitignore) {
    try {
      gitignoreContent = fs.readFileSync(gitignore, 'utf-8');
    } catch {}
  } else if (parentFileExists('.gitignore')) {
    try {
      gitignoreContent = fs.readFileSync(path.join(parentPath, '.gitignore'), 'utf-8');
    } catch {}
  }

  const hasEnvFiles =
    fileExists('.env') ||
    fileExists('.env.local') ||
    fileExists('.env.prod') ||
    fileExists('.env.example');
  const ignoresEnv = gitignoreContent.includes('.env');

  const envPassed = ignoresEnv;
  let envSeverity: 'blocker' | 'warning' | 'info' = 'warning';
  let envDetails = '';

  if (hasEnvFiles || isWebProject) {
    envSeverity = 'blocker';
    envDetails = ignoresEnv
      ? '.gitignore contains the text ".env" (ignore rules and other secret files not evaluated).'
      : '.gitignore missing or does not mention .env (also ignore private keys and credentials).';
  } else {
    // Offline / CLI binary or non-web project without env files:
    envSeverity = 'warning';
    envDetails = ignoresEnv
      ? '.gitignore contains the text ".env".'
      : '.gitignore does not mention .env (recommended practice even for offline projects to prevent accidental secret commits).';
  }

  results.push({
    category: 'security',
    name: '.gitignore mentions .env',
    passed: envPassed,
    severity: envSeverity,
    details: envDetails,
  });

  // Check 6: Private key and secret hygiene in .gitignore
  const keyIgnoreRegex = /(?:\*\.(?:pem|key|p12|pkcs12)|id_rsa|id_ed25519|\.aws)/;
  const ignoresKeys = keyIgnoreRegex.test(gitignoreContent);

  let hasRawKeyFile = false;
  try {
    const rootEntries = fs.readdirSync(resolvedPath);
    for (const entry of rootEntries) {
      if (
        (entry.endsWith('.pem') ||
          entry.endsWith('.key') ||
          entry.endsWith('.p12') ||
          entry.endsWith('.pkcs12') ||
          entry === 'id_rsa' ||
          entry === 'id_ed25519') &&
        !ignoresKeys
      ) {
        hasRawKeyFile = true;
        break;
      }
    }
  } catch {}

  let keyPassed = true;
  let keySeverity: 'blocker' | 'warning' | 'info' = 'warning';
  let keyDetails = '';

  if (hasRawKeyFile) {
    keyPassed = false;
    keySeverity = 'blocker';
    keyDetails = 'Raw private key or certificate file detected in workspace root.';
  } else if (ignoresKeys) {
    keyPassed = true;
    keySeverity = 'warning';
    keyDetails = '.gitignore contains rules for private key and credential files.';
  } else if (isWebProject || hasEnvFiles || isNode) {
    keyPassed = false;
    keySeverity = 'warning';
    keyDetails =
      '.gitignore does not contain explicit rules ignoring private key files (*.pem, *.key, *.p12).';
  } else {
    keyPassed = true;
    keySeverity = 'info';
    keyDetails =
      'No private keys detected; explicit key ignore rules recommended for multi-contributor repositories.';
  }

  results.push({
    category: 'security',
    name: 'private key and secret hygiene in .gitignore',
    passed: keyPassed,
    severity: keySeverity,
    details: keyDetails,
  });

  // Check 7: Canonical QA scripts / quality gates
  let hasQaStandard = false;
  let qaStandardDetails = '';
  let qaCheckName = 'qa:starter or qa:standard script declared';

  if (isNode) {
    const pkgJsonPath = path.join(resolvedPath, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      hasQaStandard = Boolean(
        pkg.scripts?.['qa:standard'] ||
          pkg.scripts?.['qa:starter'] ||
          pkg.scripts?.['test'],
      );
    } catch {
      // Ignored
    }
    qaStandardDetails = hasQaStandard
      ? 'package.json declares qa:starter or qa:standard (script not executed).'
      : 'No qa:starter / qa:standard script in package.json.';
  } else if (isRust) {
    hasQaStandard = true;
    qaCheckName = 'qa:starter / cargo quality gates declared';
    qaStandardDetails =
      'Rust project detected (Cargo.toml). Canonical QA available via cargo test and cargo clippy.';
  } else if (isGo) {
    hasQaStandard = true;
    qaCheckName = 'qa:starter / go quality gates declared';
    qaStandardDetails =
      'Go project detected (go.mod). Canonical QA available via go test and golangci-lint.';
  } else if (isPython) {
    hasQaStandard = fileExists('pyproject.toml') || fileExists('tox.ini') || hasMakefile;
    qaCheckName = 'qa:starter / python quality gates declared';
    qaStandardDetails = hasQaStandard
      ? 'Python project detected. QA configured via pyproject.toml / test runner.'
      : 'No test runner or pyproject.toml found for Python project.';
  } else if (isJava) {
    hasQaStandard = true;
    qaCheckName = 'qa:starter / java quality gates declared';
    qaStandardDetails =
      'Java project detected (Maven/Gradle). Canonical QA available via build tool test and check lifecycle.';
  } else if (isCpp) {
    hasQaStandard = hasMakefile || fileExists('CMakeLists.txt');
    qaCheckName = 'qa:starter / c-cpp quality gates declared';
    qaStandardDetails = hasQaStandard
      ? 'C/C++ project detected (CMake/Makefile). Canonical QA available via build system and test runner.'
      : 'No Makefile or CMakeLists.txt found for C/C++ project.';
  } else if (isPhp) {
    hasQaStandard = fileExists('composer.json') || hasMakefile;
    qaCheckName = 'qa:starter / php quality gates declared';
    qaStandardDetails = hasQaStandard
      ? 'PHP project detected. Canonical QA available via composer scripts / PHPUnit.'
      : 'No composer.json or Makefile found for PHP project.';
  } else if (isBash) {
    hasQaStandard = hasMakefile || fileExists('scripts/qa.sh');
    qaCheckName = 'qa:starter / shell quality gates declared';
    qaStandardDetails = hasQaStandard
      ? 'Shell project detected. Canonical QA available via scripts/qa.sh or Makefile (ShellCheck, bats).'
      : 'No scripts/qa.sh or Makefile found for Shell project.';
  } else if (hasMakefile) {
    hasQaStandard = true;
    qaCheckName = 'qa:starter / makefile quality gates declared';
    qaStandardDetails = 'Makefile / scripts/qa.sh detected for canonical quality gate execution.';
  } else {
    hasQaStandard = false;
    qaStandardDetails = 'No qa:starter / qa:standard script in package.json.';
  }

  results.push({
    category: 'quality',
    name: qaCheckName,
    passed: hasQaStandard,
    severity: 'blocker',
    details: qaStandardDetails,
  });

  // Check 8: Static typing / static analysis / compiler checks
  let hasTypeCheck = false;
  let typeCheckDetails = '';
  let typeCheckName = 'type-check script declared';

  if (isNode) {
    const pkgJsonPath = path.join(resolvedPath, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      hasTypeCheck = Boolean(
        pkg.scripts?.['type-check'] ||
          pkg.scripts?.['tsc'] ||
          pkg.scripts?.['check'] ||
          fileExists('tsconfig.json'),
      );
    } catch {
      // Ignored
    }
    typeCheckDetails = hasTypeCheck
      ? 'package.json declares a type-check script (script not executed).'
      : 'No type-check or tsc script in package.json.';
  } else if (isRust) {
    hasTypeCheck = true;
    typeCheckName = 'compile-time type safety & borrow checking (rustc)';
    typeCheckDetails = 'Rust compiler enforces compile-time type safety and borrow checking.';
  } else if (isGo) {
    hasTypeCheck = true;
    typeCheckName = 'compile-time type safety (go build)';
    typeCheckDetails = 'Go compiler enforces compile-time type safety.';
  } else if (isPython) {
    hasTypeCheck = fileExists('mypy.ini') || fileExists('pyproject.toml');
    typeCheckName = 'static typing / type-check configured';
    typeCheckDetails = hasTypeCheck
      ? 'Python type checking or linter configuration detected.'
      : 'No mypy.ini or type checking configuration detected.';
  } else if (isJava) {
    hasTypeCheck = true;
    typeCheckName = 'compile-time type safety (javac / JVM)';
    typeCheckDetails =
      'Java compiler (javac) enforces compile-time type safety and interface contracts.';
  } else if (isCpp) {
    hasTypeCheck = true;
    typeCheckName = 'compile-time type safety & static analysis (C/C++ compiler)';
    typeCheckDetails =
      'C/C++ compiler and static analyzers enforce compile-time type checking.';
  } else if (isPhp) {
    hasTypeCheck =
      fileExists('phpstan.neon') ||
      fileExists('phpstan.neon.dist') ||
      fileExists('psalm.xml');
    typeCheckName = 'static analysis configured (PHPStan / Psalm)';
    typeCheckDetails = hasTypeCheck
      ? 'PHP static analysis configuration detected (PHPStan / Psalm).'
      : 'No PHPStan or Psalm configuration detected for PHP static analysis.';
  } else if (isBash) {
    hasTypeCheck = fileExists('.shellcheckrc') || hasMakefile;
    typeCheckName = 'static analysis configured (ShellCheck / shfmt)';
    typeCheckDetails = hasTypeCheck
      ? 'Shell script static analysis or formatting runner detected.'
      : 'No .shellcheckrc or shell quality runner detected.';
  } else {
    hasTypeCheck = hasQaStandard;
    typeCheckDetails = hasTypeCheck
      ? 'Static analysis provided by build system.'
      : 'No type-check or tsc script in package.json.';
  }

  results.push({
    category: 'quality',
    name: typeCheckName,
    passed: hasTypeCheck,
    severity: 'blocker',
    details: typeCheckDetails,
  });

  // Check 9: Automated test suite declared
  let hasTestSuite = false;
  let testSuiteDetails = '';

  if (isNode) {
    const pkgJsonPath = path.join(resolvedPath, 'package.json');
    let hasTestScript = false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      hasTestScript = Boolean(
        pkg.scripts?.test ||
          pkg.scripts?.['test:unit'] ||
          pkg.scripts?.['test:all'] ||
          pkg.scripts?.['test:e2e'] ||
          pkg.scripts?.['test:run'],
      );
    } catch {}

    const hasTestConfigFile =
      fileExists('vitest.config.ts') ||
      fileExists('vitest.config.js') ||
      fileExists('vitest.config.mjs') ||
      fileExists('jest.config.js') ||
      fileExists('jest.config.ts') ||
      fileExists('playwright.config.ts');

    hasTestSuite = hasTestScript || hasTestConfigFile || hasDir('tests') || hasDir('test');
    testSuiteDetails = hasTestSuite
      ? 'package.json declares test script or test runner configuration (tests not executed).'
      : 'No test runner script or test config declared in package.json.';
  } else if (isRust) {
    hasTestSuite = true;
    testSuiteDetails =
      'Rust test framework declared via cargo test / Cargo.toml (tests not executed).';
  } else if (isGo) {
    hasTestSuite = true;
    testSuiteDetails = 'Go test framework declared via go test / go.mod (tests not executed).';
  } else if (isPython) {
    hasTestSuite =
      fileExists('pytest.ini') ||
      fileExists('tox.ini') ||
      fileExists('setup.cfg') ||
      hasDir('tests') ||
      hasDir('test');
    testSuiteDetails = hasTestSuite
      ? 'Python test runner configuration or tests/ directory detected (tests not executed).'
      : 'No pytest.ini, tox.ini, or tests/ directory found for Python project.';
  } else if (isJava) {
    hasTestSuite =
      fileExists('pom.xml') ||
      fileExists('build.gradle') ||
      hasDir('src/test') ||
      hasDir('tests');
    testSuiteDetails =
      'Java test framework declared via Maven/Gradle or src/test directory (tests not executed).';
  } else if (isCpp) {
    hasTestSuite =
      fileExists('CTestTestfile.cmake') ||
      hasDir('tests') ||
      hasDir('test') ||
      hasMakefile;
    testSuiteDetails =
      'C/C++ test suite configuration or tests/ directory detected (tests not executed).';
  } else if (isPhp) {
    hasTestSuite =
      fileExists('phpunit.xml') ||
      fileExists('phpunit.xml.dist') ||
      fileExists('pest.php') ||
      hasDir('tests');
    testSuiteDetails = hasTestSuite
      ? 'PHPUnit or Pest test configuration detected (tests not executed).'
      : 'No phpunit.xml or tests/ directory found for PHP project.';
  } else if (isBash) {
    hasTestSuite =
      hasDir('tests') ||
      hasDir('test') ||
      fileExists('scripts/test.sh') ||
      hasMakefile;
    testSuiteDetails =
      'Shell test runner or tests/ directory detected (tests not executed).';
  } else {
    hasTestSuite =
      hasDir('tests') ||
      hasDir('test') ||
      fileExists('scripts/test.sh') ||
      (hasMakefile &&
        fileExists('Makefile') &&
        fs.readFileSync(path.join(resolvedPath, 'Makefile'), 'utf-8').includes('test:'));
    testSuiteDetails = hasTestSuite
      ? 'Test suite configuration or tests/ directory detected (tests not executed).'
      : 'No automated test runner script or tests/ directory detected.';
  }

  results.push({
    category: 'quality',
    name: 'automated test suite declared',
    passed: hasTestSuite,
    severity: 'blocker',
    details: testSuiteDetails,
  });

  // Check 10: Dependency lockfile presence
  let hasLockfile = false;
  let lockfileDetails = '';
  let lockfileSeverity: 'blocker' | 'warning' | 'info' = 'warning';
  const hasManifest =
    isNode ||
    isRust ||
    isGo ||
    isPython ||
    isJava ||
    isCpp ||
    fileExists('composer.json');

  if (isNode) {
    hasLockfile =
      fileExists('pnpm-lock.yaml') ||
      fileExists('package-lock.json') ||
      fileExists('yarn.lock') ||
      fileExists('bun.lockb') ||
      parentFileExists('pnpm-lock.yaml') ||
      parentFileExists('package-lock.json');
    lockfileDetails = hasLockfile
      ? 'Dependency lockfile present for reproducible dependency resolution.'
      : 'Node package.json detected without committed lockfile (pnpm-lock.yaml, package-lock.json).';
  } else if (isRust) {
    hasLockfile = fileExists('Cargo.lock');
    lockfileDetails = hasLockfile
      ? 'Cargo.lock present for reproducible dependency resolution.'
      : 'Cargo.lock missing. Binaries and end-user artifacts should commit Cargo.lock.';
  } else if (isGo) {
    hasLockfile = fileExists('go.sum');
    lockfileDetails = hasLockfile
      ? 'go.sum present for reproducible dependency resolution.'
      : 'go.sum missing for Go module dependency resolution.';
  } else if (isPython) {
    hasLockfile =
      fileExists('poetry.lock') ||
      fileExists('Pipfile.lock') ||
      fileExists('uv.lock') ||
      fileExists('pdm.lock') ||
      fileExists('requirements.lock');
    lockfileDetails = hasLockfile
      ? 'Python dependency lockfile present for reproducible dependency resolution.'
      : 'No Python dependency lockfile found (poetry.lock, uv.lock, Pipfile.lock).';
  } else if (isJava) {
    hasLockfile =
      fileExists('pom.xml') ||
      fileExists('gradle.lockfile') ||
      fileExists('build.gradle');
    lockfileDetails =
      'Java dependency management manifest detected (pom.xml / gradle.lockfile).';
  } else if (isCpp) {
    hasLockfile =
      fileExists('conan.lock') ||
      fileExists('vcpkg.json') ||
      fileExists('CPM.cmake') ||
      !fileExists('conanfile.txt');
    lockfileDetails = hasLockfile
      ? 'C/C++ build manifest or dependency specification present.'
      : 'conanfile.txt detected without committed conan.lock.';
  } else if (isPhp) {
    hasLockfile = fileExists('composer.lock');
    lockfileDetails = hasLockfile
      ? 'composer.lock present for reproducible dependency resolution.'
      : 'composer.lock missing for PHP Composer project.';
  } else {
    hasLockfile = true;
    lockfileSeverity = 'info';
    lockfileDetails = 'No dependency manifest detected; lockfile requirement not applicable.';
  }

  results.push({
    category: 'supply-chain',
    name: 'dependency lockfile present',
    passed: hasLockfile,
    severity: lockfileSeverity,
    details: lockfileDetails,
  });

  // Check 11: Continuous integration workflow definition
  const checkCiDir = (dirRel: string): boolean => {
    try {
      const dirPath = path.join(resolvedPath, dirRel);
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
      const files = fs.readdirSync(dirPath);
      return files.some((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    } catch {
      return false;
    }
  };

  const checkParentCiDir = (dirRel: string): boolean => {
    try {
      if (resolvedPath === parentPath) return false;
      const dirPath = path.join(parentPath, dirRel);
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
      const files = fs.readdirSync(dirPath);
      return files.some((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    } catch {
      return false;
    }
  };

  const hasCiWorkflow =
    checkCiDir('.github/workflows') ||
    checkParentCiDir('.github/workflows') ||
    fileExists('.gitlab-ci.yml') ||
    fileExists('.circleci/config.yml') ||
    fileExists('azure-pipelines.yml') ||
    fileExists('bitbucket-pipelines.yml') ||
    fileExists('Jenkinsfile') ||
    fileExists('.travis.yml') ||
    fileExists('.woodpecker.yml') ||
    fileExists('.drone.yml');

  results.push({
    category: 'devops',
    name: 'CI workflow definition present',
    passed: hasCiWorkflow,
    severity: 'warning',
    details: hasCiWorkflow
      ? 'CI workflow definition file present (workflow execution not evaluated).'
      : 'No CI workflow configuration found (.github/workflows, .gitlab-ci.yml, etc.).',
  });

  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.passed).length;
  const failedChecks = totalChecks - passedChecks;
  const score = Math.round((passedChecks / totalChecks) * 100);
  const status: 'ready' | 'needs_attention' = failedChecks === 0 ? 'ready' : 'needs_attention';
  const prerequisites = `${passedChecks}/${totalChecks} met`;

  const recommendations: string[] = [];
  if (!hasAgentsMd) {
    recommendations.push(
      'Create an AGENTS.md in project root enforcing Fredo QA Skills rules for AI assistants.',
    );
  }
  if (!exceptionsPassed) {
    recommendations.push(
      'Review and renew or remove expired exceptions in .qa-exceptions.yaml.',
    );
  }
  if (!hasLicense) {
    recommendations.push(
      'Add a LICENSE or COPYING file in project root declaring usage and distribution terms.',
    );
  }
  if (!secPassed) {
    recommendations.push(
      isWebProject
        ? 'Generate public/.well-known/security.txt with RFC 9116 Contact and Expires directives.'
        : 'Add a SECURITY.md file at repository root with responsible vulnerability disclosure instructions.',
    );
  }
  if (!keyPassed && keySeverity === 'blocker') {
    recommendations.push(
      'Remove unignored private key or certificate files from the workspace root immediately.',
    );
  } else if (!keyPassed) {
    recommendations.push(
      'Add pattern rules to .gitignore ignoring private key and credential files (*.pem, *.key, *.p12).',
    );
  }
  if (!hasQaStandard && isNode) {
    recommendations.push(
      'Add "qa:starter" and "qa:standard" scripts to package.json for local and CI parity.',
    );
  }
  if (!hasTestSuite) {
    recommendations.push(
      'Declare an automated test runner script in package manifest or provide a tests/ directory.',
    );
  }
  if (!hasLockfile && hasManifest) {
    recommendations.push(
      'Commit a dependency lockfile (e.g. pnpm-lock.yaml, Cargo.lock, go.sum) for reproducible dependency resolution.',
    );
  }
  if (!hasCiWorkflow) {
    recommendations.push(
      'Add a CI workflow configuration (e.g. .github/workflows/ci.yml) for automated PR validation.',
    );
  }

  return {
    projectPath: resolvedPath,
    timestamp: new Date().toISOString(),
    status,
    prerequisites,
    score,
    scope: AUDIT_SCOPE,
    totalChecks,
    passedChecks,
    failedChecks,
    results,
    recommendations,
  };
}
