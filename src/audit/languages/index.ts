import type { AuditContext } from '../types.js';
import type { LanguageAuditRule } from './types.js';
import { nodeRule } from './node.js';
import { rustRule } from './rust.js';
import { goRule } from './go.js';
import { pythonRule } from './python.js';
import { javaRule } from './java.js';
import { cppRule } from './cpp.js';
import { phpRule } from './php.js';
import { shellRule } from './shell.js';
import { makefileRule, defaultRule } from './fallback.js';

export * from './types.js';

export const LANGUAGE_RULES: LanguageAuditRule[] = [
  nodeRule,
  rustRule,
  goRule,
  pythonRule,
  javaRule,
  cppRule,
  phpRule,
  shellRule,
  makefileRule,
  defaultRule,
];

export function resolveLanguageRule(ctx: AuditContext): LanguageAuditRule {
  for (const rule of LANGUAGE_RULES) {
    if (rule.match(ctx)) {
      return rule;
    }
  }
  return defaultRule;
}

export function resolveAllMatchingRules(ctx: AuditContext): LanguageAuditRule[] {
  const matched = LANGUAGE_RULES.filter((rule) => rule.id !== 'default' && rule.match(ctx));
  return matched.length > 0 ? matched : [defaultRule];
}
