# MCP Server Publish & Release Process

**Status:** Active  
**Target Package:** `@illicomedia/skills-mcp-server`  
**Registry:** [npmjs.com/package/@illicomedia/skills-mcp-server](https://www.npmjs.com/package/@illicomedia/skills-mcp-server)  
**Publisher:** `illicomedia`  
**Repository:** [github.com/illicomedia/skills-mcp-server](https://github.com/illicomedia/skills-mcp-server)

---

## 1. Principles

1. **A published version is permanent.** Projects, lockfiles, and MCP configs may point at any version. Problems are fixed by publishing a new version, never by removing an old one.
2. **A release reaches users in two steps.** Publishing goes to the `next` tag; only a separate promotion moves `latest`.
3. **Deprecation means "do not use this version".** It is applied to one broken or unsupported version at a time, with the reason and the replacement. A working version is not deprecated just because a newer one exists.
4. **Git tags match npm versions 1:1.** When a version is promoted to `latest`, an annotated git tag `v<version>` is automatically created.
5. **Human-in-the-loop control.** Releases are executed locally via `scripts/release.mjs` with your npm security credentials; GitHub Actions strictly runs CI tests and linting.
6. **Unpublishing is for emergencies only**, such as a leaked secret, and is done by hand (section 6). The release script cannot unpublish.

---

## 2. Choosing the Version Number

| Bump | When | Examples |
| :--- | :--- | :--- |
| **patch** | Bug fix, nothing changes for callers | Fix a wrong `quick_check` result |
| **minor** | New capability, existing calls keep working | New tool, new optional parameter |
| **major** | An existing setup can break | Removed or renamed tool or parameter, higher minimum Node version, license format older versions cannot read |

Record every release in [`CHANGELOG.md`](../../CHANGELOG.md) before publishing.

**Support policy:** the latest major version gets all fixes. The previous major version gets security and critical fixes for 6 months after the next major version ships.

---

## 3. Shipping in One Command

Write the `CHANGELOG.md` section, commit it, then run:

```bash
node scripts/release.mjs --ship --bump patch
```

It:
1. Checks npm login, changelog entry, and clean git working tree;
2. Runs build, tests, and tarball smoke test in an isolated temporary directory;
3. Bumps version and commits `chore(mcp): release <version>`;
4. Publishes under the `next` dist-tag;
5. Installs the new version back from npm registry to verify end-to-end functionality;
6. Promotes `latest` to the new version;
7. Creates annotated git tag `v<version>`;
8. Deprecates the previous version with a clear upgrade message.

npm prompts for browser 2FA at each registry operation.
After completion, push the new commit and tag:

```bash
git push origin main --tags
```

Add `--dry-run` to preview all actions without executing them:

```bash
node scripts/release.mjs --ship --bump patch --dry-run
```

---

## 4. Manual Staged Release (Alternative)

If you prefer verifying on `next` before promoting:

```bash
# 0. Dry-run preview
pnpm run release -- --dry-run --bump minor

# 1. Publish under the `next` tag
pnpm run release -- --bump minor

# 2. Test in a real agent setup
npx -y @illicomedia/skills-mcp-server@next

# 3. Promote to latest (creates git tag automatically)
pnpm run release -- --promote 1.5.0

# 4. Push commit and tag to GitHub
git push origin main --tags
```

The publish step refuses to continue unless all of these pass:
- npm login is verified;
- version does not exist on npm;
- TypeScript build succeeds;
- Full test suite passes with 100% coverage;
- Smoke test passes: package is packed into a `.tgz`, installed in a clean isolated directory, and starts a JSON-RPC session answering `initialize` and `tools/list`.

Run the smoke test alone:

```bash
pnpm run release:smoke
```

---

## 5. When a Release Goes Wrong

1. **Roll back immediately.** Point `latest` back at the last known good version:
   ```bash
   pnpm run release -- --promote 1.4.1
   ```
2. **Warn users of the faulty version only.**
   ```bash
   pnpm run release -- --deprecate 1.5.0 --message "Crashes on start with Node 18. Use 1.5.1."
   ```
3. **Fix forward.** Publish a new patch version (`1.5.1`) and promote it.

---

## 6. Two-Factor Authentication

The `illicomedia` npm account enforces **Two-Factor Authentication for Writes** (`auth-and-writes`). Publishing, promoting, and deprecating each prompt with an authentication URL:

```text
Authenticate your account at:
https://www.npmjs.com/auth/cli/<SESSION-ID>
Press ENTER to open in the browser...
```

To log in before releasing, run:
```bash
npm login
```

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
```

---

## 9. Supply Chain & Quality Audit

Socket.dev scores packages across 5 pillars:
- **Maintenance**: Latest version is never deprecated.
- **Quality**: `engines`, `bugs`, `main`, `types`, `license` declared in `package.json`.
- **Vulnerability**: Zero runtime dependencies, dev dependencies strictly pinned.
- **License**: MIT with full `LICENSE` file included in published tarball.
- **Supply Chain**: Deterministic builds and signed Git tags matching npm releases.
