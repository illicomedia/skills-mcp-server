# Contributing to `@illicomedia/skills-mcp-server`

Thank you for your interest in improving Fredo QA Skills MCP Server.

## Prerequisites

- Node.js 22, 24 or 26 (`.nvmrc` pins the version used for development and releases; tests need 22.18 or later)
- pnpm, at the version pinned by `packageManager` in `package.json` (`corepack enable` picks it up)

```bash
git clone git@github.com:illicomedia/skills-mcp-server.git
cd skills-mcp-server
pnpm install
```

## Development flow

1. Branch from `main`; open a pull request back to `main`. Nothing is pushed to `main` directly.
2. Run the same gates CI runs, in one command:

   ```bash
   pnpm run check   # lint, build, tests with the 100% coverage gate, packed-tarball smoke test
   ```

   Or one at a time: `pnpm run lint` (Biome, zero warnings), `pnpm test` (builds first),
   `pnpm run test:coverage`, `pnpm run release:smoke`, `pnpm run lint:package` (publint).
3. Add a line under `## Unreleased` in `CHANGELOG.md` for anything a user would notice, under
   `### Added`, `### Changed`, `### Fixed` or `### Breaking`.
4. CI must be green: lint, build and coverage on Node 22, 24 and 26; the packed tarball installed and
   run on the first and latest release of each supported Node line, plus Windows and macOS; workflow lint.

Tests run against the compiled `dist/`, so `pnpm test` builds first. Fixtures live in `tests/fixtures/`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): ...`, `fix(scope): ...`,
`docs(scope): ...`, `chore(scope): ...`, `ci(scope): ...`, `test(scope): ...`. Add `!` after the
type for a breaking change. Every commit is focused, truthful and verified.

## Releases

Maintainers only. See [docs/operations/mcp-publish-process.md](docs/operations/mcp-publish-process.md):
`pnpm release --bump <patch|minor|major>` tags the release, GitHub Actions publishes it under `next`,
and `pnpm release --promote <version>` moves `latest`.
