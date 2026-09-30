import * as readline from 'node:readline';
import { runComplianceAudit } from './audit.js';
import { SKILLS_CATALOG, getAvailableSkills, loadSkillContent } from './catalog.js';
import { installSkill, syncWorkspaceSkills } from './installer.js';
import { generateCanaryWatermark, validateLicenseKey } from './license.js';
import type { JsonRpcRequest, JsonRpcResponse, McpTool } from './types.js';

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
    },
  },
  {
    name: 'install_skill',
    description:
      'Install a Fredo QA skill into .agents/skills/<skill_id>/ with SKILL.md and LICENSE. Enforces authentication for paid Pro and Enterprise skills.',
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
          description: 'Optional license key to authenticate or update session before installing',
        },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'sync_workspace_skills',
    description:
      'Auto-detects project stack and provisions matching QA skills and licenses into .agents/skills/. Respects license tiers and reports auth requirements.',
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
          description: 'Optional license key to authenticate or update session before syncing',
        },
      },
    },
  },
  {
    name: 'set_license_key',
    description:
      'Set or update the Fredo QA Skills license key for the active session to unlock Pro or Enterprise skills dynamically.',
    inputSchema: {
      type: 'object',
      properties: {
        license_key: {
          type: 'string',
          description: 'The Fredo QA license key (e.g. fqa_live_pro_..., fqa_live_ent_...)',
        },
      },
      required: ['license_key'],
    },
  },
  {
    name: 'verify_license',
    description:
      'Inspect the current Fredo QA license status, entitlement tier, customer organization, expiration date, and fallback status.',
    inputSchema: {
      type: 'object',
      properties: {
        license_key: {
          type: 'string',
          description: 'Optional license key to test or inspect without modifying session state',
        },
      },
    },
  },
  {
    name: 'audit_compliance',
    description:
      'Execute automated QA and security compliance checks on a project directory (AGENTS.md, RFC 9116 security.txt, secret safety).',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Path to the root directory of the project to audit',
        },
      },
      required: ['project_path'],
    },
  },
];

export class FredoQaMcpServer {
  private licenseKey?: string;

  constructor(licenseKey?: string) {
    this.licenseKey = licenseKey || process.env.FREDO_QA_LICENSE_KEY;
  }

  public setLicenseKey(key: string): void {
    this.licenseKey = key;
  }

  public handleRequest(request: JsonRpcRequest): JsonRpcResponse {
    const { id, method, params } = request;

    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'fredo-qa-mcp-server',
              version: '1.0.0',
              description: 'Official Fredo QA Skills Model Context Protocol Server',
            },
          },
        };
      }

      case 'notifications/initialized': {
        return { jsonrpc: '2.0', id };
      }

      case 'ping': {
        return { jsonrpc: '2.0', id, result: {} };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: MCP_TOOLS,
          },
        };
      }

      case 'tools/call': {
        const toolName = params?.name as string;
        const toolArgs = (params?.arguments || {}) as Record<string, unknown>;

        try {
          const content = this.executeTool(toolName, toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: content,
                },
              ],
            },
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Error executing tool '${toolName}': ${(error as Error).message}`,
                },
              ],
              isError: true,
            },
          };
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
      }
    }
  }

  private executeTool(name: string, args: Record<string, unknown>): string {
    if (args.license_key && typeof args.license_key === 'string') {
      this.licenseKey = args.license_key.trim();
    }
    const license = validateLicenseKey(this.licenseKey);

    switch (name) {
      case 'set_license_key': {
        const key = args.license_key as string;
        this.licenseKey = key?.trim();
        const updatedLicense = validateLicenseKey(this.licenseKey);
        return JSON.stringify(
          {
            status: updatedLicense.valid ? 'AUTHENTICATED' : 'FREE_TIER_FALLBACK',
            tier: updatedLicense.tier.toUpperCase(),
            customer: updatedLicense.customerName || 'Community User',
            expiresAt: updatedLicense.expiresAt || 'Never (Free Tier)',
            valid: updatedLicense.valid,
            message: updatedLicense.message,
          },
          null,
          2,
        );
      }

      case 'verify_license': {
        const targetLicense = args.license_key
          ? validateLicenseKey(args.license_key as string)
          : license;
        return JSON.stringify(
          {
            status: targetLicense.valid ? 'ACTIVE' : targetLicense.isExpired ? 'EXPIRED' : 'FREE_TIER',
            tier: targetLicense.tier.toUpperCase(),
            customer: targetLicense.customerName || 'Community User',
            expiresAt: targetLicense.expiresAt || 'Never (Free Tier)',
            fallbackMode: targetLicense.fallbackMode,
            message: targetLicense.message,
            portal: 'https://skills.illicomedia.com/pricing',
          },
          null,
          2,
        );
      }

      case 'list_skills': {
        const skills = getAvailableSkills(license.tier);
        const categoryFilter = args.category as string | undefined;
        const filtered = categoryFilter
          ? skills.filter((s) => s.category === categoryFilter)
          : skills;

        const freeCount = SKILLS_CATALOG.filter((s) => s.tier === 'free').length;
        const totalCount = SKILLS_CATALOG.length;
        const advisory = license.fallbackMode
          ? `\n> [!NOTE] Running on Free Foundation tier (${freeCount} MIT skills). Upgrade to Pro or Enterprise at https://skills.illicomedia.com/pricing to unlock all ${totalCount} skills.\n`
          : '';

        const list = filtered
          .map(
            (s) =>
              `- **\`${s.id}\`** [${s.tier.toUpperCase()}] (${s.name}): ${s.description}\n  *Key Gates:* ${s.rulesSummary.join(', ')}`,
          )
          .join('\n');

        return `# Available Fredo QA Skills (${filtered.length} accessible under ${license.tier.toUpperCase()} plan)\n${advisory}\n${list}`;
      }

      case 'get_skill_rules': {
        const skillId = args.skill_id as string;
        if (!skillId) {
          throw new Error('Missing parameter "skill_id"');
        }

        const skills = getAvailableSkills(license.tier);
        const skill = skills.find((s) => s.id === skillId);

        if (!skill) {
          return `# Access Restricted: ${skillId}\nThis skill is a commercial package requiring an active Pro or Enterprise license.\nCurrent tier: **${license.tier.toUpperCase()}**\n\n${license.message}\n\nTo unlock this skill or activate an API key, use 'set_license_key' or visit:\nhttps://skills.illicomedia.com/pricing`;
        }

        const content = loadSkillContent(skillId);
        const watermark = generateCanaryWatermark(
          license.customerName || 'community_user',
          skillId,
        );

        return `${watermark}\n\n${content}`;
      }

      case 'install_skill': {
        const skillId = args.skill_id as string;
        if (!skillId) {
          throw new Error('Missing parameter "skill_id"');
        }
        const projectPath = (args.project_path as string) || process.cwd();
        const res = installSkill(skillId, projectPath, license);
        return JSON.stringify(res, null, 2);
      }

      case 'sync_workspace_skills': {
        const projectPath = (args.project_path as string) || process.cwd();
        const requestedSkills = args.skills as string[] | undefined;
        const res = syncWorkspaceSkills(projectPath, requestedSkills, license);
        return res.summaryMessage;
      }

      case 'audit_compliance': {
        const projectPath = (args.project_path as string) || process.cwd();
        const report = runComplianceAudit(projectPath);
        return JSON.stringify(report, null, 2);
      }

      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }

  public startStdio(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const request = JSON.parse(trimmed) as JsonRpcRequest;
        const response = this.handleRequest(request);

        if (request.id !== undefined) {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
      } catch (err) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null as unknown as string,
          error: {
            code: -32700,
            message: `Parse error: ${(err as Error).message}`,
          },
        };
        process.stdout.write(`${JSON.stringify(errorResponse)}\n`);
      }
    });
  }
}
