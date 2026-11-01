import type { AuditCheckResult, AuditContext } from '../types.js';

export interface GitignoreRules {
  ignoresEnv: boolean;
  ignoresPrivateKeys: boolean;
}

export function parseGitignoreRules(content: string): GitignoreRules {
  const lines = content.split('\n').map((l) => l.trim());
  let ignoresEnv = false;
  let ignoresPrivateKeys = false;

  for (const line of lines) {
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Negations
    if (line === '!.env' || line === '!.env*' || line === '!*.env') {
      ignoresEnv = false;
      continue;
    }

    // Active .env ignore rules
    if (
      line === '.env' ||
      line === '.env*' ||
      line === '*.env' ||
      line === '.env.*' ||
      line.startsWith('.env.') ||
      line.startsWith('.env/') ||
      line.endsWith('/.env')
    ) {
      ignoresEnv = true;
    }

    // Active key ignore rules
    if (
      (line.includes('*.pem') ||
        line.includes('*.key') ||
        line.includes('*.p12') ||
        line.includes('*.pkcs12') ||
        line.includes('*.pfx') ||
        line.includes('id_rsa') ||
        line.includes('id_ed25519') ||
        line.includes('id_ecdsa') ||
        line.includes('id_dsa') ||
        line.includes('.aws')) &&
      !line.startsWith('!')
    ) {
      ignoresPrivateKeys = true;
    }
  }

  return { ignoresEnv, ignoresPrivateKeys };
}

export function checkVulnerabilityPolicy(ctx: AuditContext): AuditCheckResult {
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
    secDetails =
      'SECURITY.md file present (standard vulnerability disclosure policy for offline/CLI repositories).';
  } else if (ctx.stack.isWebProject) {
    secDetails = 'No security.txt found in public/, dist/, or root .well-known/ directories.';
  } else {
    secDetails = 'No SECURITY.md found in repository root.';
  }

  return {
    category: 'security',
    name: secCheckName,
    passed: secPassed,
    severity: ctx.stack.isWebProject ? 'blocker' : 'warning',
    details: secDetails,
  };
}

export function checkGitignoreEnv(ctx: AuditContext): AuditCheckResult {
  const gitignoreContent = ctx.readFile('.gitignore') ?? ctx.readParentFile('.gitignore') ?? '';
  const { ignoresEnv } = parseGitignoreRules(gitignoreContent);

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

export function checkPrivateKeyHygiene(ctx: AuditContext): AuditCheckResult {
  const gitignoreContent = ctx.readFile('.gitignore') ?? ctx.readParentFile('.gitignore') ?? '';
  const { ignoresPrivateKeys: ignoresKeys } = parseGitignoreRules(gitignoreContent);

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
  const hasRawKeyFile = detectedKeyFiles.length > 0 && !ignoresKeys;

  let keyPassed = true;
  let keySeverity: 'blocker' | 'warning' | 'info' = 'warning';
  let keyDetails = '';

  if (hasRawKeyFile) {
    keyPassed = false;
    keySeverity = 'blocker';
    keyDetails = `Raw private key or certificate file detected in workspace (${detectedKeyFiles.slice(0, 3).join(', ')}).`;
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

export function auditSecurity(ctx: AuditContext): AuditCheckResult[] {
  return [checkVulnerabilityPolicy(ctx), checkGitignoreEnv(ctx), checkPrivateKeyHygiene(ctx)];
}
