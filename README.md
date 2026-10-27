# Fredo QA Skills — Model Context Protocol (MCP) Server

Official **Model Context Protocol (MCP)** server for **Fredo QA Skills**.  
Connects AI coding assistants (**Claude Desktop, Cursor, Google Antigravity, Windsurf, Copilot, VS Code**) to the Fredo QA engineering standards, compliance framework, and real-time preflight audit engine.

---

## Key Highlights

- **Standard MCP Protocol**: 100% compliant with the MCP JSON-RPC 2.0 specification over standard I/O (`stdio`).
- **No Runtime Dependencies**: `package.json` declares no `dependencies`; the server only imports Node.js built-in modules (`node:crypto`, `node:fs`, `node:os`, `node:path`, `node:readline`, `node:url`). It works without a network connection. The remaining supply-chain surface is this package itself and Node.js.
- **Three-Tier Safety & Human-in-the-Loop Approval**:
  - Directory traversal inspection (`quick_check`) and mutating tools (`install_skill`, `sync_workspace_skills`) require explicit user confirmation (`confirm: true`), defaulting to non-destructive previews.
  - Native MCP client authorization dialogs protect against unintended workspace access or modifications.
  - Strict path traversal (`..`), system root (`/etc`, `/`), and credential vault (`~/.ssh`, `~/.aws`) write containment guards.
- **Modular Static Preflight Sensor (`quick_check`)**: Sub-second intake inspection assessing repository governance, security, quality gates, supply chain, and DevOps across 9 language stacks—with user-confirmed directory traversal and zero arbitrary code execution.
- **Cryptographic Ed25519 License Verification**: Offline signature checks unlock Pro and Enterprise skills with lifetime version retention. Open-source MIT skills remain free and unlocked forever.
- **Provenance & Canary Watermarking**: Embeds cryptographic watermark headers into skill rules for licensing integrity and leak tracing.

---

## Tool Safety Model: Read-Only Queries, Directory Traversal, and Write Actions

MCP tools in this server are divided into three distinct security tiers:

> **Skill files are not bundled.** This package contains the catalog metadata, the license checks and the audit engine, but no `SKILL.md`. Skills are read from the project: `skills/<id>/SKILL.md`, `skills/{free,pro,enterprise}/<id>/SKILL.md` or `.agents/skills/<id>/SKILL.md`. Download a skill from `https://www.illicomedia.com/qa-skills/skills/<id>` and extract it there. When a skill is missing, `get_skill_rules` and `install_skill` fail with these instructions instead of generating content.

### 1. Read-Only Queries (No Writes)
These tools never modify state. `get_skill_rules` reads the installed `SKILL.md` from the working directory; the others are in-memory lookups:
- `list_skills`: Browse available skills, policy tiers, and descriptions.
- `get_skill_rules`: Return the `SKILL.md` of an installed skill (fails explicitly if the skill is not installed).
- `verify_license`: Inspect active license signature, licensee, tier, and validity.
- `get_version`: Read runtime server version, protocol metadata, and engine capabilities.
- `set_license_key`: In-memory configuration of signed license for the active session.

### 2. Directory Traversal & Inspection (Filesystem Read — Requires User Confirmation)
Because this tool accesses the filesystem and traverses project directory trees up to 2 subfolder levels (scanning configs, `.env`, `.gitignore`, and certificates):
- `quick_check`: **Requires `confirm: true`** to traverse and inspect project files. When `confirm: false` (default), returns a safe preview describing the audit scope and target path without scanning the filesystem.

### 3. Mutating & Write Tools (Filesystem Modifications & Archiving — Requires User Confirmation)
These tools modify files or directory structures in the target project's `.agents/` directory:
- `install_skill`: Installs a specific skill's `SKILL.md` and `LICENSE`. **Requires `confirm: true`**.
- `sync_workspace_skills`: Scans project tech stacks and installs all matching skills. **Requires `confirm: true`**.
- `prune_skills`: Safely prunes unneeded skills by moving them to `.agents/.archive/`. **Non-destructive**: files are archived, not deleted, keeping them fully recoverable while removing noise from the AI agent context. **Requires `confirm: true`**.

### How the Human-in-the-Loop Guard Works:

```
[AI Assistant] ──> Calls quick_check / install_skill / sync_workspace_skills (confirm: false)
                                         │
                                         ▼
                             [MCP Server returns PREVIEW]
           (Lists proposed action, target folder, audit scope, or files to create)
                                         │
                                         ▼
[AI Assistant] ──> "I propose to inspect/modify your project. Proceed? [Y/n]"
                                         │
                                    User Approves
                                         │
                                         ▼
[AI Assistant] ──> Calls tool with (confirm: true)
                                         │
                                         ▼
                           [MCP Client Authorization Prompt]
                   ("Allow fredo-qa to access/write in /path/to/project?")
                                         │
                                    User Confirms
                                         │
                                         ▼
                      [Operation executed safely within boundaries]
```

1. **Default Safe Preview (`confirm: false`)**:  
   If an assistant invokes `quick_check`, `install_skill`, or `sync_workspace_skills` without `confirm: true`, **no filesystem traversal or file writing occurs**. The server returns a structured dry-run response outlining the target directory and scope, prompting the agent to ask the human developer for approval.
2. **Explicit Confirmation (`confirm: true`)**:  
   Directory traversal or file modifications only execute when `confirm: true` is explicitly provided after user agreement.
3. **Host Client Confirmation Prompts**:  
   Most MCP clients (Claude Desktop, Cursor, Antigravity) will also display a visual confirmation prompt in the chat UI before allowing tool execution.
4. **Security Containment Boundaries**:  
   Even with `confirm: true`, the server's security guard strictly rejects:
   - Accessing or writing outside the workspace boundary (prevents directory traversal `../`).
   - Operating on system roots (`/`, `/etc`, `/usr`, `/bin`, `C:\Windows`).
   - Operating on sensitive credential stores (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`).
   - Following symlinks that escape the project directory.

---

## Available MCP Tools Reference

| Tool Name | Type | Parameters | Description |
|---|---|---|---|
| `list_skills` | 🔍 Read-Only | `{ category?: string }` | Lists all skills accessible under your current plan with tiers, tags, and summary gates. |
| `get_skill_rules` | 🔍 Read-Only | `{ skill_id: string }` | Returns complete prompt instructions and QA directives for a skill (e.g. `qa-security`, `qa-accessibility`). |
| `quick_check` | 🔍 Traversal | `{ project_path: string, confirm?: boolean }` | Preflight audit for AI agents. Evaluates 5 domains across 9 languages. **Requires `confirm: true`** to scan directory files; otherwise returns scope preview. |
| `install_skill` | ✏️ Mutating | `{ skill_id: string, project_path?: string, license_key?: string, confirm?: boolean }` | Installs a skill into `.agents/skills/<skill_id>/`. **Requires `confirm: true`** to write files; otherwise returns a safe preview. |
| `sync_workspace_skills` | ✏️ Mutating | `{ project_path?: string, skills?: string[], license_key?: string, confirm?: boolean }` | Auto-detects project stack and installs matching skills. **Requires `confirm: true`** to write files; otherwise returns a dry-run preview. |
| `prune_skills` | 📦 Archiving | `{ project_path?: string, keep_skills?: string[], confirm?: boolean }` | Safely archives unneeded skills from `.agents/skills/` to `.agents/.archive/` based on project stacks. **Non-destructive** (moves files). **Requires `confirm: true`**; otherwise returns safe preview. |
| `verify_license` | 🔍 In-Memory | `{ license_key?: string }` | Validates Ed25519 signature, tier (Free, Pro, Enterprise), licensee, expiration, and version retention status. |
| `set_license_key` | ⚙️ In-Memory | `{ license_key: string }` | Sets the signed license file (path or JSON content) in memory for the active session without restarting. |
| `get_version` | 🔍 In-Memory | `{}` | Returns the active package version (`1.4.0`), protocol specification (`2024-11-05`), Node runtime, and skills catalog count. |

---

## Deep Dive: Modular Preflight Sensor (`quick_check`)

The `quick_check` tool provides a sub-second, non-destructive audit engine for AI coding assistants. It assesses codebases before executing tasks or quality gates.

### Audit Domains Evaluated:
1. **Governance & Guidelines**: Detects `AGENTS.md`, `.github/copilot-instructions.md`, `.cursorrules`, and agent policy definitions.
2. **Security & Secrets Hygiene**: Verifies `.gitignore` ignores `.env` files, detects exposed private keys (`id_rsa`, `*.pem`, `*.key`), and checks for RFC 9116 `.well-known/security.txt`.
3. **Quality Gates & Exceptions**: Verifies quality gate scripts (`qa:starter`, `qa:standard`, `qa:strict`), test runners, and `.qa-exceptions.yaml` governance.
4. **Supply Chain Integrity**: Validates lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`, `go.sum`, `poetry.lock`), SBOM configurations, and dependency verification.
5. **DevOps & Continuous Integration**: Scans `.github/workflows/`, GitLab CI, and Docker security configurations.

### Supported Language Analyzers:
- **Node.js / TypeScript**: `package.json`, TypeScript configs, ESLint/Biome, Vitest/Jest, Knip, lockfiles.
- **Rust**: `Cargo.toml`, `Cargo.lock`, Clippy, cargo-audit, rustfmt.
- **Go**: `go.mod`, `go.sum`, golangci-lint, govulncheck.
- **Python**: `pyproject.toml`, Ruff, Mypy, Poetry/uv/Pipenv lockfiles, pytest.
- **Java**: `pom.xml`, `build.gradle`, Spotless, Checkstyle, JaCoCo.
- **C / C++**: `CMakeLists.txt`, `Makefile`, clang-format, clang-tidy.
- **PHP**: `composer.json`, `composer.lock`, PHPStan, PHPUnit.
- **Shell / Bash**: `*.sh` scripts, ShellCheck, Bats, shfmt.
- **Polyglot & Fallback**: Intelligent credit allocation for mixed and multi-language repositories.

### Traversal & Confirmation Protocol:
Because `quick_check` traverses repository directories and inspects configuration files, secret patterns, and certificate folders up to 2 levels deep, it implements the same strict Human-in-the-Loop agreement as mutating tools:

1. **Step 1: Scope Preview (`confirm: false` or omitted)**:
   ```json
   {
     "previewOnly": true,
     "requiresConfirmation": true,
     "projectPath": "/path/to/project",
     "message": "Preview: preflight audit is ready to inspect \"/path/to/project\". Directory traversal requires explicit user confirmation. Set confirm: true to proceed.",
     "scope": "Fast preflight sanity check: verifies presence of scaffolding, agent directives...",
     "status": "needs_attention",
     "score": 0,
     "prerequisites": "Confirmation required"
   }
   ```
2. **Step 2: Traversal Execution (`confirm: true`)**:
   Once user agreement is confirmed, the assistant passes `confirm: true` to perform the multi-domain static audit and return the complete score and findings.

### Safety Guarantee:
`quick_check` performs **pure static inspection** of file paths, headers, and directory structures. It never spawns subprocesses, never compiles code, and never accesses the network. It is 100% safe to run on untrusted repositories.

---

## Installation & Setup

### Option 1: Local / Offline Global Installation (for machines without network access)

`@illicomedia/skills-mcp-server` has **0 runtime dependencies**, allowing completely offline operation:

```bash
# 1. Build the package
cd packages/mcp-server
npm run build

# 2. Install globally offline
npm install -g ./packages/mcp-server/ --offline

# Or link for active development:
cd packages/mcp-server && npm link
```

### Option 2: Remote / NPX (Zero-install)

Use `npx -y @illicomedia/skills-mcp-server` directly in your client configuration.

---

## Client Configuration

### 1. Claude Desktop (`claude_desktop_config.json`)

**MacOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "fredo-qa-mcp-server",
      "args": [],
      "env": {
        "FREDO_QA_LICENSE_FILE": "/absolute/path/to/license.json"
      }
    }
  }
}
```

*(Or replace `command` with `"npx"` and `args` with `["-y", "@illicomedia/skills-mcp-server"]`)*

### 2. Cursor IDE (`.cursor/mcp.json`)

Add to your project's `.cursor/mcp.json` or global Cursor settings:

```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "fredo-qa-mcp-server",
      "args": [],
      "env": {
        "FREDO_QA_LICENSE_FILE": "/absolute/path/to/license.json"
      }
    }
  }
}
```

### 3. Google Antigravity (`~/.gemini/config/mcp_config.json`)

Add to `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "fredo-qa-mcp-server",
      "args": []
    }
  }
}
```

Or run directly from the compiled JavaScript bundle without global binaries:

```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "node",
      "args": ["/absolute/path/to/skills/packages/mcp-server/dist/index.js"]
    }
  }
}
```

---

## License Verification & Tiered Access

Pro and Enterprise skills require an Ed25519-signed license file (`license.json`).

### License Resolution Order:
1. Environment variable: `FREDO_QA_LICENSE_FILE=/path/to/license.json`
2. User config path: `~/.config/fredo-qa/license.json`
3. Project root: `.qa-license.json` (ensure this is added to `.gitignore`)
4. Dynamic session key: Set dynamically via the `set_license_key` tool.

### Lifetime Version Retention:
A license unlocks all releases published on or before its `updates_until` date **permanently**. Later server releases gracefully run in free community mode (all MIT skills accessible) without breaking, and without any remote clock or telemetry checks.

---

## Security & Sandboxing Architecture

- **Buffer Overflow & DoS Protection**: Incoming `stdio` stream enforces a strict `1 MB` maximum JSON-RPC frame limit to prevent memory exhaustion attacks.
- **Path Escape Prevention**: All project paths are validated against real filesystem paths (`fs.realpathSync`) to block symlink redirections and directory traversal attempts (`../../../`).
- **Forbidden Path Blacklist**: Rejects destructive operations targeting system directories (`/`, `/etc`, `/usr`, `/bin`, `C:\Windows`) or credential vaults (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`).
- **No Remote Telemetry**: Zero background network requests, zero metric phoning home. All audits, verifications, and tool executions occur strictly on your local machine.

---

## Development & Testing

```bash
# Compile TypeScript to dist/
npm run build

# Run full test suite (Node.js native test runner)
npm test

# Run tests with coverage
npm run test:coverage
```

---

## License & Copyright

- **Engine & Free Skills**: Released under the [MIT License](LICENSE).  
- **Pro & Enterprise Skills**: Proprietary, subject to the Fredo QA Commercial License.  
- Copyright (c) 2026 Frédéric Charles Viallet.
