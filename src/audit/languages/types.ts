import type { AuditContext, AuditSeverity } from '../types.js';

export interface LanguageAuditRule {
  id: string;
  name: string;
  match: (ctx: AuditContext) => boolean;
  getQaScript: (ctx: AuditContext) => { name: string; passed: boolean; details: string };
  getTypeCheck: (ctx: AuditContext) => { name: string; passed: boolean; details: string };
  getTestSuite: (ctx: AuditContext) => { passed: boolean; details: string };
  getLockfile: (ctx: AuditContext) => { passed: boolean; severity: AuditSeverity; details: string };
}
