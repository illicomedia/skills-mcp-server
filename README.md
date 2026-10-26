# Fredo QA Skills - Model Context Protocol (MCP) Server

Official **Model Context Protocol (MCP)** server for **Fredo QA Skills**.
Connects AI coding assistants (**Cursor, Claude Desktop, Antigravity, Windsurf, Copilot**) to the Fredo QA Skills quality policy engine and compliance framework.

---

## Features

- **Standard MCP Protocol**: 100% compliant with the MCP specification (JSON-RPC 2.0 over `stdio`).
- **Dynamic Skill Injection**: Automatically supplies AI agents with authoritative QA rules, test commands, and quality gates (`qa:starter`, `qa:standard`, `qa:strict`).
- **Signed License Files**: Verifies an Ed25519-signed `license.json` offline and unlocks Pro or Enterprise skills accordingly. Without a valid license, all MIT skills stay available.
- **Version Retention**: A license unlocks every server release published on or before its `updates_until` date, permanently. Later releases run in free mode until the license is renewed. No clock check is involved.
- **Canary Cryptographic Watermarking**: Embeds non-intrusive provenance tokens into skill outputs for copyright protection and leak detection.
- **Preflight Sensor**: The `quick_check` tool provides sub-second intake checks for AI agents to discover repository stack, governance policies, and baseline scaffolding (AGENTS.md, `.qa-exceptions.yaml`, security.txt, `.gitignore`, lockfiles, test runners). It does not execute compilers or test suites.

---

## Installation & Setup

### A. Local / Offline Global Installation (No remote npmjs.org)

For offline environments, air-gapped workstations, or active local development without hitting `registry.npmjs.org`:

1. **Build the server:**
   ```bash
   cd packages/mcp-server
   npm run build
   ```

2. **Install globally offline (`-g`):**
   ```bash
   # Option 1: Direct offline global install
   npm install -g ./packages/mcp-server/ --offline

   # Option 2: Active development symlink (instant updates on rebuild)
   cd packages/mcp-server && npm link

   # Option 3: From packed tarball
   cd packages/mcp-server && npm pack
   npm install -g ./illicomedia-skills-mcp-server-*.tgz --offline
   ```

   *(Note: `@illicomedia/skills-mcp-server` has **0 runtime dependencies**, allowing 100% offline installation.)*

3. **Verify global command:**
   ```bash
   which fredo-qa-mcp-server
   ```

4. **Detailed runbook:** See [docs/operations/mcp-local-offline-installation.md](../../docs/operations/mcp-local-offline-installation.md).

---

### B. Client Configuration

Configure your AI assistant using either the local binary (`fredo-qa-mcp-server`), direct node script, or remote `npx`.

#### 1. Claude Desktop (`claude_desktop_config.json`)

**Using local global installation:**
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

**Using remote npx:**
```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "npx",
      "args": ["-y", "@illicomedia/skills-mcp-server"],
      "env": {
        "FREDO_QA_LICENSE_FILE": "/absolute/path/to/license.json"
      }
    }
  }
}
```

#### 2. Cursor IDE (`.cursor/mcp.json`)

**Using local global installation:**
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

**Using remote npx:**
```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "npx",
      "args": ["-y", "@illicomedia/skills-mcp-server"],
      "env": {
        "FREDO_QA_LICENSE_FILE": "/absolute/path/to/license.json"
      }
    }
  }
}
```

#### 3. Google Antigravity (`mcp_config.json`)

**Using local global installation:**
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

**Using direct node execution (no global install needed):**
```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"],
      "env": {
        "FREDO_QA_LICENSE_FILE": "/absolute/path/to/license.json"
      }
    }
  }
}
```

## License Files

Pro and Enterprise skills require a license file signed by the vendor with Ed25519. The server
looks for it in this order:

1. The path in `FREDO_QA_LICENSE_FILE`.
2. `~/.config/fredo-qa/license.json`.
3. `.qa-license.json` at the project root (keep it out of git).

The server verifies the signature offline against the public keys compiled into the release.
A missing, malformed, tampered, or untrusted license leaves the server in free mode and says why.
The format is defined in `docs/plans/2026-10-07-enforcement-kit/distribution-licensing.md`,
section 3.

---

## Available MCP Tools

| Tool Name | Parameters | Description |
|---|---|---|
| `list_skills` | `{ category?: string }` | Lists all skills accessible under your current plan with their descriptions and key gates. |
| `get_skill_rules` | `{ skill_id: string }` | Returns complete prompt instructions and QA directives for a skill (e.g. `qa-security`, `qa-accessibility`). |
| `install_skill` | `{ skill_id: string, project_path?: string, license_key?: string }` | Installs a skill into `.agents/skills/<skill_id>/` with `SKILL.md` and `LICENSE`. Enforces auth for paid Pro & Enterprise skills. |
| `sync_workspace_skills` | `{ project_path?: string, skills?: string[], license_key?: string }` | Auto-detects project stack and provisions matching QA skills and licenses. Respects license tiers and reports auth status. |
| `set_license_key` | `{ license_key: string }` | Sets the signed license file (path or JSON content) for the active session, without a server restart. |
| `quick_check` | `{ project_path: string }` | Sub-second intake preflight for AI agents. Reports stack discovery, baseline scaffolding, and prerequisites readiness (`ready` / `needs_attention`). |
| `verify_license` | `{ license_key?: string }` | Returns signature validity, tier, licensee, license ID, `updates_until`, and fallback status. |

---

## Development & Testing

```bash
# Build the TypeScript MCP server
npm run build

# Run automated tests
npm test
```

---

## License & Copyright

Copyright (c) 2026 Frédéric Charles Viallet.  
Open-source foundation tools released under the MIT License.  
Commercial skills and enterprise packs are proprietary and subject to the Fredo QA Skills Commercial License.
