# Changelog

All notable changes to `@illicomedia/skills-mcp-server`. Versions follow [Semantic Versioning](https://semver.org/).

Add notes under `## Unreleased` as you work; `pnpm release` turns that section into the version's.

## Unreleased

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
