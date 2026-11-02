# Security Policy

## Supported Versions

Only the latest release and active `main` branch receive security patches.

| Version | Supported |
| :--- | :--- |
| `>= 1.4.7` | ✅ Yes |
| `< 1.4.7` | ❌ No (Deprecated on npm registry — upgrade to latest) |

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

## Security Model & Boundary Assurances

1. **Zero Runtime Dependencies:** This package has zero third-party runtime dependencies (`dependencies: {}`). It runs entirely on audited Node.js built-ins (`node:crypto`, `node:fs`, `node:os`, `node:path`).
2. **Offline Architecture:** All cryptographic verification (Ed25519) and static workspace audits run 100% locally. The server executes zero outbound network requests during tool operations.
3. **Strict Path Containment:** The internal `path-guard` engine prevents path traversal (`../`), blocks operations on root directories (`/`, `/etc`, `C:\Windows`), and strictly prohibits reading or writing to sensitive credential directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`).
4. **Human-in-the-Loop Confirmation:** Mutating tools (`install_skill`, `sync_workspace_skills`, `prune_skills`) and recursive directory traversal (`quick_check`) require explicit user confirmation (`confirm: true`), defaulting to non-destructive safe previews.
