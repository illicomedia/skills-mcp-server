# AGENTS.md - Fredo QA Skills Policy Directives

This project enforces formal engineering standards governed by **Fredo QA Skills**.
Any automated AI coding agent (Antigravity, Cursor, Claude Code, Copilot, Windsurf) working in this workspace
MUST read, discover, and strictly adhere to the installed QA skills.

## Active Installed Skills

- **`dev-flow`** (Free / MIT): Located at `.agents/skills/dev-flow/SKILL.md`
- **`qa-accessibility`** (Pro / Commercial): Located at `.agents/skills/qa-accessibility/SKILL.md`
- **`qa-bash`** (Free / MIT): Located at `.agents/skills/qa-bash/SKILL.md`
- **`qa-core`** (Free / MIT): Located at `.agents/skills/qa-core/SKILL.md`
- **`qa-gdpr-rgpd`** (Enterprise): Located at `.agents/skills/qa-gdpr-rgpd/SKILL.md`
- **`qa-javascript-typescript`** (Free / MIT): Located at `.agents/skills/qa-javascript-typescript/SKILL.md`
- **`qa-performance`** (Pro / Commercial): Located at `.agents/skills/qa-performance/SKILL.md`
- **`qa-security`** (Pro / Commercial): Located at `.agents/skills/qa-security/SKILL.md`
- **`qa-seo-website`** (Pro / Commercial): Located at `.agents/skills/qa-seo-website/SKILL.md`
- **`qa-well-known`** (Pro / Commercial): Located at `.agents/skills/qa-well-known/SKILL.md`

## Non-Negotiable Core Rules

1. **Local and CI Execution Parity**: Quality gates must execute with identical exit codes in local terminals and CI runners.
2. **Zero Hidden Debt**: Do not suppress linter errors with disable comments without documented justification.
3. **Exception Governance**: Failing quality gates require a formal entry in `.qa-exceptions.yaml` following the schema.
4. **No Fictive Implementations**: All code, package references, and commands must refer to real, tested implementations.
5. **Fast Feedback Inner Loop**: Ensure `starter` quality checks run cleanly before attempting merge or release gates.
