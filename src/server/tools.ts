import type { McpTool } from '../types.js';

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
      'Return the SKILL.md of a Fredo QA skill installed in the working directory (skills/<id>/ or .agents/skills/<id>/). This server ships no skill files: if the skill is not installed, the call fails with installation instructions; do not invent rules for it.',
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
      'Install a Fredo QA skill into .agents/skills/<skill_id>/ with SKILL.md and LICENSE, copying SKILL.md from a skill source already present in the project (skills/<id>/ or .agents/skills/<id>/); fails if none exists. Requires user agreement: set confirm: true to write files to disk; when false (default), returns a safe preview without modifying the filesystem.',
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
          description:
            'Optional signed license file (path or JSON content) to use for this session before installing',
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
          description:
            'Optional list of skill IDs to install. If omitted, auto-detects from project stack.',
        },
        license_key: {
          type: 'string',
          description:
            'Optional signed license file (path or JSON content) to use for this session before syncing',
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
    name: 'prune_skills',
    description:
      'Safely prunes unneeded QA skills from .agents/skills/ by archiving them to .agents/.archive/ based on detected project tech stacks. Non-destructive: files are moved rather than permanently deleted, keeping them fully recoverable while removing noise from the AI agent context. Requires user agreement: set confirm: true to archive skills; when false (default), returns a safe preview listing candidate skills without moving files.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Target project root directory (defaults to current working directory)',
        },
        keep_skills: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of skill IDs to keep active even if not auto-detected from project files',
        },
        confirm: {
          type: 'boolean',
          description:
            'Explicit user confirmation to archive unneeded skill directories to .agents/.archive/. When false (default), returns a preview without moving files.',
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
          description:
            'Optional signed license file (path or JSON content) to inspect without modifying session state',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'quick_check',
    description:
      'Sub-second preflight check for AI agents to discover repository stack, governance policies, and baseline scaffolding before modifying code. Verifies presence and configuration of agent instructions (AGENTS.md), licensing, secret hygiene (.gitignore), dependency lockfile, and test runner declaration. Requires user agreement: set confirm: true to perform directory traversal and inspect project files; when false (default), returns a preview describing the audit scope and target directory without scanning the filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Path to the root directory of the project to check',
        },
        confirm: {
          type: 'boolean',
          description:
            'Explicit user confirmation to inspect repository and traverse directory tree. When false (default), returns a preview describing the audit scope without scanning the filesystem.',
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

interface SchemaProperty {
  type?: string;
  items?: { type?: string };
}

function validateParamTypes(
  properties: Record<string, unknown>,
  params: Record<string, unknown>,
): string | null {
  for (const [key, rawProp] of Object.entries(properties)) {
    const prop = rawProp as SchemaProperty;
    const val = params[key];
    if (val === undefined || val === null) {
      continue;
    }
    if (prop.type === 'boolean' && typeof val !== 'boolean') {
      return `Invalid type for parameter '${key}': expected boolean, received ${typeof val}`;
    }
    if (prop.type === 'string' && typeof val !== 'string') {
      return `Invalid type for parameter '${key}': expected string, received ${typeof val}`;
    }
    if (prop.type === 'array') {
      if (!Array.isArray(val)) {
        return `Invalid type for parameter '${key}': expected array, received ${typeof val}`;
      }
      if (prop.items?.type === 'string' && !val.every((item) => typeof item === 'string')) {
        return `Invalid item in array parameter '${key}': all items must be strings`;
      }
    }
  }
  return null;
}

/**
 * Validates tool call parameters against strict schema rules:
 * - Checks that all required parameters are present.
 * - Rejects undeclared properties when additionalProperties is false (RFC / MCP requirement).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateToolParams(tool: McpTool, params: Record<string, unknown>): string | null {
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

  // 3. Strict property type checks
  return validateParamTypes(schema.properties, params);
}
