import { resolveLanguageRule } from '../languages/index.js';
import type { AuditCheckResult, AuditContext } from '../types.js';

export function auditSupplyChain(ctx: AuditContext): AuditCheckResult[] {
  const langRule = resolveLanguageRule(ctx);
  const lockfile = langRule.getLockfile(ctx);

  const checkLockfile: AuditCheckResult = {
    category: 'supply-chain',
    name: 'dependency lockfile present',
    passed: lockfile.passed,
    severity: lockfile.severity,
    details: lockfile.details,
  };

  return [checkLockfile];
}
