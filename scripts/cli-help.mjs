// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/**
 * Help texts of the maintainer scripts, and the --help / -h detection they share. A script
 * asked for help prints its text on stdout and exits 0 before doing anything else, whatever
 * other options are on the command line.
 */

/** Whether the command line asks for help (--help or -h, anywhere). */
export function wantsHelp(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

export const RELEASE_HELP = `Usage: pnpm release [action] [options]

Prepares releases and moves "latest". CI publishes (a pushed v* tag, npm Trusted Publishing,
under "next"): this command never publishes, never unpublishes, never deprecates in bulk.
Steps that change shared state ask first, and refuse without a terminal unless --yes is given.

The process, in order (details: docs/operations/release-runbook.md):
  1. pnpm release --bump <level> --dry-run    preview: nothing is changed
  2. pnpm release --bump <level>              changelog, gates, commit, tag, push (asks)
  3. (CI) checks the tag, then stages the package on npm
  4. pnpm release --approve <version>         npm 2FA: public under "next"
  5. pnpm release --promote <version>         npm 2FA: moves "latest"

Without any action or --bump: shows the status (published versions, pending commits and
changelog notes, the next command) and this help. It changes nothing.

Actions (one at a time):
  --bump patch|minor|major      prepare: fixes only / new features / a "### Breaking" heading
  --bump major --preid rc       a release candidate (3.0.0-rc.0), staged under "next"
  --bump prerelease|release     the next candidate (rc.1) / the final version
  --ship [--bump <level>]       prepare, wait for CI, verify, promote
  --approve <version>           wait for staging, check the tarball, npm approve (2FA)
  --promote <version>           verify from npm, move "latest" (2FA)
  --publish-listing             retry the MCP Registry listing of this version
  --deprecate <version> --message "<reason>. Upgrade to <package>@<range> (<prerequisites>)."
                                one version, never "latest"
  --smoke-only [--tarball-dir <dir>]   pack (or take) a tarball and run an MCP session on it

Options:
  --dry-run                     show what would happen, change nothing
  --yes, -y                     answer yes to confirmations (needed without a terminal)
  --with-listing                with --promote or --ship: also list in the MCP Registry
  --help, -h                    this help

Used by CI (.github/workflows):
  --rehearse --tarball-dir <dir>         every push: the release path, staging as a dry run
  --expect-refusal --tarball-dir <dir>   Node 18/20: the installed package must refuse to start
  --check-tag <tag>                      the tag must match package.json; prints step outputs
  --stage --tarball-dir <dir>            stage the tarball on npm under "next"
  --github-release <tag> --tarball-dir <dir>   create the GitHub Release
  --release-notes <version>              print that version's changelog section

Before a release: CI green on main, notes under "## Unreleased" in CHANGELOG.md, npm login
(npm whoami). A failed gate restores package.json and CHANGELOG.md: nothing is committed.
`;

export const SETTINGS_HELP = `Usage: pnpm run github:check
       pnpm run github:apply [-- --yes]

Repository settings as code: compares the live GitHub settings with .github/settings.json.

Actions:
  --check                 read-only: lists every difference; exits 1 if any (github:check)
  --apply                 shows the changes, asks, applies them, reads them back (github:apply)

Options:
  --yes, -y               apply without asking (needed without a terminal)
  --token-file <path>     where the token is read (default: ~/.config/gh-setup/token)
  --help, -h              this help

The token: fine-grained, limited to this repository (Administration and Environments, read
and write), short-lived, in a file only you can read (chmod 600). GH_TOKEN or GITHUB_TOKEN
in the environment is used when the file is missing. The token is never printed.
`;

export const CHECK_CLEAN_HELP = `Usage: pnpm run check:clean

Runs "pnpm run check" on the committed state (HEAD) in an empty temporary folder, the way CI
sees it: no dist/, no node_modules, no uncommitted file. Run it before every push.

  1. exports HEAD (git archive) into a new temporary folder
  2. pnpm install --frozen-lockfile
  3. pnpm run check: lint, test types, dead code, duplicates, 100% coverage, tarball smoke test
  4. removes the folder; prints "check:clean passed on <commit>" and exits 0 when all passed

Uncommitted changes are not tested: commit first. Takes a few minutes; needs the npm registry
(or a warm pnpm store) for the install.

Options:
  --help, -h              this help
`;

export const COVERAGE_HELP = `Usage: pnpm run test:coverage

Builds, then runs every test (tests/**/*.test.ts) with the coverage gate: 100% of lines,
branches and functions, or exit 1. Coverage is measured on the built dist/ and on scripts/.

Environment:
  FREDO_TEST_ISOLATION_NONE=1   Node 24+: run all tests in one process (--test-isolation=none)

Options:
  --help, -h              this help
`;
