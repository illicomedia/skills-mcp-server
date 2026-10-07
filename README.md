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
- **Presence Audit**: The `audit_compliance` tool checks that expected files and scripts exist (AGENTS.md, `.qa-exceptions.yaml`, security.txt, `.gitignore`, QA scripts). It does not run gates or validate contents.

---

## Quick Setup

### 1. Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "node",
      "args": ["/absolute/path/to/skills/packages/mcp-server/dist/index.js"],
      "env": {
        "FREDO_QA_LICENSE_FILE": "/absolute/path/to/license.json"
      }
    }
  }
}
```

### 2. Cursor IDE

Add to `.cursor/mcp.json` in your workspace or user settings:

```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "node",
      "args": ["/absolute/path/to/skills/packages/mcp-server/dist/index.js"],
      "env": {
        "FREDO_QA_LICENSE_FILE": "/absolute/path/to/license.json"
      }
    }
  }
}
```

### 3. Google Antigravity

Add to your `antigravity.json` or custom MCP settings:

```json
{
  "mcpServers": {
    "fredo-qa": {
      "command": "node",
      "args": ["/absolute/path/to/skills/packages/mcp-server/dist/index.js"],
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
| `audit_compliance` | `{ project_path: string }` | Reports which expected files and scripts are present. Presence only: no gate is executed and no content is validated. |
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
