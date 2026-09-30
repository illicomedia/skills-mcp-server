import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LicenseValidationResult, SkillMetadata, SkillTier } from './types.js';

export const SKILLS_CATALOG: SkillMetadata[] = [
  // Free Foundation (MIT)
  {
    id: 'qa-core',
    name: 'Core Quality Policy',
    tier: 'free',
    category: 'core',
    description: 'Universal QA policy across stacks, standard profiles, and DoD checklists.',
    rulesSummary: [
      'Zero unhandled exceptions',
      'Local/CI execution parity',
      'Exception governance via .qa-exceptions.yaml',
    ],
  },
  {
    id: 'dev-flow',
    name: 'Engineering Development Flow',
    tier: 'free',
    category: 'core',
    description: 'Disciplined development flow with risk-based planning and small vertical slices.',
    rulesSummary: ['Atomic commits with provenance', 'TDD/BDD inner loop', 'Continuous validation'],
  },
  {
    id: 'qa-python',
    name: 'Python Quality Engineering',
    tier: 'free',
    category: 'language',
    description: 'Strict typing (mypy), deterministic formatting (ruff), and branch coverage.',
    rulesSummary: ['100% type coverage without Any', 'Ruff check & format', 'Pytest branch coverage >= 90%'],
  },
  {
    id: 'qa-javascript-typescript',
    name: 'JavaScript & TypeScript Quality',
    tier: 'free',
    category: 'language',
    description: 'Strict type checking, Biome formatting, Vitest coverage, and Core Web Vitals.',
    rulesSummary: ['tsc --noEmit clean', 'Biome check with zero debt', 'Coverage threshold enforcement'],
  },
  {
    id: 'qa-php',
    name: 'PHP Quality Engineering',
    tier: 'free',
    category: 'language',
    description: 'PHPStan max level, Pint/PHP-CS-Fixer formatting, and boundary architecture.',
    rulesSummary: ['PHPStan level max', 'Zero deprecated usage', 'Architecture boundaries'],
  },
  {
    id: 'qa-bash',
    name: 'Bash & Shell Scripting',
    tier: 'free',
    category: 'language',
    description: 'Safe POSIX defaults (set -euo pipefail), ShellCheck clean, and Bats testing.',
    rulesSummary: ['set -euo pipefail', 'ShellCheck clean', 'shfmt formatted'],
  },
  {
    id: 'qa-mcp',
    name: 'Model Context Protocol Quality',
    tier: 'free',
    category: 'language',
    description: 'Strict JSON Schema validation, JSON-RPC 2.0 contract tests, stdio isolation.',
    rulesSummary: ['JSON-RPC 2.0 compliance', 'Stdio pollution prevention', 'Graceful error handling'],
  },
  {
    id: 'qa-c-cpp',
    name: 'C & C++ Systems Engineering',
    tier: 'free',
    category: 'language',
    description: 'clangd LSP diagnostics, clang-tidy, cppcheck, sanitizers (ASan/UBSan/TSan), and memory safety.',
    rulesSummary: ['clangd semantic validation', 'ASan/UBSan clean execution', 'Strict compiler warnings (-Werror)'],
  },
  {
    id: 'qa-rust',
    name: 'Rust Systems Engineering',
    tier: 'free',
    category: 'language',
    description: 'Cargo check, Clippy with -D warnings, rustfmt, cargo-deny, cargo-audit, and Miri safety.',
    rulesSummary: ['cargo clippy --all-targets -- -D warnings', 'cargo fmt --check', 'cargo deny check and cargo audit'],
  },
  {
    id: 'qa-go',
    name: 'Go Systems Engineering',
    tier: 'free',
    category: 'language',
    description: 'golangci-lint, go test -race, govulncheck, gosec, and strict error handling.',
    rulesSummary: ['golangci-lint run', 'go test -race ./...', 'govulncheck ./... and gosec'],
  },
  {
    id: 'qa-java',
    name: 'Java Enterprise Engineering',
    tier: 'free',
    category: 'language',
    description: 'Checkstyle, SpotBugs, PMD, Error Prone, JaCoCo branch coverage >= 80%, and ArchUnit boundaries.',
    rulesSummary: ['javac -Werror clean compile', 'SpotBugs & PMD zero violations', 'JaCoCo line & branch coverage >= 80%'],
  },

  // Pro Production (Commercial)
  {
    id: 'qa-accessibility',
    name: 'Accessibility & WCAG 2.2',
    tier: 'pro',
    category: 'compliance',
    description: 'Automated Axe-core testing, WCAG 2.2 AA/AAA baselines, and inclusive UX.',
    rulesSummary: ['Zero Axe-core violations', 'Keyboard navigability', 'Semantic landmarks'],
  },
  {
    id: 'qa-security',
    name: 'Application Security & OWASP',
    tier: 'pro',
    category: 'compliance',
    description: 'OWASP Top 10 prevention, dependency audits, CSP headers, and secret scanning.',
    rulesSummary: ['Dependency audit clean', 'Zero hardcoded secrets', 'Strict CSP & security headers'],
  },
  {
    id: 'qa-performance',
    name: 'Performance & Core Web Vitals',
    tier: 'pro',
    category: 'quality',
    description: 'Lighthouse budgets, LCP < 2.5s, INP < 200ms, CLS < 0.1, bundle optimization.',
    rulesSummary: ['Lighthouse score >= 90', 'Strict performance budgets', 'Asset compression'],
  },
  {
    id: 'qa-devops',
    name: 'DevOps & CI/CD Security',
    tier: 'pro',
    category: 'compliance',
    description: 'GitHub Actions hardening, Dockerfile linting, container security, and IaC scanning.',
    rulesSummary: ['Pinned Action SHAs', 'Trivy container scan clean', 'Least-privilege tokens'],
  },
  {
    id: 'qa-seo-website',
    name: 'Technical SEO & Search Visibility',
    tier: 'pro',
    category: 'quality',
    description: 'Pre-rendered metadata, JSON-LD structured data, canonical tags, GEO/AEO optimization.',
    rulesSummary: ['Unique title and description per route', 'Valid Schema.org JSON-LD', 'Canonical tag parity'],
  },
  {
    id: 'qa-well-known',
    name: 'Well-Known URI Standards',
    tier: 'pro',
    category: 'compliance',
    description: 'RFC 9116 security.txt validation, robots.txt, sitemap.xml, and IANA registry conformance.',
    rulesSummary: ['Valid security.txt syntax', 'Canonical link directive', 'Future expiry date'],
  },
  {
    id: 'qa-emails-dns',
    name: 'Email & DNS Security',
    tier: 'pro',
    category: 'compliance',
    description: 'SPF, DKIM, DMARC p=reject, BIMI assertions, and DNS drift detection.',
    rulesSummary: ['DMARC p=quarantine or reject', 'Strict SPF records', 'BIMI indicator validation'],
  },

  // Enterprise Assurance (Enterprise)
  {
    id: 'qa-gdpr-rgpd',
    name: 'GDPR / RGPD Privacy Engineering',
    tier: 'enterprise',
    category: 'enterprise',
    description: 'Privacy by design, consent banner telemetry, data subject rights (DSR), and DPIA.',
    rulesSummary: ['Zero unconsented tracking cookies', '30-day DSR handling workflow', 'Privacy policy parity'],
  },
  {
    id: 'qa-ai-infrastructure-compliance',
    name: 'AI Infrastructure & NIS2 Compliance',
    tier: 'enterprise',
    category: 'enterprise',
    description: 'ISO 42001, NIS2 Directive mapping, EU AI Act risk classification, SOC2 Type II.',
    rulesSummary: ['AI risk tiering documented', 'NIS2 incident notification readiness', 'Auditable evidence export'],
  },
];

/**
 * Filter skills by active license tier
 */
export function getAvailableSkills(userTier: SkillTier): SkillMetadata[] {
  if (userTier === 'enterprise') {
    return SKILLS_CATALOG;
  }
  if (userTier === 'pro') {
    return SKILLS_CATALOG.filter((s) => s.tier === 'free' || s.tier === 'pro');
  }
  // Free tier
  return SKILLS_CATALOG.filter((s) => s.tier === 'free');
}

/**
 * Finds a skill by ID
 */
export function findSkill(id: string): SkillMetadata | undefined {
  return SKILLS_CATALOG.find((s) => s.id === id);
}

/**
 * Attempts to load the real SKILL.md from filesystem, or falls back to metadata
 */
export function loadSkillContent(skillId: string, searchDir?: string): string {
  const meta = findSkill(skillId);
  if (!meta) {
    throw new Error(`Unknown skill: ${skillId}`);
  }

  // Look for actual file on disk if available
  const candidatePaths = [
    path.join(searchDir || process.cwd(), 'skills', 'free', skillId, 'SKILL.md'),
    path.join(searchDir || process.cwd(), 'skills', 'pro', skillId, 'SKILL.md'),
    path.join(searchDir || process.cwd(), 'skills', 'enterprise', skillId, 'SKILL.md'),
    path.join(searchDir || process.cwd(), 'skills', skillId, 'SKILL.md'),
    path.join(searchDir || process.cwd(), '.agents', 'skills', skillId, 'SKILL.md'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, 'utf-8');
      } catch {
        // Fallback
      }
    }
  }

  // Generate synthetic structured directives if file not directly on disk
  return `# Skill: ${meta.name} (${meta.id})
Category: ${meta.category}
Tier: ${meta.tier.toUpperCase()}

## Description
${meta.description}

## Mandatory QA Rules & Quality Gates
${meta.rulesSummary.map((r, i) => `${i + 1}. **${r}**`).join('\n')}

## Inner Loop Commands
- Run \`pnpm run qa:starter\` or equivalent inner-loop test before committing.
- Run \`pnpm run qa:standard\` before submitting merge requests.
- Adhere strictly to zero-hidden-debt principles. Suppressions without documented justification in \`.qa-exceptions.yaml\` are rejected.
`;
}

/**
 * Loads or generates a compliant LICENSE file for a skill
 */
export function loadSkillLicense(
  skillId: string,
  license: LicenseValidationResult,
  searchDir?: string,
): string {
  const meta = findSkill(skillId);
  if (!meta) {
    throw new Error(`Unknown skill: ${skillId}`);
  }

  // Look for existing license file
  const candidatePaths = [
    path.join(searchDir || process.cwd(), 'skills', 'free', skillId, 'LICENSE'),
    path.join(searchDir || process.cwd(), 'skills', 'pro', skillId, 'LICENSE'),
    path.join(searchDir || process.cwd(), 'skills', 'pro', 'LICENSE'),
    path.join(searchDir || process.cwd(), 'skills', 'enterprise', skillId, 'LICENSE'),
    path.join(searchDir || process.cwd(), 'skills', 'enterprise', 'LICENSE'),
    path.join(searchDir || process.cwd(), 'skills', skillId, 'LICENSE'),
    path.join(searchDir || process.cwd(), 'LICENSE'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf-8').trim();
        if (content.length > 0) {
          if (meta.tier === 'free') {
            return content;
          }
          return `${content}\n\n---\nCOMMERCIAL ACTIVATION CERTIFICATE\nLicensee: ${license.customerName || 'Licensed Organization'}\nLicense Tier: ${meta.tier.toUpperCase()}\nLicense Key Status: VERIFIED ACTIVE\nExpires: ${license.expiresAt || 'Active Subscription'}\nAuthorized by: Frédéric Charles Viallet (skills.illicomedia.com)`;
        }
      } catch {
        // Fallback to generated license
      }
    }
  }

  // Standard MIT for free tier
  if (meta.tier === 'free') {
    return `MIT License

Copyright (c) 2026 Frédéric Charles Viallet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
  }

  // Commercial / Enterprise License
  return `Commercial Skills License

Copyright (c) 2026 Frédéric Charles Viallet. All rights reserved.

Licensee: ${license.customerName || 'Licensed Organization'}
License Tier: ${meta.tier.toUpperCase()}
License Key Status: VERIFIED ACTIVE
Expires: ${license.expiresAt || 'Active Subscription'}
Authorized by: Frédéric Charles Viallet (skills.illicomedia.com)

The material in this directory is proprietary commercial software licensed to the licensee named above.
No right is granted to redistribute, sublicense, publish publicly, sell, or create public derivative works.
Use is granted exclusively for internal development within the licensee's organization.`;
}

