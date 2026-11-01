import type { AuditCheckResult, AuditContext } from '../types.js';

export function checkAgentsMd(ctx: AuditContext): AuditCheckResult {
  const hasAgentsMd = ctx.fileExists('AGENTS.md');
  return {
    category: 'governance',
    name: 'AGENTS.md present',
    passed: hasAgentsMd,
    severity: 'warning',
    details: hasAgentsMd
      ? 'AGENTS.md file present (content not evaluated).'
      : 'AGENTS.md not found. Recommended to provide repository-level QA guidelines and policy directives for AI coding agents.',
  };
}

export function checkQaExceptions(ctx: AuditContext): AuditCheckResult {
  const hasExceptions = ctx.fileExists('.qa-exceptions.yaml');
  let exceptionsPassed = true;
  let exceptionsSeverity: 'blocker' | 'warning' | 'info' = hasExceptions ? 'warning' : 'info';
  let exceptionsDetails =
    'No .qa-exceptions.yaml required (clean state: 0 exceptions, or handled natively in compiler/linter config).';

  if (hasExceptions) {
    const content = ctx.readFile('.qa-exceptions.yaml') || '';
    const dateMatches = content.matchAll(
      /(?:expires_at|expires|expiry|valid_until|until):\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})["']?/gi,
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
  }

  return {
    category: 'governance',
    name: '.qa-exceptions.yaml present',
    passed: exceptionsPassed,
    severity: exceptionsSeverity,
    details: exceptionsDetails,
  };
}

export function checkLicense(ctx: AuditContext): AuditCheckResult {
  const hasLicense =
    ctx.fileExists('LICENSE') ||
    ctx.fileExists('LICENSE.md') ||
    ctx.fileExists('LICENSE.txt') ||
    ctx.fileExists('LICENCE') ||
    ctx.fileExists('LICENCE.md') ||
    ctx.fileExists('COPYING') ||
    ctx.fileExists('COPYING.md') ||
    ctx.fileExists('COPYING.txt') ||
    ctx.parentFileExists('LICENSE') ||
    ctx.parentFileExists('LICENSE.md') ||
    ctx.parentFileExists('COPYING');

  return {
    category: 'governance',
    name: 'LICENSE file present',
    passed: hasLicense,
    severity: 'warning',
    details: hasLicense
      ? 'LICENSE file present in project root (license terms not evaluated).'
      : 'No LICENSE, LICENSE.md, or COPYING file found in project root.',
  };
}

export function auditGovernance(ctx: AuditContext): AuditCheckResult[] {
  return [checkAgentsMd(ctx), checkQaExceptions(ctx), checkLicense(ctx)];
}
