import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveSkillLicense } from '../license/templates.js';
import type { LicenseValidationResult, SkillMetadata, SkillTier } from '../types.js';

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
    rulesSummary: [
      '100% type coverage without Any',
      'Ruff check & format',
      'Pytest branch coverage >= 90%',
    ],
  },
  {
    id: 'qa-javascript-typescript',
    name: 'JavaScript & TypeScript Quality',
    tier: 'free',
    category: 'language',
    description: 'Strict type checking, Biome formatting, Vitest coverage, and Core Web Vitals.',
    rulesSummary: [
      'tsc --noEmit clean',
      'Biome check with zero debt',
      'Coverage threshold enforcement',
    ],
  },
  {
    id: 'qa-php',
    name: 'PHP Quality Engineering',
    tier: 'free',
    category: 'language',
    description: 'PHPStan max level, Pint/PHP-CS-Fixer formatting, and boundary architecture.',
    rulesSummary: [
      'PHPStan level max',
      'Hardened public forms (HMAC captcha, honeypot, rate limit)',
      'Architecture boundaries',
    ],
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
    rulesSummary: [
      'JSON-RPC 2.0 contract tests',
      'Stdio pollution prevention',
      'Graceful error handling',
    ],
  },
  {
    id: 'qa-c-cpp',
    name: 'C & C++ Systems Engineering',
    tier: 'free',
    category: 'language',
    description:
      'clangd LSP diagnostics, clang-tidy, cppcheck, sanitizers (ASan/UBSan/TSan), and memory safety.',
    rulesSummary: [
      'clangd semantic validation',
      'ASan/UBSan clean execution',
      'Strict compiler warnings (-Werror)',
    ],
  },
  {
    id: 'qa-rust',
    name: 'Rust Systems Engineering',
    tier: 'free',
    category: 'language',
    description:
      'Clippy -D warnings & panic-restriction lints, forbid(unsafe_code), pure architectural boundaries, adversarial input bounds, cargo-deny, cargo-audit, and Miri.',
    rulesSummary: [
      'cargo clippy --all-targets -- -D warnings (plus unwrap_used / expect_used / missing_errors_doc bans)',
      '#![forbid(unsafe_code)], pure domain/parser boundaries, and adversarial input caps',
      'cargo fmt --check, cargo deny check, cargo audit, and Miri',
    ],
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
    description:
      'Checkstyle, SpotBugs, PMD, Error Prone, JaCoCo branch coverage >= 80%, and ArchUnit boundaries.',
    rulesSummary: [
      'javac -Werror clean compile',
      'SpotBugs & PMD zero violations',
      'JaCoCo line & branch coverage >= 80%',
    ],
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
    rulesSummary: [
      'Dependency audit clean',
      'CSP on every deploy variant; hosts = active integrations',
      'Server-verified anti-bot for public forms',
    ],
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
    id: 'qa-gdpr-rgpd',
    name: 'GDPR / RGPD Privacy Engineering',
    tier: 'pro',
    category: 'compliance',
    description:
      'Privacy by design, CNIL public-web gates, consent parity, data subject rights (DSR), RoPA, and DPIA.',
    rulesSummary: [
      'Equal refuse/accept consent; no unconsented trackers',
      'Art.13 forms + server-verified captcha + retain-until',
      'RoPA/CSP/legal copy lockstep with processing flags',
    ],
  },
  {
    id: 'qa-seo-website',
    name: 'Technical SEO & Search Visibility',
    tier: 'pro',
    category: 'quality',
    description:
      'Pre-rendered metadata, JSON-LD structured data, canonical tags, GEO/AEO optimization.',
    rulesSummary: [
      'Unique title and description per route',
      'Valid Schema.org JSON-LD',
      'Canonical tag parity',
    ],
  },
  {
    id: 'qa-well-known',
    name: 'Well-Known URI Standards',
    tier: 'pro',
    category: 'compliance',
    description:
      'RFC 9116 security.txt validation, robots.txt, sitemap.xml, and IANA registry conformance.',
    rulesSummary: ['Valid security.txt syntax', 'Canonical link directive', 'Future expiry date'],
  },
  {
    id: 'qa-emails-dns',
    name: 'Email & DNS Security',
    tier: 'pro',
    category: 'compliance',
    description: 'SPF, DKIM, DMARC p=reject, BIMI assertions, and DNS drift detection.',
    rulesSummary: [
      'DMARC p=quarantine or reject',
      'X-Retain-Until on personal-data operator mail',
      'BIMI indicator validation',
    ],
  },
  {
    id: 'qa-cnil',
    name: 'CNIL RGPD Article 30 Processing Register',
    tier: 'pro',
    category: 'compliance',
    description:
      'Automated CNIL Article 30 Records of Processing Activities (RoPA) extraction, JSON pivot, and ODS export.',
    rulesSummary: [
      'Automated personal data mapping',
      'Article 30.1 Controller and 30.2 Processor register separation',
      'OpenDocument Spreadsheet (.ods) export following the CNIL template',
    ],
  },

  // Enterprise
  {
    id: 'qa-devops',
    name: 'DevOps & CI/CD Security',
    tier: 'enterprise',
    category: 'compliance',
    description:
      'GitHub Actions hardening, Dockerfile linting, container security, and IaC scanning.',
    rulesSummary: ['Pinned Action SHAs', 'Trivy container scan clean', 'Least-privilege tokens'],
  },
  {
    id: 'qa-ai-infrastructure-compliance',
    name: 'AI Infrastructure & NIS2 Governance',
    tier: 'enterprise',
    category: 'compliance',
    description: 'ISO 42001, NIS2 Directive mapping, EU AI Act risk classification, SOC2 Type II.',
    rulesSummary: [
      'AI risk tiering documented',
      'NIS2 incident notification readiness',
      'Auditable evidence export',
    ],
  },
  {
    id: 'qa-cra-software-supply-chain',
    name: 'CRA & Supply Chain Security',
    tier: 'enterprise',
    category: 'compliance',
    description:
      'EU CRA requirements, CycloneDX/SPDX SBOMs, SLSA Level 3 provenance, and Sigstore signing.',
    rulesSummary: [
      'CycloneDX v1.6 SBOM generated',
      'SLSA Level 3 provenance verified',
      'VEX statements published',
    ],
  },
  {
    id: 'qa-pci-dss',
    name: 'PCI-DSS v4.0 Payment Security',
    tier: 'enterprise',
    category: 'compliance',
    description:
      'Cardholder Data Environment isolation, client-side tokenization, PAN masking, and audit trails.',
    rulesSummary: [
      'Zero SAD/CVV retention',
      'Client-side payment tokenization',
      'Strict PAN masking',
    ],
  },
  {
    id: 'qa-health-data-compliance',
    name: 'Health Data (HDS & HIPAA)',
    tier: 'enterprise',
    category: 'compliance',
    description:
      'French HDS v2.0, HIPAA Security Rule, HL7 FHIR validation, and PHI pseudonymization.',
    rulesSummary: [
      'Envelope encryption with HSM',
      'HL7 FHIR SMART-on-FHIR scopes',
      'Immutable access audit logging',
    ],
  },
  {
    id: 'qa-enterprise-iam-sso',
    name: 'Enterprise IAM & SSO Federation',
    tier: 'enterprise',
    category: 'compliance',
    description:
      'SAML 2.0 XML signatures, OIDC with PKCE, SCIM 2.0 provisioning, and multi-tenant isolation.',
    rulesSummary: [
      'SAML XML signature & replay check',
      'SCIM instant deprovisioning',
      'Multi-tenant isolation verified',
    ],
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
  const base = searchDir ?? process.cwd();
  const candidatePaths = [
    path.join(base, 'skills', 'free', skillId, 'SKILL.md'),
    path.join(base, 'skills', 'pro', skillId, 'SKILL.md'),
    path.join(base, 'skills', 'enterprise', skillId, 'SKILL.md'),
    path.join(base, 'skills', skillId, 'SKILL.md'),
    path.join(base, '.agents', 'skills', skillId, 'SKILL.md'),
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

  // The package ships no skill files. Never synthesize rules: an agent would follow
  // invented directives (e.g. scripts the project does not have).
  throw new SkillNotInstalledError(skillId, candidatePaths);
}

export const SKILL_PAGE_BASE_URL = 'https://www.illicomedia.com/qa-skills/skills';

/**
 * Raised when a known skill has no SKILL.md on disk. The message tells the agent to stop
 * and how the developer can install the skill, instead of letting it improvise rules.
 */
export class SkillNotInstalledError extends Error {
  constructor(
    public readonly skillId: string,
    public readonly searchedPaths: string[],
  ) {
    super(
      `Skill '${skillId}' is not installed in this project: no SKILL.md found ` +
        `(searched: ${searchedPaths.join(', ')}). This MCP server does not ship skill files. ` +
        `Ask the developer to download the skill from ${SKILL_PAGE_BASE_URL}/${skillId} ` +
        `and extract it into .agents/skills/${skillId}/, then retry. ` +
        `Do not apply or invent rules for this skill until it is installed.`,
    );
    this.name = 'SkillNotInstalledError';
  }
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
  return resolveSkillLicense(meta, license, searchDir);
}
