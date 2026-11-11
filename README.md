# Fredo QA Skills — Model Context Protocol (MCP) Server

[![npm version](https://img.shields.io/npm/v/@illicomedia/skills-mcp-server.svg)](https://www.npmjs.com/package/@illicomedia/skills-mcp-server)
[![CI Status](https://github.com/illicomedia/skills-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/illicomedia/skills-mcp-server/actions/workflows/ci.yml)
[![Socket Security](https://socket.dev/api/badge/npm/package/@illicomedia/skills-mcp-server)](https://socket.dev/npm/package/@illicomedia/skills-mcp-server)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/illicomedia/skills-mcp-server/badge)](https://scorecard.dev/viewer/?uri=github.com/illicomedia/skills-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

Official **Model Context Protocol (MCP)** server for **Fredo QA Skills**.  
Connects AI coding assistants (**Claude Desktop, Cursor, Google Antigravity, Windsurf, Copilot, VS Code**) to the Fredo QA engineering standards, regulatory checklists, and preflight audit engine.

---

## Key Highlights

- **Standard MCP Protocol**: speaks JSON-RPC 2.0 over standard I/O (`stdio`). Today it implements MCP revision `2024-11-05`, the legacy revision; the current revision is `2026-07-28` ([specification](https://modelcontextprotocol.info/specification/)). Support for the current revision is planned and will be announced in the [changelog](CHANGELOG.md).
- **No Runtime Dependencies**: `package.json` declares no `dependencies`; the server only imports Node.js built-in modules (`node:crypto`, `node:fs`, `node:os`, `node:path`, `node:url`). The server itself needs no network connection (downloading skill files and installing the package do; see [Sandboxing Controls](#sandboxing-controls)). The remaining supply-chain surface is this package itself and Node.js.
- **Three-Tier Safety & Human-in-the-Loop Approval**:
  - Directory traversal inspection (`quick_check`) and mutating tools (`install_skill`, `sync_workspace_skills`) require explicit user confirmation (`confirm: true`), defaulting to non-destructive previews.
  - Many MCP clients also show their own authorization prompt before a tool runs. That prompt belongs to your client, not to this server, so do not rely on it alone.
  - Strict path traversal (`..`), system root (`/etc`, `/`), and credential vault (`~/.ssh`, `~/.aws`) write containment guards.
- **Modular Static Preflight Sensor (`quick_check`)**: Fast static intake inspection assessing repository governance, security, quality gates, supply chain, and DevOps across 8 language stacks plus a generic fallback, with user-confirmed directory traversal and zero arbitrary code execution.
- **Signed, Offline License Verification**: Pro and Enterprise skills unlock from a digitally signed license file, checked locally with no network. Version retention follows the terms of sale. Open-source MIT skills remain free and unlocked forever.
- **Provenance Watermark**: Skill rules served or installed through this server start with a provenance comment naming the licensee and the skill. It helps trace where a copy came from; it is a deterrent, not a technical protection, because anyone can delete it.

---

## Tool Safety Model: Read-Only Queries, Directory Traversal, and Write Actions

MCP tools in this server are divided into three distinct security tiers:

> **Skill files are not bundled.** This package contains the catalog metadata, the license checks and the audit engine, but no `SKILL.md`. Skills are read from the project: `skills/<id>/SKILL.md`, `skills/{free,pro,enterprise}/<id>/SKILL.md` or `.agents/skills/<id>/SKILL.md`. Download a skill from `https://www.illicomedia.com/qa-skills/skills/<id>` and extract it there. When a skill is missing, `get_skill_rules` and `install_skill` fail with these instructions instead of generating content.

### 1. Read-Only Queries (No Writes)
These tools never write to disk. `get_skill_rules` reads the installed `SKILL.md` from `project_path`, or from the server's working directory (the folder your client starts it in) when `project_path` is omitted; the others are in-memory lookups:
- `list_skills`: Browse available skills, policy tiers, and descriptions.
- `get_skill_rules`: Return the `SKILL.md` of an installed skill (fails explicitly if the skill is not installed).
- `verify_license`: Inspect active license signature, licensee, tier, and validity.
- `get_version`: Read runtime server version, protocol metadata, and engine capabilities.

One more tool changes in-memory session state only, never the disk: `set_license_key` loads a signed license for the running session.

### 2. Directory Traversal & Inspection (Filesystem Read — Requires User Confirmation)
Because this tool accesses the filesystem (it reads the config files it audits and searches up to 2 subfolder levels for private-key files):
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
             (only if your client provides one, e.g. "Allow fredo-qa ...?")
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
   Many MCP clients also display their own confirmation prompt before running a tool. This depends on the client and its settings; the server does not control it.
4. **Security Containment Boundaries**:  
   Even with `confirm: true`, the server's security guard strictly rejects:
   - Writing outside the project root (`../` traversal).
   - Using a system directory as the project: the roots `/`, `/usr`, `/root`, and anything inside `/etc`, `/bin`, `/sbin`, `/boot`, `/dev`, `/proc`, `/sys`, `/lib*`, `/usr/bin`, `/usr/sbin`, `/usr/lib*`, `/var/run`, macOS `/System` and `/Library`, `C:\Windows`, `C:\Program Files*` or `C:\ProgramData` (also through WSL mounts such as `/mnt/c/Windows`). Ordinary locations such as `/usr/local/src/app` or `/root/project` stay usable.
   - Using a sensitive credential store or anything inside it (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.azure`, `~/.config/gcloud`, `~/.config/gh`, `~/.password-store`, `~/.oci`, `~/Library/Keychains`).
   - Writing through symlinks that lead outside the project directory.

   `quick_check` audits the `project_path` it is given, which can be any directory that passes these checks, not only the current workspace.

---

## Available MCP Tools Reference

| Tool Name | Type | Parameters | Description |
|---|---|---|---|
| `list_skills` | 🔍 Read-Only | `{ category?: string }` | Lists the whole built-in catalog with tier and category, and marks which skills your current license unlocks. |
| `get_skill_rules` | 🔍 Read-Only | `{ skill_id: string, project_path?: string }` | Returns the `SKILL.md` of a skill you have already downloaded into the project (e.g. `qa-security`, `qa-accessibility`), if your license covers its tier. Fails with instructions when the file is missing. |
| `quick_check` | 🔍 Traversal | `{ project_path: string, confirm?: boolean }` | Preflight audit for AI agents. Evaluates 5 domains across 8 language stacks plus a generic fallback. **Requires `confirm: true`** to scan directory files; otherwise returns scope preview. |
| `install_skill` | ✏️ Mutating | `{ skill_id: string, project_path?: string, license_key?: string, confirm?: boolean }` | Installs a skill into `.agents/skills/<skill_id>/`. **Requires `confirm: true`** to write files; otherwise returns a safe preview. |
| `sync_workspace_skills` | ✏️ Mutating | `{ project_path?: string, skills?: string[], license_key?: string, confirm?: boolean }` | Auto-detects project stack and installs matching skills. **Requires `confirm: true`** to write files; otherwise returns a dry-run preview. |
| `prune_skills` | 📦 Archiving | `{ project_path?: string, keep_skills?: string[], confirm?: boolean }` | Safely archives unneeded skills from `.agents/skills/` to `.agents/.archive/` based on project stacks. **Non-destructive** (moves files). **Requires `confirm: true`**; otherwise returns safe preview. |
| `verify_license` | 🔍 In-Memory | `{ license_key?: string }` | Validates the license signature, tier (Free, Pro, Enterprise), licensee, expiration, and version retention status. |
| `set_license_key` | ⚙️ In-Memory | `{ license_key: string }` | Sets the signed license file (path or JSON content) in memory for the active session without restarting. A license that does not verify is reported and leaves the session license unchanged (`sessionUpdated: false`). |
| `get_version` | 🔍 In-Memory | `{}` | Returns the active package version (e.g. `3.1.0`), MCP revisions implemented (latest `2024-11-05`, also listed as `supportedProtocolVersions`), Node runtime, and skills catalog count. |

---

## Deep Dive: Modular Preflight Sensor (`quick_check`)

The `quick_check` tool provides a fast, non-destructive, static audit engine for AI coding assistants. It assesses codebases before executing tasks or quality gates.

### Audit Domains Evaluated:
1. **Governance & Guidelines**: Detects `AGENTS.md`, a `LICENSE` file, and `.qa-exceptions.yaml` (with expiry dates).
2. **Security & Secrets Hygiene**: Verifies `.gitignore` ignores `.env` files and private keys, detects private-key files in the project (`id_rsa`, `id_ed25519`, `*.pem`, `*.key`, `*.p12`), checks for `SECURITY.md` and an RFC 9116 `.well-known/security.txt`, and warns when a project-level `.qa-license.json` is not ignored by `.gitignore`.
3. **Quality Gates & Exceptions**: Verifies that a test command or runner is declared for the detected stack (for Node.js also `qa:starter` / `qa:standard` scripts).
4. **Supply Chain Integrity**: Checks that a dependency lockfile is present for the detected stack (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`, `go.sum`, `poetry.lock`, ...). It does not read SBOMs or verify dependencies.
5. **DevOps & Continuous Integration**: Detects CI configuration files (GitHub Actions, GitLab CI, Forgejo/Gitea, Bitbucket, Azure DevOps, CircleCI, Jenkins, Drone, Woodpecker, Cirrus, Travis).

### Supported Language Analyzers:
The analyzers look for **project files**, not for installed tools: they do not run linters or read their reports.
- **Node.js / TypeScript**: `package.json`, `tsconfig.json`, lockfiles (pnpm, npm, yarn, bun), Vitest/Jest/Playwright configs, test scripts.
- **Rust**: `Cargo.toml`, `Cargo.lock`.
- **Go**: `go.mod`, `go.sum`.
- **Python**: `pyproject.toml`, `setup.cfg`, `mypy.ini`, `pytest.ini`, `tox.ini`, lockfiles (poetry, uv, pdm, Pipfile, requirements).
- **Java**: `pom.xml`, `build.gradle`, `gradle.lockfile`, `src/test`.
- **C / C++**: `CMakeLists.txt`, CTest, `vcpkg.json`, `conanfile.txt`, `conan.lock`, `CPM.cmake`.
- **PHP**: `composer.json`, `composer.lock`, PHPUnit/Pest, PHPStan, Psalm configs.
- **Shell / Bash**: `*.sh` scripts, `.shellcheckrc`, `scripts/test.sh`.
- **Generic fallback**: `Makefile` test targets and `scripts/test.sh` for any other or mixed repository.

### Traversal & Confirmation Protocol:
Because `quick_check` reads repository files and searches up to 2 levels deep for private-key files, it implements the same strict Human-in-the-Loop agreement as mutating tools:

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

### Safety design:
`quick_check` performs **static inspection** of file names, the directory structure and a few configuration files. It does not spawn subprocesses, compile code, or access the network. Review its output like any tool result, especially on untrusted repositories.

### Native Toolchain Recognition & Zero Unsolicited Files

Starting with version **1.4.4+**:
- **Native Toolchains Are First-Class**: `quick_check` natively detects and honors standard language commands (`cargo test`, `npm test`, `pytest`, `go test`, `make test`, `mvn test`) without requiring custom wrapper scripts.
- **Local & Multi-Forge CI Support**: If your repository uses a local runner (`scripts/qa.sh`, `Makefile` recipes, git hooks) or diverse CI providers (GitLab CI, Forgejo, Bitbucket Pipelines, Azure DevOps, Woodpecker, Drone, Cirrus, Jenkins), the audit recognizes them automatically.
- **Zero File Pollution**: The MCP server will **never generate unsolicited wrapper scripts** (`scripts/qa.sh` or `scripts/qa`) on your project. If no CI is configured, it reports an informational advisory recommendation tailored to your remote forge without blocking your audit score (`status: ready`).

---

## Vibe Coding with Fredo QA: Natural Language Prompt Examples

When using AI coding assistants (**Cursor Agent / Composer, Claude Code, Google Antigravity, Windsurf Cascade, Cline**), you do not need to call JSON-RPC methods directly or memorize tool names. The AI agent automatically discovers all Fredo QA tools from its environment.

During rapid **vibe coding**, simply prompt the assistant naturally in chat:

### 1. Preflight Codebase Audit
> **Prompt:** *"Audit this repository before I commit my work."*  
> **Prompt:** *"Run a quick preflight sanity check on this codebase."*  
> 🤖 **What happens:** The agent triggers `quick_check`. It inspects repository governance, test suites, secret hygiene, lockfiles, and CI configuration across your tech stack in milliseconds, reporting readiness and any blocker or warning findings.

### 2. Auto-Detecting Stack & Installing Skills
> **Prompt:** *"Detect the tech stack of this project and install the matching QA engineering skills."*  
> **Prompt:** *"Set up standard QA quality gates for this TypeScript and Python repository."*  
> 🤖 **What happens:** The agent asks for your approval (`confirm: true`), runs `sync_workspace_skills`, and copies the matching engineering profiles (e.g., `qa-javascript-typescript`, `qa-python`) into `.agents/skills/`. This works for skills whose files you have already downloaded into the project (see "Skill files are not bundled" above) and, for Pro and Enterprise skills such as `qa-security`, only with a valid license; the others are reported as not installed.

### 3. Enforcing Deterministic Engineering Contracts
> **Prompt (Free):** *"Apply the `qa-rust` (or `qa-javascript-typescript`) `standard` gate to this module—zero suppressions—and output the `qa-core` evidence block."*  
> **Prompt (Pro):** *"Audit this frontend against `qa-accessibility` (WCAG 2.2 AA) and `qa-gdpr-rgpd` (CNIL equal accept/refuse & Art. 13 forms) and fix every blocker."*  
> 🤖 **What happens:** Rather than relying on generic LLM advice or taking shortcuts, the agent calls `get_skill_rules` to load, from the skill files you downloaded, the exact profile thresholds, toolchain flags, exception rules, and mandatory `qa-core` evidence format before writing or validating code.

### 4. Cleaning Up Unused Skills (Archiving)
> **Prompt:** *"Clean up any installed QA skills that don't match our active stack."*  
> **Prompt:** *"Prune unneeded skills from our .agents directory."*  
> 🤖 **What happens:** The agent invokes `prune_skills` with `confirm: true`. Skills not matching the current stack are safely moved to `.agents/.archive/` (non-destructive archiving) to keep the AI context window lean.

### 5. Checking License & Commercial Skills
> **Prompt:** *"Verify our Fredo QA license status and expiration."*  
> **Prompt:** *"Check if our Pro skills are activated."*  
> 🤖 **What happens:** The agent calls `verify_license` to validate the license signature, tier, licensee details, and version retention status.

---

## Installation & Setup

**Requirements:** Node.js 22, 24 or 26+. The server refuses to start on Node.js versions that no longer receive security fixes, since it reads your codebase. If your default `node` is older (common with `nvm` on legacy projects), set the MCP client's `"command"` to the full path of a supported `node` and pass the package's `dist/index.js` as the argument, or switch with `nvm use 24` before starting the client.

### Option 1: Local / Offline Installation (for machines without network access)

`@illicomedia/skills-mcp-server` has **0 runtime dependencies**, so a packed tarball installs without any registry access. Build and pack it once on a machine with network access:

```bash
# 1. On a connected machine, from a clone of this repository
pnpm install
pnpm run build
pnpm pack          # creates illicomedia-skills-mcp-server-<version>.tgz

# 2. Copy the .tgz to the offline machine, then install it globally
npm install -g ./illicomedia-skills-mcp-server-<version>.tgz --offline
```

Skill files are still downloaded separately (see "Skill files are not bundled" above); copy them to the offline machine as well.

### Option 2: `npx` (no install step)

Use `npx -y @illicomedia/skills-mcp-server` directly in your client configuration. This needs the npm registry the first time (or a warm npm cache).

### How MCP `stdio` Transport Works (and why running in a shell pauses)

When you run `npx @illicomedia/skills-mcp-server` directly in an interactive bash or zsh terminal:
```bash
[fredo-qa-mcp-server] Starting Model Context Protocol server on stdio (PID: 12345)...
```
...the process pauses and appears to wait. **This is normal and by design.**

- **MCP is a JSON-RPC 2.0 daemon, not an interactive CLI**: The server communicates with your AI editor by reading JSON-RPC requests from standard input (`stdin`) and writing JSON responses to standard output (`stdout`).
- **Zero Open Network Ports**: Unlike HTTP servers, an MCP server on `stdio` opens **no network ports** (`localhost`, `0.0.0.0`). It is completely invisible to local network sniffers, port scanners, and malicious browser scripts.
- **Process Isolation**: Only the parent IDE process that spawned the server holds the pipes to talk to it. When the IDE closes, the operating system closes the pipe (`EOF`), and the MCP server terminates instantly with zero zombie processes.
- **How to test or exit**: If you launched it in a human terminal to test it, simply press `Ctrl+C` to exit. To use the server, configure it in your editor's MCP settings (see [Client Configuration](#client-configuration) below).

### Versions and upgrades

An unpinned `npx` configuration can pick up a new release on its own. For teams and CI, pin an exact version so that it only changes when you choose:

```bash
npx -y @illicomedia/skills-mcp-server@3.1.0
```

- **`latest`** is the default and the recommended stable version.
- **`next`** is a release being tried before it reaches `latest`. Do not use it in production.
- Version numbers follow [Semantic Versioning](https://semver.org/): a major version can break an existing setup, while minor and patch versions do not. See the [changelog](CHANGELOG.md).
- A deprecation warning means that version has a known problem, and the message names its replacement.
- Only the latest major version is supported, in its newest patch. When a new major version ships, older ones reach end of life and are deprecated on npm, with the version to use instead. 1.x and 2.x are end of life: use 3.x.

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
      "args": []
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
      "args": []
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
      "args": ["/absolute/path/to/skills-mcp-server/dist/index.js"]
    }
  }
}
```

### 4. GitHub Copilot and VS Code

Copilot reads `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`), and a workspace-root `.mcp.json`, both with a top-level `mcpServers`:

```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "npx",
      "args": ["-y", "@illicomedia/skills-mcp-server"]
    }
  }
}
```

VS Code's own `.vscode/mcp.json` (or the user-profile `mcp.json`) uses `servers` with `"type": "stdio"`. VS Code describes that format as deprecated for Copilot sessions and forwards existing entries ([MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)):

```json
{
  "servers": {
    "fredo-qa": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@illicomedia/skills-mcp-server"]
    }
  }
}
```

### 5. Other clients (Windsurf, Cline, ...)

Any MCP client that starts a local `stdio` server works: give it the command `npx` with the arguments `-y @illicomedia/skills-mcp-server` (or `fredo-qa-mcp-server` when installed globally). Where the configuration file lives depends on the client and its version: see its MCP documentation.

---

## Complete Uninstallation & Clean Removal

We believe software should never pollute your system or workspace. The Fredo QA MCP server:
- Has **zero background daemons or services**.
- Runs **zero remote telemetry or background network jobs**.
- Writes files **only to `.agents/`** in your project when explicitly approved (`confirm: true`).

If you decide not to use the MCP server, you can remove it completely and restore a pristine state in seconds:

### Step 1: Remove from your AI Editor / MCP Client Configuration

Simply delete the `"fredo-qa"` block from your client's configuration file:

- **Claude Desktop**: Open `claude_desktop_config.json` and delete the `"fredo-qa"` entry from `mcpServers`.
  - MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
  - Linux: `~/.config/Claude/claude_desktop_config.json`
- **Cursor IDE**: Delete `"fredo-qa"` from `.cursor/mcp.json` or remove it in **Cursor Settings > Features > MCP**.
- **Google Antigravity**: Delete `"fredo-qa"` from `~/.gemini/config/mcp_config.json` or disable it in the Antigravity MCP settings.
- **GitHub Copilot / VS Code**: Delete `"fredo-qa"` from `~/.copilot/mcp-config.json`, `.mcp.json`, `.vscode/mcp.json` or the user-profile `mcp.json`.
- **Other clients**: Delete the `fredo-qa` entry from the client's MCP configuration.

### Step 2: Uninstall the Package

Depending on how you ran the server:

- **If run via `npx` (Option 2)**: Nothing was permanently installed. The server was executed from the temporary npx cache.
  ```bash
  # Optional: clear npm cache if desired
  npm cache clean --force
  ```
- **If installed globally (Option 1)**:
  ```bash
  npm uninstall -g @illicomedia/skills-mcp-server
  ```
- **If linked locally (`npm link`)**:
  ```bash
  npm unlink -g @illicomedia/skills-mcp-server
  ```

### Step 3: Remove Project & User Artifacts (Optional)

If you previously approved `install_skill` or `sync_workspace_skills`, delete the installed skills directory from your workspace:

```bash
# In your project root:
rm -rf .agents/

# If you generated local license or exception files:
rm -f .qa-license.json .qa-exceptions.yaml

# If you stored a global license file:
rm -rf ~/.config/fredo-qa
```

### Step 4: Check for QA Files Your AI Agent May Have Created

> [!WARNING]
> The server itself only writes under `.agents/`. Your **AI agent**, however, may have added QA
> files to your project while following the skills, most commonly a QA command wrapper:
> **`scripts/qa.sh`** and its gate folders **`scripts/qa/<profile>.d/`**.
>
> - **Server versions before 1.4.5** reported a missing `scripts/qa.sh` in `quick_check`, which
>   could lead an agent to create one. Since 1.4.5 the server never asks for it: native commands
>   (`npm test`, `cargo test`, `pytest`, `make`, ...) count as first-class QA.
> - The **`qa-core` skill** describes this wrapper as an optional template, so an agent applying
>   it may still create one, whatever the server version.

These files are now part of your project, and other tools (CI, a `Makefile`, git hooks) may call
them. Check before removing anything:

```bash
# Who added them, and when:
git log --diff-filter=A --format='%h %ad %an  %s' --date=short -- scripts/qa.sh scripts/qa

# What still uses them:
grep -rn "scripts/qa" .github .gitlab-ci.yml Makefile justfile package.json .githooks 2>/dev/null

# Only if nothing uses them and you do not want them:
git rm -r scripts/qa.sh scripts/qa
```

### Verification

1. Restart your editor or MCP client.
2. Confirm the `fredo-qa` tools are no longer listed in the client's tools menu.
3. Nothing from the server remains: no dependency, configuration or background process. Files
   your agent created (Step 4) stay until you decide to remove them.

---

## License Verification & Tiered Access

Pro and Enterprise skills require a signed license file (`license.json`, Ed25519 signature, format described by the published JSON Schema).

### License Resolution Order:
1. Session license: a license loaded with the `set_license_key` tool (or the `license_key` argument of `install_skill` / `sync_workspace_skills`) is used first, for the running session only. A license passed with a call is used for that call and becomes the session license only when it verifies; `verify_license` only inspects and never changes the session.
2. User config path: `~/.config/fredo-qa/license.json` (recommended: applies to every project)
3. The server's working directory (the folder your MCP client starts it in; a tool's `project_path` does not change it): `.qa-license.json`. **Add it to `.gitignore`**: the license is yours to use, and committing it to a shared or public repository shares it with everyone who can read the repository.

If the file at step 2 exists, step 3 is not consulted, even when the step 2 file is invalid.

The server reads no environment variable. **Upgrading from 2.x:** if your MCP configuration sets
`FREDO_QA_LICENSE_FILE`, move that file to `~/.config/fredo-qa/license.json` (or the project's
`.qa-license.json`) and remove the `env` entry; the variable is ignored since 3.0.

### Lifetime Version Retention:
A license unlocks all releases published on or before its `updates_until` date **permanently**. Later server releases gracefully run in free community mode (all MIT skills accessible) without breaking, and without any remote clock or telemetry checks.

---

## Security & Sandboxing Architecture

### Declared Node.js Capabilities (Least Privilege)
To satisfy supply-chain and static analysis audits (such as Socket.dev and OpenSSF):
- **Filesystem Access (`node:fs`)**: one module, `security/path-guard`, is the only code that touches the disk (a test fails if any other shipped file imports `node:fs`). Reads serve workspace preflight audits (`quick_check`), local `SKILL.md` documents and license files. Every write goes through a helper that refuses, before acting, any target outside the project root or reached through a symlink leading outside it; writes only happen under `.agents/skills/` and `.agents/.archive/`, and only when a mutating tool is called with explicit user confirmation (`confirm: true`).
- **Environment Variables (`process.env`)**: none. Licenses are found at fixed locations (`~/.config/fredo-qa/license.json`, the project's `.qa-license.json`) or loaded with `set_license_key`; the home directory comes from Node.js `os.homedir()`. A test fails if the built package reads any environment variable.
- **Links (URL strings)**: four `illicomedia.com` links shown to people (pricing, skill pages, the license schema, the product page). They are text in messages and the license; the server never fetches them. A test rejects any other URL in the built package.
- **Network & Shell Spawning**: The runtime contains **zero outbound network calls** (`fetch`, `http`, `net`) and **zero shell or child process executions** (`child_process`, `exec`, `spawn`). The server talks to your client only over stdio.

### Sandboxing Controls
- **Request Size Limit**: A JSON-RPC request line longer than 1,048,576 bytes is dropped as it streams in and answered with a parse error. Licenses, as files or as JSON text, are limited to 64 KB; only regular files are read.
- **Path Escape Prevention**: All project paths are validated against real filesystem paths (`fs.realpathSync`) to block symlink redirections and directory traversal attempts (`../../../`).
- **Forbidden Path Blacklist**: Refuses a project path that is, or lies inside, a system directory (`/`, `/etc`, `/bin`, `/usr/bin`, `C:\Windows`, see above) or a credential vault (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.azure`, `~/.config/gcloud`, `~/.config/gh`, `~/.password-store`, `~/.oci`, `~/Library/Keychains`).
- **Runs Without Calling Our Services**: The server never calls our website, API or database; the skill catalog, license checks and audits all run locally, so an outage on our side does not stop a tool that is already set up. Downloading a skill is a separate, manual step: you fetch each skill from `illicomedia.com/qa-skills` and extract it into your project, so that step needs our website (and a purchased skill needs your account there). Once a skill is in your project, it works offline. The catalog is built into the package: new skills appear in `list_skills` only after you update the server. If your agent starts the server with `npx`, that step also needs the npm registry unless the package is already cached or installed.
- **No Remote Telemetry**: Zero background network requests, zero metric phoning home. All audits, verifications, and tool executions occur strictly on your local machine.

---

## Repository & Governance

- **Canonical Repository**: [github.com/illicomedia/skills-mcp-server](https://github.com/illicomedia/skills-mcp-server)
- **Historical Note**: Prior to v1.4.7, versions 1.4.0 through 1.4.6 were incubated within the `fcviallet/skills` monorepo before transitioning to this dedicated organization repository `illicomedia/skills-mcp-server`.

---

## Development & Testing

```bash
pnpm install
pnpm run check   # lint, build, tests with the 100% coverage gate, packed-tarball smoke test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development flow and [docs/operations/mcp-publish-process.md](docs/operations/mcp-publish-process.md) for releases.

---

## License & Copyright

- **Engine & Free Skills**: Released under the [MIT License](LICENSE).  
- **Pro & Enterprise Skills**: Proprietary, subject to the Fredo QA Commercial Skills License (`LICENSE` of each skill) and the [terms of sale](https://www.illicomedia.com/terms).  
- Copyright (c) 2026 Frédéric Charles Viallet.
