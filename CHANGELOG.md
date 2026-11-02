# Changelog

All notable changes to `@illicomedia/skills-mcp-server`. Versions follow [Semantic Versioning](https://semver.org/).

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
