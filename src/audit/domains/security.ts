import { gitignoreRules, isIgnored } from '../gitignore.js';
import type { AuditCheckResult, AuditContext } from '../types.js';

const LICENSE_FILE = '.qa-license.json';

/** Sample key file names: a .gitignore "has rules for private keys" when it ignores one of them. */
const KEY_FILE_SAMPLES: readonly string[] = [
  'server.pem',
  'server.key',
  'certificate.p12',
  'certificate.pkcs12',
  'certificate.pfx',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
];

function checkVulnerabilityPolicy(ctx: AuditContext): AuditCheckResult {
  const hasSecTxt =
    ctx.fileExists('public/.well-known/security.txt') ||
    ctx.fileExists('dist/.well-known/security.txt') ||
    ctx.fileExists('.well-known/security.txt') ||
    ctx.fileExists('website/public/.well-known/security.txt') ||
    ctx.fileExists('website/dist/.well-known/security.txt') ||
    ctx.fileExists('apps/web/public/.well-known/security.txt') ||
    ctx.fileExists('client/public/.well-known/security.txt');

  const hasSecurityMd = ctx.fileExists('SECURITY.md') || ctx.fileExists('.github/SECURITY.md');

  const secCheckName = ctx.stack.isWebProject
    ? 'security.txt present'
    : hasSecTxt
      ? 'security.txt present'
      : 'SECURITY.md present';

  const secPassed = hasSecTxt || (!ctx.stack.isWebProject && hasSecurityMd);
  let secDetails = 'No security policy found.';

  if (hasSecTxt) {
    secDetails =
      'security.txt file present in a .well-known/ directory (RFC 9116 fields not checked).';
  } else if (hasSecurityMd) {
    secDetails = ctx.stack.isWebProject
      ? 'SECURITY.md present, but web projects should also publish RFC 9116 security.txt under a .well-known/ path.'
      : 'SECURITY.md file present (applicable disclosure channel for non-web / CLI / library / MCP repositories; security.txt not required).';
  } else if (ctx.stack.isWebProject) {
    secDetails = 'No security.txt found in public/, dist/, or root .well-known/ directories.';
  } else {
    secDetails =
      'No SECURITY.md found in repository root (security.txt not required without a served web origin).';
  }

  return {
    category: 'security',
    name: secCheckName,
    passed: secPassed,
    severity: ctx.stack.isWebProject ? 'blocker' : 'warning',
    details: secDetails,
  };
}

function checkGitignoreEnv(ctx: AuditContext): AuditCheckResult {
  const ignoresEnv = isIgnored(gitignoreRules(ctx), '.env');

  const envPassed = ignoresEnv;
  let envSeverity: 'blocker' | 'warning' | 'info' = 'warning';
  let envDetails = '';

  if (ctx.stack.hasEnvFiles || ctx.stack.isWebProject) {
    envSeverity = 'blocker';
    envDetails = ignoresEnv
      ? '.gitignore contains active ignore rules for ".env" files (ignore rules and other secret files not evaluated).'
      : '.gitignore missing or does not mention .env (also ignore private keys and credentials).';
  } else {
    envSeverity = 'warning';
    envDetails = ignoresEnv
      ? '.gitignore contains active ignore rules for ".env" files.'
      : '.gitignore does not mention .env (recommended practice even for offline projects to prevent accidental secret commits).';
  }

  return {
    category: 'security',
    name: '.gitignore mentions .env',
    passed: envPassed,
    severity: envSeverity,
    details: envDetails,
  };
}

function checkPrivateKeyHygiene(ctx: AuditContext): AuditCheckResult {
  const rules = gitignoreRules(ctx);
  const ignoresKeys = KEY_FILE_SAMPLES.some((name) => isIgnored(rules, name));

  // Scan up to 2 directory levels for raw private keys / certificates
  const isKeyFile = (_rel: string, fileName: string): boolean => {
    return (
      fileName.endsWith('.pem') ||
      fileName.endsWith('.key') ||
      fileName.endsWith('.p12') ||
      fileName.endsWith('.pkcs12') ||
      fileName.endsWith('.pfx') ||
      fileName === 'id_rsa' ||
      fileName === 'id_ed25519' ||
      fileName === 'id_ecdsa' ||
      fileName === 'id_dsa'
    );
  };

  const detectedKeyFiles = ctx.findFiles(2, isKeyFile);
  // Each key file found must itself be ignored: a rule for another kind of key does not cover it.
  const committedKeyFiles = detectedKeyFiles.filter((file) => !isIgnored(rules, file));
  const hasRawKeyFile = committedKeyFiles.length > 0;

  let keyPassed = true;
  let keySeverity: 'blocker' | 'warning' | 'info' = 'warning';
  let keyDetails = '';

  if (hasRawKeyFile) {
    keyPassed = false;
    keySeverity = 'blocker';
    keyDetails = `Raw private key or certificate file not ignored by .gitignore (${committedKeyFiles.slice(0, 3).join(', ')}).`;
  } else if (ignoresKeys) {
    keyPassed = true;
    keySeverity = 'warning';
    keyDetails = '.gitignore contains rules for private key and credential files.';
  } else if (ctx.stack.isWebProject || ctx.stack.hasEnvFiles || ctx.stack.isNode) {
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

  return {
    category: 'security',
    name: 'private key and secret hygiene in .gitignore',
    passed: keyPassed,
    severity: keySeverity,
    details: keyDetails,
  };
}

/**
 * A project-level license file is the licensee's own signed license: committed to a shared or
 * public repository, it unlocks the paid skills for everyone who can read that repository.
 * Only projects that hold the file get this check.
 */
function checkLicenseFileIgnored(ctx: AuditContext): AuditCheckResult[] {
  if (!ctx.fileExists(LICENSE_FILE)) {
    return [];
  }
  const ignoresLicenseFile = isIgnored(gitignoreRules(ctx), LICENSE_FILE);
  return [
    {
      category: 'security',
      name: 'license file kept out of git',
      passed: ignoresLicenseFile,
      severity: 'warning',
      details: ignoresLicenseFile
        ? `.gitignore ignores ${LICENSE_FILE} (git tracking itself is not checked).`
        : `${LICENSE_FILE} is not ignored by .gitignore: committing it shares your signed license with everyone who can read the repository. Add ${LICENSE_FILE} to .gitignore, or keep the license in ~/.config/fredo-qa/license.json.`,
    },
  ];
}

export function auditSecurity(ctx: AuditContext): AuditCheckResult[] {
  return [
    checkVulnerabilityPolicy(ctx),
    checkGitignoreEnv(ctx),
    checkPrivateKeyHygiene(ctx),
    ...checkLicenseFileIgnored(ctx),
  ];
}
