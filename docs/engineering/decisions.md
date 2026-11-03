# Engineering Decisions

The guidelines this repository follows for releases, CI, supply chain, runtime support and tests,
with the reason for each and what enforces it. The publish process itself is in
[operations/mcp-publish-process.md](../operations/mcp-publish-process.md).

## Guiding principle

**When there is a choice, take the safest, most hardened and secure option.** Convenience, speed
and familiarity come after it. In practice:

- Prefer what cannot be changed behind our back (commit SHAs, digests, exact versions) over what can (tags, ranges).
- Prefer a human with a second factor as the last step of anything that reaches users.
- Fail closed: when a check cannot run or its answer is unclear, the action does not happen.
- Grant the least privilege that works, per job and per step.
- Verify instead of assuming (latest versions, hashes, CI status, registry state).
- State the residual risk honestly; "no risk" is never claimed, only reduced and named.
- Between two equally safe options, take the simpler one: fewer moving parts, fewer ways to fail.

Every decision below applies this principle.

**Changing a decision:** open a pull request that changes the code and this file together. Mark
the old entry `Superseded by D<n>` instead of deleting it, so the history of why stays readable.

| ID | Decision | Since |
| :--- | :--- | :--- |
| D1 | Only CI publishes, through npm Trusted Publishing | 2.0.0 |
| D2 | CI stages; a maintainer approves with 2FA | 2.0.0 |
| D3 | `next` first, `latest` by promotion; never unpublish, never bulk-deprecate | 2.0.0 |
| D4 | No release without a fully green CI | 2.0.0 |
| D5 | The tarball that is tested is the tarball that ships | 2.0.0 |
| D6 | Git tags and npm versions match 1:1 | 2.0.0 |
| D7 | Only Node.js lines with security fixes, enforced at startup | 2.0.0 |
| D8 | Pinned toolchain | 2.0.0 |
| D9 | Every third-party action and image pinned immutably | 2.0.0 |
| D10 | Third-party tools in CI run sealed | 2.0.0 |
| D11 | Least privilege in workflows | 2.0.0 |
| D12 | 100% coverage, independent of the machine | 2.0.0 |
| D13 | State-changing steps ask first and fail closed | 2.0.0 |
| D14 | Changelog written as work lands, stamped at release | 2.0.0 |
| D15 | Zero runtime dependencies | before 1.4 |
| D16 | Every platform in CI is required, macOS included | 2.0.0 |
| D17 | Minimal capabilities, checked on the shipped code | 2.0.2 |
| D18 | Workflows are tested like code | 2.0.3 |

---

## D1. Only CI publishes, through npm Trusted Publishing

**Decision.** Versions reach npm only from `.github/workflows/release.yml`, authenticated by npm
Trusted Publishing (short-lived OIDC credentials). No npm token is stored anywhere, and no laptop
runs `npm publish`.

**Why.** A stored token can leak and publish anything until revoked. OIDC credentials exist for
one workflow run, and bind the package to this repository, workflow and environment. Publishing
from CI also gives every version a provenance attestation linking it to its source commit.

**Enforced by.** Trusted Publisher on npmjs.com (repository `illicomedia/skills-mcp-server`,
workflow `release.yml`, environment `npm-publish`); package publishing access "require 2FA and
disallow tokens"; `scripts/release-flow.mjs` has no publish path (test: "CI publishes, never the
laptop").

## D2. CI stages; a maintainer approves with 2FA

**Decision.** The trusted publisher may only *stage* versions (`npm stage publish`). "Publish
directly" and "Manage dist-tags" are unchecked. A staged version becomes public only when a
maintainer runs `npm stage approve <id>` with 2FA.

**Why.** npm's recommendation. Even a compromised workflow cannot make a version public or move a
dist-tag: a human with a second factor is always the last step.

**Enforced by.** Trusted Publisher "Allowed actions" on npmjs.com; `release.yml` runs
`npm stage publish`; `pnpm release --ship` waits for the approval and prints the commands.

## D3. `next` first, `latest` by promotion; never unpublish, never bulk-deprecate

**Decision.** An approved version is public under `next`. `latest` moves only through
`pnpm release --promote <version>`, which installs the version from the registry and runs an MCP
session against it first. The same command rolls back. Versions are never unpublished (except a
leaked secret, by hand), and deprecation targets one broken version at a time, with the reason
and the replacement.

Only the newest patch of a supported major receives fixes, so older patches of a major are
unsupported and may be deprecated toward its newest patch. The last version of the previous major
stays undeprecated until that major's support ends (1.4.7 until 2027-05-03: it is also the only
version for Node.js 18 and 20, which 2.x refuses).

**Why.** Users pinning exact versions (as the README recommends) must not be warned off working
versions without a reason they can act on. A bad release is undone by moving `latest` back and
fixing forward. Unpublishing breaks pinned users and removes nothing already downloaded.

**Enforced by.** `promote` and `deprecate` in `scripts/release-flow.mjs` (tests: "verifies from
the registry, asks, then moves latest", "never deprecates anything"); `deprecate` refuses `latest`.

## D4. No release without a fully green CI

**Decision.** Two independent gates. `pnpm release` refuses unless every GitHub check on the exact
commit has finished green. `release.yml` runs the whole `ci.yml` on the release tag, and staging on
npm depends on it.

**Why.** The commit that ships must be the commit that passed, on every platform and Node.js line.
CI therefore runs twice on a release commit (once for the push to `main`, once inside the release
workflow), by design: the release's gate is produced by the release run itself, so no other
workflow, app check or stale result can satisfy it, and a re-run or a manually published tag is
always tested again. Do not replace it with a lookup of the `main` run's result.

**Enforced by.** `ciGate` in `scripts/release-flow.mjs` (reads
`/repos/{slug}/commits/{sha}/check-runs`; tests for red, pending, unreadable, non-GitHub);
`release.yml` job `ci: uses: ./.github/workflows/ci.yml` with `build` and `publish` needing it.

## D5. The tarball that is tested is the tarball that ships

**Decision.** CI packs once, installs that `.tgz` into an empty project, runs a full MCP session
(`initialize` with `protocolVersion`, `notifications/initialized`, `tools/list`,
`tools/call get_version`), then stages that same file.

**Why.** Re-packing or rebuilding between test and publish can ship something never tested.

**Enforced by.** `release.yml` (`pnpm pack` once, `--smoke-only --tarball`, `npm stage publish
release/*.tgz`); `smokeTestServer` in `scripts/release-lib.mjs`; `tests/package-e2e.test.ts`
(file list, manifest, shebang, install, session through the bin and its shim); `ci.yml` dry-runs
the exact `npm stage publish` command on every push, without credentials, so a broken publish
command fails before any release (2.0.0 was lost to one: `release/x.tgz` read as a GitHub repository).
npm refuses an existing version even in a dry run, so CI dry-runs a copy versioned
`<version>-ci.<run id>.<attempt>`, which can never exist on npm.

## D6. Git tags and npm versions match 1:1

**Decision.** Each version has one annotated tag `v<version>` on its release commit. The release
pushes `main` and that tag atomically; it never pushes other tags.

**Why.** Anyone can go from an npm version to its exact source, and a half-pushed release cannot
happen.

**Enforced by.** `--check-tag` in `release.yml` (refuses a tag that differs from `package.json`);
preflight refuses an existing tag or version; `git push --atomic origin main refs/tags/v<version>`.

## D7. Only Node.js lines with security fixes, enforced at startup

**Decision.** Supported: `^22.0.0 || ^24.0.0 || >=26.0.0`. The server refuses to start on any
other version, before reading anything. The upper bound is open so new lines work on day one.
Floors stay at `.0.0`: the server is offline and cannot know which patch fixes which CVE, and
raising a floor is itself breaking. When a line reaches end of life, it is dropped in the next
major release.

**Why.** The server reads whole codebases for an AI agent; it must not run on a runtime that no
longer receives security fixes. npm only *warns* about `engines`, so the server enforces it.

**Enforced by.** `src/security/runtime-guard.ts`, called first in `src/index.ts`; tests: the
guard equals `package.json` `engines`, and the real server started as Node 20 exits with
`[FATAL]`; CI runs the installed package on the first and latest release of each line
(22.0.0, 22.x, 24.0.0, 24.x, 26.0.0, 26.x) and checks that Node 18 and 20 are refused.

## D8. Pinned toolchain

**Decision.** pnpm is pinned by `packageManager`, Node.js by `.nvmrc` (24). Development needs
Node.js 22.18 or later (tests run `.ts` files directly). The build runs on every OS (no `chmod`
in scripts).

**Why.** Everyone, CI included, builds with the same tools; nobody debugs version drift.

**Enforced by.** `package.json`, `.nvmrc`, `scripts/postbuild.mjs`; CI reads both pins.

## D9. Every third-party action and image pinned immutably

**Decision.** Actions are pinned to a full 40-character commit SHA with the version in a comment
(`actions/checkout@<sha> # v7.0.1`). Docker images are pinned by digest, in a Dockerfile
(`.github/actionlint/Dockerfile`). Pins are set to the latest release, verified to be the commit
or digest of that release, and updated through Dependabot pull requests that CI checks.

**Why.** Tags can be re-pointed by whoever controls the upstream repository (the 2025
`tj-actions/changed-files` compromise); SHAs and digests cannot. Recommended by GitHub's security
hardening guide, OpenSSF Scorecard (Pinned-Dependencies) and SLSA.

**Enforced by.** The workflow files; `.github/dependabot.yml` (github-actions, docker, npm).
Optionally: the repository setting that requires actions pinned to a full SHA.

## D10. Third-party tools in CI run sealed

**Decision.** A third-party tool that acts as a gate runs in a container with no network, a
read-only repository and filesystem (writable `/tmp` only), all capabilities dropped,
`no-new-privileges`, and a non-root user.

**Why.** A gate that can be tampered with can approve what it should reject. Sealed, even a
malicious image can neither exfiltrate nor change code; with D9, it is also the exact image that
was verified.

**Enforced by.** `ci.yml` job `workflows` (actionlint).

## D11. Least privilege in workflows

**Decision.** Workflows default to `permissions: {}` or `contents: read`, and each job gets only
what it needs (`id-token: write` only in `publish`, `contents: write` only in `github-release`).
Checkouts use `persist-credentials: false`. The `npm-publish` environment accepts only tags
matching `v*` (a *Tag* rule, not a branch rule). Untrusted values reach shell scripts through
environment variables, never `${{ }}` inside `run:`.

**Why.** A step that is compromised can only do what its job is allowed to do.

**Enforced by.** The workflow files; actionlint in CI; the environment's deployment rule.

## D12. 100% coverage, independent of the machine

**Decision.** Lines, branches and functions stay at 100%. Tests never depend on the machine
(home folder content, installed tools beyond Node.js, pnpm and npm) and never modify repository
files: they create what they need in temporary folders. Code that touches git, npm or the file
system takes it as a parameter, so tests can drive it with fakes.

**Why.** A gate that passes locally and fails in CI (or the reverse) is noise. CI once fell to
96.30% because a test only ran when `~/.ssh` existed; another renamed the real `LICENSE` while
parallel tests packed the package.

**Enforced by.** `test:coverage` thresholds; `tests/release-flow.test.ts` (fake git/npm runner);
the fake-home `.ssh` test; `src/license/lock.ts` tested with temporary folders.

## D13. State-changing steps ask first and fail closed

**Decision.** Every step of `pnpm release` that changes git or npm asks for confirmation; without
a terminal it refuses unless `--yes` is given. Every command has `--dry-run`.

**Why.** An unattended run must never default to a destructive action.

**Enforced by.** `approve` in `scripts/release-flow.mjs` (test: "fails closed without a terminal").

## D14. Changelog written as work lands, stamped at release

**Decision.** Pull requests add lines under `## Unreleased` (`### Added`, `### Changed`,
`### Fixed`, `### Breaking`). `pnpm release` turns that section into `## <version> - <date>`.
A `### Breaking` entry means a major version.

**Why.** Release notes are written when the context is fresh, and GitHub Releases reuse them.

**Enforced by.** `stampChangelog` (refuses a release without notes); the PR template; the
release workflow's `--release-notes`.

## D15. Zero runtime dependencies

**Decision.** The published package has no `dependencies`; it uses only Node.js built-ins.

**Why.** No third-party code runs where the server reads users' codebases.

**Enforced by.** `tests/package-e2e.test.ts` ("zero runtime dependencies").

## D16. Every platform in CI is required, macOS included

**Decision.** Windows and macOS jobs are required, like Linux, even though hosted macOS runners
can queue for several minutes.

**Why.** "Fully green" (D4) means every platform users run the server on. A few minutes of queue
per release is cheaper than discovering a platform break after it shipped.

When GitHub has no macOS runner available, the job is cancelled after waiting ("not acquired by
Runner"). That is GitHub's capacity, not the code: re-run the failed job. `timeout-minutes` limits
how long a running job may take; it does not shorten the wait for a runner.

**Enforced by.** `ci.yml` job `runtime` (no `continue-on-error`); `timeout-minutes` on every job.

## D17. Minimal capabilities, checked on the shipped code

**Decision.** The server keeps only the capabilities its features need: file system access for
audits and skill installs; one environment variable, `FREDO_QA_LICENSE_FILE`, read by name; no
network, no child processes, no dynamic code. Unused capability code is removed, not kept
"for later" (`FREDO_QA_API_URL` configured an API the server never called). The build starts from
an empty `dist/`, so no stale file can ship.

`FREDO_QA_LICENSE_FILE` is kept on purpose (2026-11-03): it is the documented way to point an MCP
client at a paid license, it holds a path and no secret, and removing it would break paid setups.
Socket's `envVars` alert for that one variable is accepted. Removing it would only be considered
in a future major, in favour of a command-line argument or file discovery only.

**Why.** Every capability is attack surface and a supply-chain alert (Socket `envVars` flagged the
whole-environment read and the unused API override). What is declared in README and SECURITY.md
must be exactly what ships.

**Enforced by.** `tests/capabilities.test.ts` (scans `dist/` for environment, network, process
and dynamic-code access, and allows only the four declared links shown to people); `tests/package-e2e.test.ts` (every shipped file has a current source);
`scripts/clean-dist.mjs` (`prebuild`).

## D18. Workflows are tested like code

**Decision.** Workflow files hold no logic: every `run:` calls a command of `scripts/release.mjs`
(covered by the 100% gate), `pnpm`, or a pinned, sealed tool. The release path runs on every push
up to a dry run of staging (`--rehearse`). zizmor audits the workflows for security problems next
to actionlint, pinned by digest, sealed and offline; each exception is justified in
`.github/zizmor.yml`. Policy tests read the workflow files and enforce the decisions above.

**Why.** Three release failures on 2026-11-03 came from shell code in workflow files that no test
reached: a tarball path npm read as a GitHub repository, a dry run that refused an existing
version, and a check that only ran on the maintainer's machine. zizmor found cache poisoning in
the release jobs on its first run. A decision that is only written down erodes; one that fails CI
does not.

**Enforced by.** `tests/workflows.test.ts` (pins, permissions, credentials, caches, `${{ }}` in
shell, thin `run:` steps, sealing, staging after full CI, rehearsal, Node.js matrices derived from
`engines`, required platforms, time limits); the `workflows` job (actionlint, zizmor);
`tests/release-flow.test.ts` (every command the workflows call). The policy tests were checked by
breaking rules on purpose: each break fails them.
