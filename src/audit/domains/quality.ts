import { resolveAllMatchingRules } from '../languages/index.js';
import type { AuditCheckResult, AuditContext } from '../types.js';

export function auditQuality(ctx: AuditContext): AuditCheckResult[] {
  const matchedRules = resolveAllMatchingRules(ctx);
  const primaryRule = matchedRules[0];

  let qaScript = primaryRule.getQaScript(ctx);
  const typeCheck = primaryRule.getTypeCheck(ctx);
  let testSuite = primaryRule.getTestSuite(ctx);

  // In polyglot projects: if primary lacks tests or QA gates, check secondary stacks
  if (!testSuite.passed && matchedRules.length > 1) {
    for (const secondary of matchedRules.slice(1)) {
      const secondaryTest = secondary.getTestSuite(ctx);
      if (secondaryTest.passed) {
        testSuite = {
          passed: true,
          details: `${secondary.name} test framework declared (${secondaryTest.details}) alongside ${primaryRule.name}.`,
        };
        break;
      }
    }
  }

  if (!qaScript.passed && matchedRules.length > 1) {
    for (const secondary of matchedRules.slice(1)) {
      const secondaryQa = secondary.getQaScript(ctx);
      if (secondaryQa.passed) {
        qaScript = {
          name: secondaryQa.name,
          passed: true,
          details: `${secondary.name} quality gates declared (${secondaryQa.details}) alongside ${primaryRule.name}.`,
        };
        break;
      }
    }
  }

  const checkQa: AuditCheckResult = {
    category: 'quality',
    name: qaScript.name,
    passed: qaScript.passed,
    severity: 'blocker',
    details: qaScript.details,
  };

  const checkType: AuditCheckResult = {
    category: 'quality',
    name: typeCheck.name,
    passed: typeCheck.passed,
    severity: 'blocker',
    details: typeCheck.details,
  };

  const checkTest: AuditCheckResult = {
    category: 'quality',
    name: 'automated test suite declared',
    passed: testSuite.passed,
    severity: 'blocker',
    details: testSuite.details,
  };

  return [checkQa, checkType, checkTest];
}
