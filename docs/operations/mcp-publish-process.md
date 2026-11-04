# MCP Server Publish & Release Process

**Package:** [`@illicomedia/skills-mcp-server`](https://www.npmjs.com/package/@illicomedia/skills-mcp-server)
**Repository:** [github.com/illicomedia/skills-mcp-server](https://github.com/illicomedia/skills-mcp-server)
**Publisher:** GitHub Actions (`.github/workflows/release.yml`) through npm Trusted Publishing
**Why it works this way:** [engineering decisions](../engineering/decisions.md) (D1 to D16)
**Releasing now?** Follow the step-by-step [release runbook](release-runbook.md).

---

## 1. Principles

1. **Only a fully green CI publishes.** A version reaches npm from `release.yml`, triggered by a `v<version>` tag, with a provenance attestation, and only after the whole CI workflow has passed on that tag. `pnpm release` also refuses to tag a commit whose GitHub checks are not all green. No laptop runs `npm publish`, and no long-lived npm token exists.
2. **A release reaches users in three gates.** CI *stages* the version (staged publishing: the trusted publisher may not publish directly); a maintainer approves it with 2FA, which makes it public under `next`; a maintainer moves `latest` after checking it (`--promote`). The same command rolls back.
3. **Git tags and npm versions match 1:1.** CI refuses to publish when the tag is not exactly `v` + the `package.json` version.
4. **The tarball that is tested is the tarball that ships.** CI packs once, smoke-tests that file, and publishes that file.
5. **A published version is permanent.** Problems are fixed by publishing a new version, never by removing an old one.
6. **Deprecation means "do not use this version".** One broken or unsupported version at a time, with the reason and the replacement, by hand. A working version is never deprecated because a newer one exists.
7. **Unpublishing is for emergencies only** (a leaked secret, section 7), by hand.

---

## 2. Choosing the Version Number

| Bump | When | Examples |
| :--- | :--- | :--- |
| **patch** | Bug fix, nothing changes for callers | Fix a wrong `quick_check` result |
| **minor** | New capability, existing calls keep working | New tool, new optional parameter |
| **major** | An existing setup can break | Removed or renamed tool or parameter, higher minimum Node.js version, license format older versions cannot read |

Notes accumulate under `## Unreleased` in [`CHANGELOG.md`](../../CHANGELOG.md) as pull requests land. A `### Breaking` heading there means the next release is a major.

**Support policy:** only the latest major version is supported, in its newest patch. When a major ships, older majors reach end of life at once and are deprecated on npm, one version at a time, with a [D21 message](#51-normalized-deprecation-specification) (changed with 3.0.1; 3.0.0 had announced six months of security fixes for 2.x).

**Node.js support:** only release lines that receive security fixes (`^22.0.0 || ^24.0.0 || >=26.0.0`), because the server reads whole codebases. `engines` declares it, and `src/security/runtime-guard.ts` enforces it at startup (npm only warns); a test keeps the two identical. CI installs the packed tarball and runs it on the first and the latest release of each line, and checks that Node 18 and 20 are refused. When a line reaches end of life, drop it in the next major release.

---

## 3. One-Time Setup

1. **npm Trusted Publisher.** On npmjs.com, package settings > Trusted Publisher > GitHub Actions: organization `illicomedia`, repository `skills-mcp-server`, workflow `release.yml`, environment `npm-publish`. Under **Allowed actions**, leave **Publish directly** and **Manage dist-tags** unchecked: CI may only stage versions, and only a maintainer with 2FA makes them public or moves a dist-tag. Then set "Publishing access" to require 2FA and disallow tokens, and delete the `NPM_TOKEN` repository secret.
2. **GitHub environment.** Repository settings > Environments > `npm-publish` > Deployment branches and tags: add a rule of **Ref type: Tag**, pattern `v*` (a *branch* rule named `v*` does not match tags, and blocks publishing). Re-publish a failed tag with "Re-run jobs" on its run. Optionally add yourself as a required reviewer, so every publish waits for a click.
3. **Branch protection on `main`:** require pull requests and the CI checks.
4. **Local npm login** (for promote and deprecate only): `npm login`. The account enforces 2FA for writes; each registry change opens a browser confirmation.

---

## 4. Releasing

### One command

```bash
git switch main && git pull
pnpm release --ship --bump minor          # add --dry-run to preview
```

`--ship` runs the steps below in order and stops at the first failure. While it waits, it prints the `npm stage approve` commands to run in another terminal.

### Step by step

**1. Prepare** (laptop):

```bash
pnpm release --bump minor
```

The script refuses to continue unless:
- the current branch is `main`, the tree is clean, and `HEAD` equals `origin/main`;
- the tag and the npm version do not exist yet;
- every GitHub check on that commit has finished green (read from the GitHub API; a `GITHUB_TOKEN` in the environment raises the API rate limit);
- `CHANGELOG.md` has notes under `## Unreleased` (or a section for the version).

It then bumps `package.json`, stamps `## Unreleased` as `## <version> - <today>`, runs lint, build, the coverage gate and the packed-tarball smoke test, commits `chore(release): <version>`, creates the annotated tag, asks, and pushes branch and tag atomically. If a gate fails, `package.json` and `CHANGELOG.md` are restored. Without a terminal, the push needs `--yes`.

**2. Stage** (GitHub Actions, automatic on the tag): checks the tag against `package.json`, then runs the **entire CI workflow** (`ci.yml`) on the tagged commit. Only when every CI job is green does it pack once, smoke-test that tarball, stage it on npm under `next` with provenance (`npm stage publish`), and create the GitHub Release with the changelog section and the tarball attached.

**3. Approve** (laptop, 2FA): the staged version is not public until you approve it:

```bash
npm stage list @illicomedia/skills-mcp-server
npm stage download <stage-id>   # optional: inspect the exact tarball
npm stage approve <stage-id>    # 2FA; the version becomes public under `next`
```

A staged version that should not ship is removed with `npm stage reject <stage-id>`; the version number is then free again. Re-running the workflow is safe: a version already on npm, or a release that already exists, is skipped.

**4. Promote** (laptop, after trying `npx -y @illicomedia/skills-mcp-server@next` in a real agent if you wish):

```bash
pnpm release --promote 1.5.0
```

It installs the version from the registry into an empty folder, runs an MCP session against it, asks, then points `latest` at it and clears `next`.

### Resuming

Each step can be run on its own. If CI failed, fix forward: a new commit and a new patch version; the tag of a version that never reached npm can be re-pushed after `git push --delete origin v<version>`, or the workflow re-run from the Actions tab (manual run, `tag` input). If promotion was interrupted, run `--promote <version>` again.

---

## 5. When a Release Goes Wrong

1. **Roll back `latest`** to the last good supported version (e.g. `2.0.2`):
   ```bash
   pnpm release --promote 2.0.2
   ```
2. **Warn users of the faulty or unsupported version only** using a normalized deprecation message:
   ```bash
   pnpm release --deprecate <version> --message "<NormalizedMessage>"
   ```
3. **Fix forward** with a new patch version.

---

## 5.1 Normalized Deprecation Specification

Every deprecation applied to npm via `npm deprecate` or `pnpm release --deprecate` MUST adhere to this specification (decision D21).

### Specification Syntax
```
<Cause/Reason>. Upgrade to <Package>@<TargetRange> (<Prerequisites>).
```

### Normative Rules
1. **Cause First:** Explicitly state the technical or lifecycle cause (e.g., End-of-Life, Security Advisory, Broken Runtime). Never use vague wording like `"deprecated"` or `"use latest"`.
2. **Actionable Target:** State the explicit package name and target semver range (e.g., `@illicomedia/skills-mcp-server@^3.0.0`).
3. **Explicit Prerequisites:** Clearly note breaking prerequisites or environment changes (e.g., `requires Node 22+`).
4. **Length Constraint:** Keep the string under 256 characters (npm accepts up to 512).
5. **No Shell Commands:** Never prescribe executable terminal commands (`npm i -g ...`, `curl | bash`).
6. **Immutable Registry:** Record every deprecation in the table below.
7. **Enforced:** `pnpm release --deprecate` refuses a message that does not follow this syntax, is longer than 256 characters or prescribes a command, before any registry call.

### Deprecation Registry

Applied by the npm account owner (2FA). The registry shows the state: `npm view @illicomedia/skills-mcp-server@<version> deprecated`.

| Versions | Message | Applied |
| :--- | :--- | :--- |
| `1.4.0`, `1.4.1`, `1.4.3`, `1.4.4`, `1.4.5`, `1.4.6`, `1.4.7` | `End of life: 1.x no longer receives fixes, security fixes included. Upgrade to @illicomedia/skills-mcp-server@^3.0.0 (requires Node.js 22+).` | pending |
| `1.4.2` | `Fails to start with npm or npx (EBADDEVENGINES), and 1.x is end of life. Upgrade to @illicomedia/skills-mcp-server@^3.0.0 (requires Node.js 22+).` | pending |
| `2.0.1`, `2.0.2` | `End of life: 2.x no longer receives fixes, security fixes included. Upgrade to @illicomedia/skills-mcp-server@^3.0.0 (put the license in ~/.config/fredo-qa/license.json or .qa-license.json: FREDO_QA_LICENSE_FILE is no longer read).` | pending |

These replace earlier messages that sent 1.4.x users to 1.4.7 (or 2.0.2) and 2.0.1 users to 2.0.2,
both now end of life. Each command asks for confirmation; with npm's web login, the 2FA page's
"skip for 5 minutes" option covers the whole run.

```bash
for v in 1.4.0 1.4.1 1.4.3 1.4.4 1.4.5 1.4.6 1.4.7; do
  pnpm release --deprecate "$v" --message "End of life: 1.x no longer receives fixes, security fixes included. Upgrade to @illicomedia/skills-mcp-server@^3.0.0 (requires Node.js 22+)."
done
pnpm release --deprecate 1.4.2 --message "Fails to start with npm or npx (EBADDEVENGINES), and 1.x is end of life. Upgrade to @illicomedia/skills-mcp-server@^3.0.0 (requires Node.js 22+)."
for v in 2.0.1 2.0.2; do
  pnpm release --deprecate "$v" --message "End of life: 2.x no longer receives fixes, security fixes included. Upgrade to @illicomedia/skills-mcp-server@^3.0.0 (put the license in ~/.config/fredo-qa/license.json or .qa-license.json: FREDO_QA_LICENSE_FILE is no longer read)."
done
```

---

## 6. Commands

| Command | Where | What it does |
| :--- | :--- | :--- |
| `pnpm run check` | laptop | Lint, build, coverage gate, packed-tarball smoke test |
| `pnpm release [--bump X]` | laptop | Prepare: preflight, version, changelog, gates, commit, tag, push |
| `pnpm release --ship [--bump X]` | laptop | Prepare, wait for CI to stage and you to approve, promote |
| `pnpm release --promote <v>` | laptop | Verify from npm, move `latest` (or roll back) |
| `pnpm release --deprecate <v> --message "<reason>. Use <v>."` | laptop | Deprecate one version |
| `pnpm release --smoke-only [--tarball <file>]` | laptop, CI | Install a tarball into an empty project and run an MCP session |
| `pnpm release --check-tag <tag>` | CI | Fail unless the tag is `v` + the `package.json` version |
| `pnpm release --release-notes <v>` | CI | Print the changelog section of a version |

Every command takes `--dry-run`. Steps that change git or npm ask first and refuse without a terminal unless `--yes` is given.

---

## 7. Emergency Unpublishing Only

Under the [npm unpublish policy](https://docs.npmjs.com/policies/unpublish):
- Allowed within 72 hours if no other public package depends on it.
- After 72 hours, requires contacting [npm support](https://www.npmjs.com/support).

For a leaked secret, rotate the secret immediately, then:
```bash
npm unpublish @illicomedia/skills-mcp-server@<VERSION>
```

---

## 8. Inspecting Registry Status

```bash
npm view @illicomedia/skills-mcp-server dist-tags
npm view @illicomedia/skills-mcp-server versions --json
npm view @illicomedia/skills-mcp-server@<VERSION> deprecated
npm audit signatures   # in a project that installs it: verifies provenance
```

---

## 9. Supply Chain Posture

What is in place, and what is not yet:

| Area | Status |
| :--- | :--- |
| Runtime dependencies | None (`dependencies: {}`), checked by the package e2e test |
| Provenance | npm provenance attestation on every CI publish (Sigstore, GitHub OIDC); versions up to 1.4.7 were published locally and have none |
| Publishing credentials | npm Trusted Publishing: short-lived OIDC credentials, no stored npm token; staged publishing only, so a version goes public only after a maintainer's 2FA approval |
| Workflow hardening | Actions pinned to commit SHAs and the actionlint image pinned by digest (`.github/actionlint/Dockerfile`), all updated through Dependabot pull requests; actionlint runs sealed (no network, read-only, no capabilities, not root); least-privilege `permissions` per job; protected `npm-publish` environment |
| Dependency updates | Dependabot, weekly, for GitHub Actions, the actionlint image and dev dependencies |
| Package metadata | publint in CI; `engines`, `bin`, `types`, `repository`, `bugs`, `homepage`, SPDX `license` |
| Tests | 100% line, branch and function coverage; release flow tested with a fake git/npm runner; packed tarball installed and run on every supported Node.js line |
| Maintainers | One npm maintainer (`illicomedia`). Adding a second maintainer to the npm organization would reduce bus-factor risk |
| OpenSSF Scorecard | Weekly, after each push to `main` and each branch-protection change (`scorecard.yml`); results in code scanning and on the README badge |
| Not yet | CodeQL, Windows and macOS in the full test suite, end-to-end release against a local registry (Verdaccio) |
