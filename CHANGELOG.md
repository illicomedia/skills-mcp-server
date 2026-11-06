# Changelog

All notable changes to `@illicomedia/skills-mcp-server`. Versions follow [Semantic Versioning](https://semver.org/).

Add notes under `## Unreleased` as you work; `pnpm release` turns that section into the version's.

## Unreleased

## 3.1.0 - 2026-11-06

### Added

- Preflight audit (`quick_check`): report `stack` (detected languages, web vs non-web, forge) and `summary.ok` / `summary.attention` so agents list passing checks as well as failures, not only remediation recommendations.

### Fixed

- Preflight audit (`quick_check`): stop treating a bare `dist/` or `public/` directory as a website. Node CLI/MCP/library packages with compile output no longer fail for missing `public/.well-known/security.txt` when `SECURITY.md` is present; RFC 9116 `security.txt` remains required only for detected HTTP/HTTPS web origins (document root, web frameworks, Vite/Webpack static sites, nested `website|apps/web|client` packages).
- Skill detection: select `qa-mcp` from MCP Registry signals (`package.json` `mcpName`, `server.json`) or `@modelcontextprotocol/*` dependencies, not a bare `modelcontextprotocol` substring in `package.json`.
- Test coverage gate: emit without `useDefineForClassFields` so V8 does not count empty `<instance_members_initializer>` functions that process-isolated coverage could leave as false gaps.

## 3.0.1 - 2026-11-05

### Changed

- Support policy: only the latest major version is supported. 1.x and 2.x are end of life and are deprecated on npm, pointing to `^3.0.0`. This withdraws the six months of security fixes announced for 2.x with 3.0.0, so that every user runs the hardened code.

### Fixed

- Security: strict validation of the `confirm` boolean parameter and runtime schema types in `validateToolParams`. Passing non-boolean values (such as string `"false"` or number `0`) no longer coerces to `true`, preventing dry-run confirmation bypass.
- Security: `validateSafeProjectPath` resolves the canonical realpath to prevent symlink traversal to root and sensitive credential directories (`~/.ssh`, `~/.aws`, etc.).
- Security: release preparation automatically stamps `SERVER_RELEASE_DATE` in `src/license/keys.ts` with the release date, and a continuous policy test enforces that `SERVER_RELEASE_DATE` matches `CHANGELOG.md` to prevent license version retention bypass.
- Cleaned up private repository deployment script references in skill detection heuristics.

## 3.0.0 - 2026-11-04

**Why 3.0:** a supply-chain hardening release. The server now reads no environment variable and all
file access goes through one audited module. Only setups that point at a license with
`FREDO_QA_LICENSE_FILE` need a one-minute change (below); everything else works as in 2.0.x, which
keeps receiving security and critical fixes for 6 months.

### Breaking

- The server reads no environment variable. `FREDO_QA_LICENSE_FILE` is ignored: place the license at `~/.config/fredo-qa/license.json` or the project's `.qa-license.json`, or load it with `set_license_key`. Only setups that used the variable are affected.

### Changed

- Uninstall guide: a notice about QA files an AI agent may have created (`scripts/qa.sh`, `scripts/qa/<profile>.d/`), from server versions before 1.4.5 or the `qa-core` skill's optional template, and how to check whether anything still uses them before removing them.
- All file access goes through one audited module (`security/path-guard`). Every write checks its target against the project root before acting, including skill archiving, which previously relied on the caller's checks. Nothing changes for normal use.

## 2.0.2 - 2026-11-03

### Changed

- The server reads exactly one environment variable, `FREDO_QA_LICENSE_FILE`, by name; it no longer reads the whole environment. A test enforces it on the built package, along with no network and no child processes.
- The package contains only four links, shown to people and never fetched; a test rejects any other URL.

### Removed

- `FREDO_QA_API_URL`: it configured an API address the server never called. Nothing changes for users.

## 2.0.1 - 2026-11-03

### Fixed

- First published 2.x release. 2.0.0 was tagged but never reached npm: the release workflow passed the tarball to `npm stage publish` as `release/<file>.tgz`, which npm reads as a GitHub repository. It now passes an absolute path, and CI dry-runs that exact command on every push. Upgrading from 1.x: see the 2.0.0 notes below (Node.js 22, 24 or 26+ required).

## 2.0.0 - 2026-11-03

Not published to npm (see 2.0.1).


### Breaking

- Requires Node.js 22, 24 or 26+ (`^22.0.0 || ^24.0.0 || >=26.0.0`). The server refuses to start on Node.js lines without security fixes (18, 20 and odd-numbered lines), because it reads your codebase. Upgrade Node.js, or point your MCP client's `command` at a supported `node` binary.

### Changed

- Releases are staged on npm by GitHub Actions through npm Trusted Publishing, with provenance attestations, only after the full CI passes on the release tag; a maintainer approves each version with 2FA before it goes public under `next`, and `latest` moves only after the published version is verified.
- The release script no longer deprecates older versions automatically.

## 1.4.7 - 2026-11-02

### Changed

- Transitioned repository governance to official organization repository `github.com/illicomedia/skills-mcp-server`.
- Enhanced release automation script with automated Git release tagging and changelog summary extraction.
- Added comprehensive operational publishing documentation in `docs/operations/mcp-publish-process.md`.

## 1.4.6 - 2026-11-02

### Changed

- Updated `qa-rust` catalog metadata to v1.3.0 (`forbid(unsafe_code)`, Clippy panic-restriction and `# Errors` doc-contract lints, pure domain/parser architectural boundary isolation, and adversarial input complexity bounds).
- Refined `README.md` prompt examples to emphasize deterministic engineering contract enforcement and `qa-core` evidence verification over generic LLM advice.

## 1.4.5 - 2026-11-02

### Added

- Vibe coding documentation: added natural language prompting examples for all core tools and developer intents in `README.md`.
- Safety and transport documentation: clarified the `stdio` architecture (zero open ports, kernel pipe containment, automatic lifecycle termination) and why running `npx` directly in an interactive shell pauses waiting for JSON-RPC input.

### Changed

- Preflight audit (`quick_check`): codified native toolchain recognition (`cargo`, `pytest`, `npm test`, `go test`, `make`) as first-class citizens, guaranteeing zero unsolicited wrapper scripts (`scripts/qa.sh`).

## 1.4.4 - 2026-11-02

### Changed

- The commercial license text now matches the terms of sale, which prevail: client work is allowed and termination for breach is what ends the license.
- Preflight audit (`quick_check`): treat missing `AGENTS.md` as advisory info for human-only workflows, recognize local QA runners (`scripts/qa.sh`, `Makefile`, git hooks) and multi-forge CI definitions (GitLab, Forgejo, Bitbucket, Azure, Woodpecker, Jenkins), decouple advisory checks from readiness status, and provide forge-tailored recommendations.

## 1.4.3 - 2026-11-01

### Fixed

- The published package no longer declares the repository's pnpm-only rule, which could stop `npm` and `npx` with `EBADDEVENGINES`.

## 1.4.2 - 2026-11-01

Internal quality release: behaviour is unchanged for users, and the server still makes no API calls.

### Changed

- The API endpoint defaults to `/api/v1`, and `FREDO_QA_API_URL` must be HTTPS.
- Source reorganized, with 100% test coverage enforced.
- Releases now go through the `next` tag before reaching `latest`.

## 1.4.1 - 2026-10-30

### Changed

- The commercial license text no longer limits use to "seats bought".

## 1.4.0 - 2026-10-26

### Added

- `prune_skills` tool, with safe archiving.

Earlier versions are not recorded here.
