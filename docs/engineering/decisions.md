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
| D19 | Listed in the official MCP Registry, pointing at npm | 3.0.0 |
| D20 | GitHub settings as code | 3.0.0 |
| D21 | Strict schema retro-compatibility and normalized deprecation specification | 3.0.1 |

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

A major version is released first as candidates (`3.0.0-rc.N`, `--preid rc`) under `next`;
candidates can never become `latest` (`--promote` accepts only `x.y.z`). Breaking changes are
batched into one major instead of released one by one.

Only the latest major is supported, and only its newest patch receives fixes; older patches of it
may be deprecated toward that patch. When a major ships, older majors reach end of life at once and
are deprecated on npm, one version at a time, with a D21 message pointing to the new major. (Changed
with 3.0.1: 3.0.0 had announced six months of security fixes for 2.x. 1.x and 2.x are deprecated
toward `^3.0.0`; the registry in `docs/operations/mcp-publish-process.md` lists the messages and
whether they are applied.)

**Why.** One supported line means every user runs the hardened code: a second line would ship
each security fix twice and keep users on the weaker one. Users pinning exact versions (as the
README recommends) must not be warned off working versions without a reason they can act on. A bad release is undone by moving `latest` back and
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
audits and skill installs; no environment variables; no network, no child processes, no dynamic
code. Unused capability code is removed, not kept
"for later" (`FREDO_QA_API_URL` configured an API the server never called). The build starts from
an empty `dist/`, so no stale file can ship.

The server reads **no environment variable** (since 3.0.0). Licenses are found only at fixed
locations (`~/.config/fredo-qa/license.json`, the project's `.qa-license.json`) or loaded with
`set_license_key`. `FREDO_QA_LICENSE_FILE` was removed as a breaking change, batched into 3.0.0
with the other breaking changes rather than released alone.
*Superseded (2026-11-03): an earlier choice kept `FREDO_QA_LICENSE_FILE` and accepted Socket's
`envVars` alert; the owner chose zero environment access instead.*

**Why.** Every capability is attack surface and a supply-chain alert (Socket `envVars` flagged the
whole-environment read and the unused API override). What is declared in README and SECURITY.md
must be exactly what ships.

All disk access goes through one module, `src/security/path-guard.ts`: read helpers, and write
helpers (`*Inside`) that check their target against the project root before acting, so a write
cannot forget the check. Moving or removing a symlink acts on the link, never on its target.

**Enforced by.** `tests/capabilities.test.ts` (scans `dist/` for environment, network, process
and dynamic-code access, allows only the four declared links shown to people, and allows
`node:fs` only in `security/path-guard.js`); `tests/path-guard-writes.test.ts` (each write helper
refuses targets outside the root and through outside symlinks); `tests/package-e2e.test.ts` (every shipped file has a current source);
`scripts/clean-dist.mjs` (`prebuild`).

## D18. Workflows are tested like code

**Decision.** Workflow files hold no logic: every `run:` calls a command of `scripts/release.mjs`
(covered by the 100% gate), `pnpm`, or a pinned, sealed tool. The release path runs on every push
up to a dry run of staging (`--rehearse`). zizmor audits the workflows for security problems next
to actionlint, pinned by digest, sealed and offline; each exception is justified in
`.github/zizmor.yml`. Policy tests read every workflow file and enforce the decisions above; a new
workflow file fails them until it is reviewed and listed. OpenSSF Scorecard rates the whole setup,
repository settings included, every week.

**Why.** Three release failures on 2026-11-03 came from shell code in workflow files that no test
reached: a tarball path npm read as a GitHub repository, a dry run that refused an existing
version, and a check that only ran on the maintainer's machine. zizmor found cache poisoning in
the release jobs on its first run. A decision that is only written down erodes; one that fails CI
does not.

The code itself stays lean: knip finds no unused file, export or dependency, and jscpd no
duplicated block (50 tokens, tests included, threshold 0); both run in `pnpm run check` and CI.
An export used only by tests (which import `dist/`) is marked `@public`. knip builds first
(`prelint:dead`): it only maps the tests' `dist/` imports back to `src/` when `dist/` exists.

**Nothing is pushed before every gate is green locally on the committed state**, checked in a
clean copy with `pnpm run check:clean` (no `dist/` or other leftovers), so CI is never the first
place a failure shows up. On 2026-11-03 knip passed in a working copy and failed in CI.

**Enforced by.** `tests/workflows.test.ts` (pins, permissions, credentials, caches, `${{ }}` in
shell, thin `run:` steps, sealing, staging after full CI, rehearsal, Node.js matrices derived from
`engines`, required platforms, time limits); the `workflows` job (actionlint, zizmor);
`tests/release-flow.test.ts` (every command the workflows call). The policy tests were checked by
breaking rules on purpose: each break fails them.

## D19. Listed in the official MCP Registry, pointing at npm

**Decision.** npm stays the only place the package is published. The official MCP Registry
(registry.modelcontextprotocol.io) gets a listing, `server.json` in this repository, that points
at the npm package; MCP directories and clients read from it. JSR, GitHub Packages and mirrors are
not used (a second artifact to secure for no benefit; GitHub Packages needs a token to install).
A container image is a possible later feature, not a mirror.

The listing is published at the promote step, from the maintainer's machine, because the registry
checks that the npm version is public and carries `"mcpName"`; staged versions are not. The tool is
`mcp-publisher` at exactly the pinned version, installed from its release and verified against its
Sigstore signature. Rollbacks never touch the listing.

The listing is **opt-in** (`--promote <version> --with-listing`, or `--publish-listing` later): a
plain promote never contacts the registry. *Postponed (2026-11-04): not published yet while the
listing is tested; 3.0.0 ships `mcpName` so it can be listed later.*

**Why.** Discoverability where MCP users look, with no second copy of the code: the registry
verifies ownership through the npm package itself (`mcpName`) and a GitHub login.

**Enforced by.** `listingProblems` (name equals `mcpName`, version, the one npm package over stdio,
100-character description); the test that `server.json` matches `package.json`; the package test
that `mcpName` ships; `publishListing` (public on npm, published `mcpName`, pinned tool version,
`mcp-publisher validate`, skip when listed); `prepare` keeps `server.json` at the released version.

## D20. GitHub settings as code

**Decision.** The repository's GitHub settings are declared in `.github/settings.json`, reviewed
like code, and checked or applied by `scripts/github-settings.mjs` through the GitHub API:
- rulesets: `main` cannot be deleted or force-pushed (no bypass); only admins create `v*` tags;
  no one, admins included, moves or deletes them (two rulesets, because a bypass actor bypasses
  every rule of its ruleset);
- `npm-publish`: `illicomedia` reviews each publish, admins cannot bypass, only `v*` tags deploy;
- Actions: only GitHub-owned actions and the listed ones, pinned to a full commit SHA; read-only
  default token; Actions cannot approve pull requests; fork pull requests need approval;
- security: private vulnerability reporting, Dependabot alerts and security updates, secret
  scanning and push protection.

The script uses a fine-grained token limited to this repository (Administration and Environments),
valid one day, in a file only its owner can read; it refuses a readable file and never prints the
token. `--check` is read-only; `--apply` asks, applies in a safe order, and reads everything back.
It never deletes: undeclared rulesets or policies are reported as drift.

**Why.** Settings clicked in a UI are invisible, unreviewed and drift silently; as code they are
reviewed, repeatable and checkable.

**Enforced by.** `tests/github-settings.test.ts` (a stateful fake GitHub: configuration from scratch
in a safe order, nothing to do when matching, updates in place, drift reported and never deleted,
confirmation and fail-closed, API errors, sparse answers, every action the workflows use allowed).

## D21. Strict schema retro-compatibility contract and normalized deprecation specification

**Decision.** The server and all connected systems treat past published versions (1.4.x, 2.0.x, 3.x)
as active consumers whose operational interfaces must not be broken arbitrarily.

1. **Request Schema Retro-Compatibility (Tolerant Reader & Additive-Only):**
   - **Additive properties only:** Any parameter added to an existing tool in a minor or patch release
     MUST be optional (`required: [...]` cannot receive new fields).
   - **Safe fallback defaults:** When an older client omits a parameter, the server provides a safe,
     non-destructive fallback (e.g. `confirm: false` defaults to safe dry-run preview; `skills`
     defaults to automatic workspace stack detection).
   - **Strict type checking without coercive traps:** Tool inputs must strictly conform to their declared
     schema type (`boolean`, `string`, `array`, `number`) and reject mismatched types with JSON-RPC
     code `-32602`. Coercion traps (`Boolean("false") === true`) are strictly forbidden.

2. **Response Schema Stability:**
   - Tools always return `{ content: [{ type: "text", text: string }] }` conforming to the MCP transport.
   - For tools returning JSON within `text` (`quick_check`, `install_skill`, `get_version`,
     `verify_license`), existing property keys and types are immutable across minor/patch releases.
     New metadata fields (`update_available`, `protocol_version`, `schema_version`) are purely additive.

3. **Ecosystem & License Backward Compatibility:**
   - `LICENSE_SCHEMA_VERSION = 1`: all v1 licenses remain permanently valid and parsable by future builds.
   - External endpoints (pricing, schema downloads): query parameters such as `?mcp_v=${SERVER_VERSION}`
     are additive. Web APIs and routers MUST handle legacy clients that omit `?mcp_v` gracefully without
     redirect loops or errors.
   - **Sensitive API Calls Enforcement (POST Payload Priority):** All programmatic API endpoints handling
     sensitive metadata (version checks, license validation, update notices, skill delivery) MUST use
     HTTP `POST` with a JSON body (`Content-Type: application/json`), never `GET` query strings. This ensures
     payloads remain encrypted in TLS transit and are shielded from server access logs, CDN logs, proxy
     inspectors, and log-sniffing pipelines.

4. **Normalized Deprecation Specification:**
   - Every deprecation applied to npm via `npm deprecate` or `pnpm release --deprecate` must follow
     the standard structure:
     `"<Cause/Reason>. Upgrade to <Package>@<TargetRange> (<Prerequisites>)."`
   - **Rules:**
     - *Cause first:* State the technical or security lifecycle reason (End-of-Life, Security Advisory, Runtime obsolescence).
     - *Actionable target:* Explicit package name and semver range (`@illicomedia/skills-mcp-server@^3.0.0`).
     - *Prerequisites:* Explicitly state breaking runtime requirements (`requires Node 22+`).
     - *No raw shell commands:* Do not suggest dangerous automated CLI commands to autonomous agents.
     - *Registry log:* Log every deprecated version in the Deprecation Registry in `docs/operations/mcp-publish-process.md`.

**Why.** Users pin exact versions or run older releases in varied CI and devcontainer environments.
Breaking input/output formats breaks AI agents silently or triggers unexpected failures. A formal
deprecation format ensures human developers and AI coding agents receive clear, actionable upgrade
guidance rather than cryptic crash logs.

**Enforced by.** Tool schema validation tests in `tests/mcp-server.test.ts`; `deprecationProblems`
in `scripts/release-lib.mjs`, which `pnpm release --deprecate` runs before any registry call (tests:
"Deprecation messages follow D21", "deprecate: one version, never latest, a D21 message"); and the
package e2e suite.
