# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| Latest major version (`latest` on npm), newest patch | ✅ All fixes |
| Older major versions | ❌ End of life as soon as the next major ships, and deprecated on npm with the version to use instead |

Since 3.0.1, only the latest major is supported: 1.x and 2.x are end of life. (3.0.0 had announced
six months of security fixes for 2.x; that window is withdrawn so that every user runs the
hardened code.)

A version found to be vulnerable is deprecated on npm with the reason and the version to use instead.

---

## Reporting a Vulnerability

We take the security of `@illicomedia/skills-mcp-server` seriously. If you discover a security vulnerability, we appreciate your responsible disclosure.

### Reporting Channels:
1. **GitHub Security Advisory (Recommended):** Open a private security advisory under the [Security tab](https://github.com/illicomedia/skills-mcp-server/security/advisories/new) on GitHub.
2. **Direct Email:** Email `security@illicomedia.com` with the subject line `[SECURITY] skills-mcp-server: <summary>`.

### Please Provide:
- Detailed description of the potential vulnerability and threat vector.
- Reproduction steps or minimal Proof of Concept (PoC).
- Potential impact on host filesystem, environment variables, or AI agent context.
- Suggested remediations if available.

### Response SLA:
- **Acknowledgment:** Within 24–48 hours.
- **Triage & Assessment:** Within 3 business days.
- **Fix & Disclosure:** Patch released via npm and GitHub release, coordinated with the reporter.

---

## Verifying a Release

Every version from the release workflow onwards is published by GitHub Actions with an npm provenance attestation linking the tarball to its source commit and workflow run:

```bash
npm audit signatures
```

---

## Security Model & Boundary Assurances

1. **Maintained Runtime Only:** The server refuses to start on a Node.js line that no longer receives security fixes (it enforces `^22.0.0 || ^24.0.0 || >=26.0.0` itself; npm only warns about `engines`). Keep Node.js patched within its line.
2. **Zero Runtime Dependencies:** This package has zero third-party runtime dependencies (`dependencies: {}`). It runs entirely on Node.js built-ins (`node:crypto`, `node:fs`, `node:os`, `node:path`).
3. **Offline Architecture:** All cryptographic verification (Ed25519) and static workspace audits run 100% locally. The server executes zero outbound network requests during tool operations.
4. **Strict Path Containment:** The internal `path-guard` engine prevents path traversal (`../`), blocks operations on root directories (`/`, `/etc`, `C:\Windows`), and strictly prohibits reading or writing to sensitive credential directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`).
5. **Human-in-the-Loop Confirmation:** Mutating tools (`install_skill`, `sync_workspace_skills`, `prune_skills`) and recursive directory traversal (`quick_check`) require explicit user confirmation (`confirm: true`), defaulting to non-destructive safe previews.
