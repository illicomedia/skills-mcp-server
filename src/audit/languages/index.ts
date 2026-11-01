import type { AuditContext } from '../types.js';
import { cppRule } from './cpp.js';
import { defaultRule, makefileRule } from './fallback.js';
import { goRule } from './go.js';
import { javaRule } from './java.js';
import { nodeRule } from './node.js';
import { phpRule } from './php.js';
import { pythonRule } from './python.js';
import { rustRule } from './rust.js';
import { shellRule } from './shell.js';
import type { LanguageAuditRule } from './types.js';

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
  // defaultRule matches everything, so the first match always exists.
  return LANGUAGE_RULES.filter((rule) => rule.match(ctx))[0];
}

export function resolveAllMatchingRules(ctx: AuditContext): LanguageAuditRule[] {
  const matched = LANGUAGE_RULES.filter((rule) => rule.id !== 'default' && rule.match(ctx));
  return matched.length > 0 ? matched : [defaultRule];
}
