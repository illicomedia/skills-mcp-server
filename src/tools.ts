// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import type { McpTool } from './types.js';

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_skills',
    description:
      'List all Fredo QA Skills available under the current license tier (Free, Pro, Enterprise), with rule summaries and categories.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category filter: core, language, quality, compliance, enterprise',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_skill_rules',
    description:
      'Retrieve detailed instructions, mandatory quality rules, and inner-loop commands for a specific Fredo QA skill.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: 'The unique skill ID (e.g. qa-core, dev-flow, qa-security, qa-java)',
        },
      },
      required: ['skill_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'install_skill',
    description:
      'Install a Fredo QA skill into .agents/skills/<skill_id>/ with SKILL.md and LICENSE. Requires user agreement: set confirm: true to write files to disk; when false (default), returns a safe preview without modifying the filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: 'The unique skill ID to install',
        },
        project_path: {
          type: 'string',
          description: 'Target project root directory (defaults to current working directory)',
        },
        license_key: {
          type: 'string',
          description: 'Optional signed license file (path or JSON content) to use for this session before installing',
        },
        confirm: {
          type: 'boolean',
          description:
            'Explicit user confirmation to write files to disk. When false (default), returns a preview of files to be created without modifying the filesystem.',
        },
      },
      required: ['skill_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'sync_workspace_skills',
    description:
      'Auto-detects project stack and provisions matching QA skills and licenses into .agents/skills/. Requires user agreement: set confirm: true to write files; when false (default), returns a dry-run preview.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Target project root directory (defaults to current working directory)',
        },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of skill IDs to install. If omitted, auto-detects from project stack.',
        },
        license_key: {
          type: 'string',
          description: 'Optional signed license file (path or JSON content) to use for this session before syncing',
        },
        confirm: {
          type: 'boolean',
          description:
            'Explicit user confirmation to write files to disk. When false (default), returns a dry-run preview without modifying the filesystem.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_license_key',
    description:
      'Set the signed Fredo QA Skills license file for the active session to unlock Pro or Enterprise skills.',
    inputSchema: {
      type: 'object',
      properties: {
        license_key: {
          type: 'string',
          description: 'Path to a signed license file (license.json) or its JSON content',
        },
      },
      required: ['license_key'],
      additionalProperties: false,
    },
  },
  {
    name: 'verify_license',
    description:
      'Inspect the current Fredo QA license: signature validity, tier, licensee, last covered release date (updates_until), and fallback status.',
    inputSchema: {
      type: 'object',
      properties: {
        license_key: {
          type: 'string',
          description: 'Optional signed license file (path or JSON content) to inspect without modifying session state',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'quick_check',
    description:
      'Sub-second preflight check for AI agents to discover repository stack, governance policies, and baseline scaffolding before modifying code. Verifies presence and configuration of agent instructions (AGENTS.md), licensing, secret hygiene (.gitignore), dependency lockfile, and test runner declaration.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Path to the root directory of the project to check',
        },
      },
      required: ['project_path'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_version',
    description:
      'Retrieve the active package version, protocol specification, and runtime metadata of the Fredo QA MCP Server.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

export function findToolDefinition(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}

/**
 * Validates tool call parameters against strict schema rules:
 * - Checks that all required parameters are present.
 * - Rejects undeclared properties when additionalProperties is false (RFC / MCP requirement).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateToolParams(
  tool: McpTool,
  params: Record<string, unknown>,
): string | null {
  const schema = tool.inputSchema;

  // 1. Required parameters check
  if (schema.required) {
    for (const req of schema.required) {
      if (params[req] === undefined || params[req] === null || params[req] === '') {
        return `Missing required parameter: '${req}'`;
      }
    }
  }

  // 2. Strict additionalProperties: false check
  const allowedKeys = new Set(Object.keys(schema.properties));
  for (const key of Object.keys(params)) {
    if (!allowedKeys.has(key)) {
      return `Unrecognized parameter '${key}' (tool '${tool.name}' does not allow additional properties)`;
    }
  }

  return null;
}
