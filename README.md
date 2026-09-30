# Fredo QA Skills - Model Context Protocol (MCP) Server

Official **Model Context Protocol (MCP)** server for **Fredo QA Skills**.
Connects AI coding assistants (**Cursor, Claude Desktop, Antigravity, Windsurf, Copilot**) to the Fredo QA Skills quality policy engine and compliance framework.

---

## Features

- **Standard MCP Protocol**: 100% compliant with the MCP specification (JSON-RPC 2.0 over `stdio`).
- **Dynamic Skill Injection**: Automatically supplies AI agents with authoritative QA rules, test commands, and quality gates (`qa:starter`, `qa:standard`, `qa:strict`).
- **License-Aware Gateways**: Authenticates `FREDO_QA_LICENSE_KEY` and unlocks Free, Pro, or Enterprise skills accordingly.
- **Graceful Fallback Mode**: When an annual subscription expires, the server gracefully defaults to the **Free Foundation** tier without crashing, honoring the **Perpetual Version Retention** license.
- **Canary Cryptographic Watermarking**: Embeds non-intrusive provenance tokens into skill outputs for copyright protection and leak detection.
- **Built-in Compliance Audit**: Exposes an `audit_compliance` tool to inspect repository health (AGENTS.md, RFC 9116 security.txt, secret safety, test gates).

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
        "FREDO_QA_LICENSE_KEY": "fqa_live_pro_yourname_xxxxxxxx_xxxxxxxxxxxx"
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
        "FREDO_QA_LICENSE_KEY": "fqa_live_pro_yourname_xxxxxxxx_xxxxxxxxxxxx"
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
        "FREDO_QA_LICENSE_KEY": "fqa_live_ent_yourcompany_xxxxxxxx_xxxxxxxxxxxx"
      }
    }
  }
}
```

---

## Available MCP Tools

| Tool Name | Parameters | Description |
|---|---|---|
| `list_skills` | `{ category?: string }` | Lists all skills accessible under your current plan with their descriptions and key gates. |
| `get_skill_rules` | `{ skill_id: string }` | Returns complete prompt instructions and QA directives for a skill (e.g. `qa-security`, `qa-accessibility`). |
| `install_skill` | `{ skill_id: string, project_path?: string, license_key?: string }` | Installs a skill into `.agents/skills/<skill_id>/` with `SKILL.md` and `LICENSE`. Enforces auth for paid Pro & Enterprise skills. |
| `sync_workspace_skills` | `{ project_path?: string, skills?: string[], license_key?: string }` | Auto-detects project stack and provisions matching QA skills and licenses. Respects license tiers and reports auth status. |
| `set_license_key` | `{ license_key: string }` | Sets or updates license key dynamically in the active session to unlock Pro or Enterprise skills without server restart. |
| `audit_compliance` | `{ project_path: string }` | Runs deterministic compliance checks (AGENTS.md, security.txt, test scripts, secret protection) against your repository. |
| `verify_license` | `{ license_key?: string }` | Returns license validity, customer ID, expiry date, tier, and fallback status. |

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
