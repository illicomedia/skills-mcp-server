# Release Runbook

Step by step for the maintainer releasing `@illicomedia/skills-mcp-server`. Why it works this way:
[publish process](mcp-publish-process.md) and [engineering decisions](../engineering/decisions.md).

Each step is marked:
- **YOU**: you run it.
- **YOU + 2FA**: you run it, and npm asks for your second factor (browser or code).
- **AUTOMATIC**: GitHub Actions does it; you only watch.

Nothing reaches users without two 2FA approvals from you: one makes the version public under
`next`, the other moves `latest`.

| # | Who | What | Time |
| :--- | :--- | :--- | :--- |
| 1 | YOU | Get ready | 2 min |
| 2 | YOU | Preview the release (dry run) | 1 min |
| 3 | YOU | Cut the release: version, changelog, gates, tag, push | 2 to 3 min |
| 4 | AUTOMATIC | Full CI on the tag, then stage on npm | 8 to 20 min |
| 5 | YOU + 2FA | Approve the staged version: public under `next` | 2 min |
| 6 | YOU | Try the `next` version | as needed |
| 7 | YOU + 2FA | Promote to `latest` | 2 min |
| 8 | YOU | Check the result | 2 min |

---

## 1. Get ready (YOU)

```bash
cd skills-mcp-server
git switch main && git pull
nvm use                          # Node.js from .nvmrc (24)
pnpm install --frozen-lockfile
npm whoami                       # must print your npm user; otherwise: npm login
```

Check, before going on:
- **CI is green on `main`**: every check passed on the latest commit at
  <https://github.com/illicomedia/skills-mcp-server/actions>. The release refuses otherwise.
- **`CHANGELOG.md` has notes under `## Unreleased`.** A `### Breaking` heading there means a
  `major` bump; new features `minor`; fixes only `patch`.

## 2. Preview the release (YOU)

```bash
pnpm release --bump major --dry-run      # or minor / patch
```

You should see:

```text
[release] i Release plan: @illicomedia/skills-mcp-server 1.4.7 -> 2.0.0 (tag v2.0.0)
[release] i [dry-run] Would stamp CHANGELOG.md, run lint, build, test:coverage and smoke,
[release] i [dry-run] commit "chore(release): 2.0.0", tag v2.0.0, push both.
```

If it prints `Preflight would fail`, fix each listed reason first (wrong branch, uncommitted
changes, not in sync with `origin/main`, CI not green, tag or version already used).

## 3. Cut the release (YOU)

```bash
pnpm release --bump major
```

It stamps `## Unreleased` as `## 2.0.0 - <today>`, runs lint, build, the coverage gate and the
packed-tarball smoke test, commits `chore(release): 2.0.0` and creates the tag `v2.0.0`. Then it
asks:

```text
[release] ? Push main and v2.0.0 to origin? [y/N]
```

Answer `y`. If a gate fails, `package.json` and `CHANGELOG.md` are restored and nothing is
committed: fix the problem through a normal commit, wait for green CI, run step 3 again.

## 4. CI on the tag, then staging (AUTOMATIC)

Watch the **Release** workflow:
<https://github.com/illicomedia/skills-mcp-server/actions/workflows/release.yml>

It runs, in order, and stops at the first failure:
1. **Tag matches package.json**
2. **CI**: the whole CI workflow on the tagged commit (all Node.js versions, Linux, Windows, macOS).
   macOS runners can queue for several minutes; that is normal.
3. **Pack and smoke-test**: packs once, installs that tarball, runs an MCP session.
4. **Stage on npm under next**: uploads that exact tarball, with provenance. **Not public yet.**
5. **GitHub Release**: notes from the changelog, tarball attached.

When it is green, the run's summary page shows the approval commands of step 5.

## 5. Approve the staged version (YOU + 2FA)

```bash
pnpm release --approve <version>
```

It waits until CI has staged the version (showing the release workflow link, where you approve the
`npm-publish` deployment in your browser), checks that the staged tarball's SHA-1 equals the
tarball attached to the GitHub Release, asks, runs `npm stage approve` (2FA), and waits until the
version is public under `next`. A mismatch is refused, with the `npm stage reject` command to run.
`pnpm release --ship` runs this step itself. The manual equivalent:

```bash
npm stage list @illicomedia/skills-mcp-server
```

Copy the stage id of the new version. Follow its status with `npm stage view <stage-id>`
(reading needs no 2FA):
- `validating`: npm is still checking the upload, usually a few minutes after staging;
- `staged`: ready to approve or reject.

Optionally confirm it is the tarball CI tested: its `shasum` equals the SHA-1 of the `.tgz`
attached to the GitHub Release (`sha1sum <file>.tgz`). Optionally inspect the exact tarball:

```bash
npm stage download <stage-id>
```

Then approve:

```bash
npm stage approve <stage-id>     # 2FA: the version becomes public under `next`
```

Check:

```bash
npm view @illicomedia/skills-mcp-server dist-tags     # next: '2.0.0', latest unchanged
```

Not satisfied with the staged version? `npm stage reject <stage-id>` (2FA) removes it; nothing was
public.

## 6. Try the `next` version (YOU)

In a real agent setup, point the MCP configuration at the exact version:

```json
{ "command": "npx", "args": ["-y", "@illicomedia/skills-mcp-server@2.0.0"] }
```

Or a quick check from a terminal (prints one JSON answer containing `"version":"2.0.0"`):

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | npx -y @illicomedia/skills-mcp-server@2.0.0
```

## 7. Promote to `latest` (YOU + 2FA)

```bash
pnpm release --promote 2.0.0
```

It installs 2.0.0 from npm into an empty folder, runs an MCP session against it, then asks:

```text
[release] ? Move `latest` from v1.4.7 to v2.0.0? [y/N]
```

Answer `y`. It then runs two npm commands, `dist-tag add … latest` and `dist-tag rm … next`;
npm asks for 2FA for them (once each, unless npm reuses your recent confirmation).

With `--with-listing` (opt-in; the listing is postponed for now, D19), it then lists the version in
the **official MCP Registry** (a listing that points at the npm package): it checks `server.json`, that the version is public on npm with the right `mcpName`, and
the pinned `mcp-publisher`, runs `mcp-publisher validate`, then asks
`Publish io.github.illicomedia/skills-mcp-server <version> to the MCP Registry? [y/N]`. A rollback
(promoting an older version) leaves the listing alone. If this step fails, `latest` has still
moved; fix the cause and run `pnpm release --publish-listing`.

## 8. Check the result (YOU)

```bash
npm view @illicomedia/skills-mcp-server dist-tags              # latest: '2.0.0'
npm view @illicomedia/skills-mcp-server@2.0.0 dist.attestations   # provenance present
```

- The npm package page shows the provenance badge for 2.0.0.
- The GitHub release `v2.0.0` exists with its notes and tarball.

---

## Release candidates (before a major version)

A major version is first released as candidates under `next`, tried, then finalized:

```bash
pnpm release --bump major --preid rc      # 3.0.0-rc.0: steps 3 to 6 as usual, never `latest`
pnpm release --bump prerelease            # 3.0.0-rc.1, if a fix is needed
pnpm release --bump release               # 3.0.0, after a calm period; then steps 4 to 8
```

A candidate gets its own changelog section copied from `## Unreleased`, which keeps the notes for
the final version. `--promote` refuses a candidate: only the final version can become `latest`.

## One command instead of steps 2 to 7

```bash
pnpm release --ship --bump major
```

It runs steps 3, 4 (waiting), 7, and prints the step 5 commands while it waits: run those in a
second terminal. It waits up to 30 minutes for the approval, then promotes after your `y`.

---

## Repository settings (as code)

The GitHub settings this process relies on (rulesets protecting `main` and the `v*` tags, the
`npm-publish` reviewer, Actions permissions, security features) are declared in
`.github/settings.json` and checked or applied with a short-lived token (decision D20).

1. On github.com, signed in as `illicomedia`: Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token. Expiration **1 day**; resource owner
   `illicomedia`; **Only select repositories** → `illicomedia/skills-mcp-server`; repository
   permissions **Administration: Read and write** and **Environments: Read and write**, nothing else.
2. Store it in a file only you can read, never in a chat or a command line:
   ```bash
   (umask 077; mkdir -p ~/.config/gh-setup; read -rsp 'Token: ' T; echo; printf '%s' "$T" > ~/.config/gh-setup/token)
   ```
3. Run:
   ```bash
   pnpm run github:check     # read-only: lists every difference; nothing changes
   pnpm run github:apply     # shows the changes, asks, applies them, reads everything back
   ```
   Undeclared rulesets or deployment policies are reported, never deleted.
4. Delete the token on github.com, then `rm ~/.config/gh-setup/token`.

## MCP Registry publisher (once per machine)

The listing is published with the registry's official tool, `mcp-publisher`, at exactly version
1.8.7 (the release script refuses any other). Install it from its GitHub release and verify its
Sigstore signature before use; do not install it if verification fails:

```bash
V=v1.8.7
F="mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz"
B="https://github.com/modelcontextprotocol/registry/releases/download/$V"
curl -fsSL -o "$F" "$B/$F" && curl -fsSL -o "$F.sigstore.json" "$B/$F.sigstore.json"
cosign verify-blob --bundle "$F.sigstore.json" \
  --certificate-identity "https://github.com/modelcontextprotocol/registry/.github/workflows/release.yml@refs/tags/$V" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com "$F"
tar -xzf "$F" mcp-publisher && sudo install mcp-publisher /usr/local/bin/ && rm -f "$F" "$F.sigstore.json"
mcp-publisher --version                            # mcp-publisher v1.8.7 (...)
mcp-publisher login github                         # once, approved in the browser AS THE illicomedia ACCOUNT
```

The certificate identity is exact: only the registry's own release workflow, at tag v1.8.7, can
have signed the file. This is the check the registry's documentation uses.

The listing's name, `io.github.illicomedia/skills-mcp-server`, is the **personal namespace** of
the GitHub account `illicomedia` (a user account, not an organization). `mcp-publisher login github`
grants exactly the namespace of the account that approves the login in the browser, so approve it
while signed in to GitHub **as `illicomedia`**; another account gets `io.github.<that-account>/`
and the publish is refused. (Organization namespaces would need an organization Owner and a token
or GitHub Actions: the browser login cannot publish for organizations, registry issue #1468.) Versions published to npm without `mcpName` (2.0.2 and older) cannot be
listed; 3.0.0 is the first.

## First release with Trusted Publishing only (once)

After the first release has been staged and approved:

1. npmjs.com → package **Settings** → **Trusted Publisher**: the status is no longer "Pending
   validation". It must be validated before the date npm shows there.
2. **Publishing access**: select **Require two-factor authentication and disallow tokens**.
3. GitHub → **Settings → Secrets and variables → Actions**: remove `NPM_TOKEN`.
4. npmjs.com → your avatar → **Access Tokens**: revoke the token CI used.

---

## When something goes wrong

| Where | What you see | What to do |
| :--- | :--- | :--- |
| Step 2 or 3 | `Release preflight failed` with reasons | Fix each reason; nothing changed yet |
| Step 3 | A gate fails (lint, tests, smoke) | Files are restored; fix in a normal commit, wait for green CI, redo step 3 |
| Step 3 | You answered `n` to the push | The commit and tag are local only: `git push --atomic origin main v2.0.0` when ready, or drop them with `git tag -d v2.0.0 && git reset --hard origin/main` |
| Step 4 | A CI job failed because of the runner (timeout, queue, network), e.g. macOS "not acquired by Runner … after multiple attempts" | Open the run, **Re-run failed jobs** |
| Step 4 | A CI job failed because of the code | Nothing is on npm. Fix in a new commit, then release the next patch version (2.0.1); the changelog keeps 2.0.0 as never published |
| Step 4 | Staging failed with `403`, `404` or "not authorized" | Trusted Publisher fields differ from `illicomedia` / `skills-mcp-server` / `release.yml` / `npm-publish`, or "Publish directly" was expected: fix on npmjs.com, then **Re-run failed jobs** |
| Step 4 | Staging failed with a git error (`ls-remote`, exit code 128) | npm read the tarball path as a GitHub repository; the workflow must pass an absolute path. CI's "Dry-run the npm staging command" catches this on every push |
| Step 4 | "not allowed to deploy to npm-publish" | The environment needs a deployment rule of type **Tag**, pattern `v*` |
| Step 5 | The staged version is wrong | `npm stage reject <stage-id>`; fix forward with the next patch version |
| After 7 | A problem in the released version | Roll back: `pnpm release --promote 2.0.2`. Warn users of that version only using the normalized spec: `pnpm release --deprecate <version> --message "<reason>. Upgrade to <version>."`. Fix forward with next patch version |
