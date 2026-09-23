import * as readline from 'node:readline';
import { runComplianceAudit } from './audit.js';
import { getAvailableSkills, loadSkillContent } from './catalog.js';
import { generateCanaryWatermark, validateLicenseKey } from './license.js';
import type { JsonRpcRequest, JsonRpcResponse, McpTool } from './types.js';

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_skills',
    description:
      'List all Fredo QA Skills available under the current license tier (Free Foundation, Pro Production, Enterprise Assurance), including rules summaries and categories.',
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
          description:
            'The unique identifier of the skill (e.g. qa-core, dev-flow, qa-security, qa-accessibility, qa-gdpr-rgpd)',
        },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'audit_compliance',
    description:
      'Execute automated QA and security compliance checks on a project directory. Verifies AGENTS.md directives, security.txt RFC 9116, secret protection, and standardized package scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Absolute or relative path to the root directory of the project to audit',
        },
      },
      required: ['project_path'],
    },
  },
  {
    name: 'verify_license',
    description:
      'Inspect the current Fredo QA Skills license key status, active entitlement tier, customer organization, expiration date, and fallback status.',
    inputSchema: {
      type: 'object',
      properties: {},
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
        // Notification, no return content
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
    const license = validateLicenseKey(this.licenseKey);

    switch (name) {
      case 'verify_license': {
        return JSON.stringify(
          {
            status: license.valid ? 'ACTIVE' : license.isExpired ? 'EXPIRED' : 'FREE_TIER',
            tier: license.tier.toUpperCase(),
            customer: license.customerName || 'Community User',
            expiresAt: license.expiresAt || 'Never (Free Tier)',
            fallbackMode: license.fallbackMode,
            message: license.message,
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

        const advisory = license.fallbackMode
          ? `\n> [!NOTE] Running on Free Foundation tier (7 MIT skills). Upgrade to Pro or Enterprise at https://skills.illicomedia.com/pricing to unlock all 16 skills.\n`
          : '';

        const list = filtered
          .map(
            (s) =>
              `- **\`${s.id}\`** [${s.tier.toUpperCase()}] (${s.name}): ${s.description}\n  *Key Gates:* ${s.rulesSummary.join(', ')}`,
          )
          .join('\n');

        return `# Available Fredo QA Skills (${filtered.length} accessible under ${license.tier.toUpperCase()} plan)
${advisory}
${list}`;
      }

      case 'get_skill_rules': {
        const skillId = args.skill_id as string;
        if (!skillId) {
          throw new Error('Missing parameter "skill_id"');
        }

        const skills = getAvailableSkills(license.tier);
        const skill = skills.find((s) => s.id === skillId);

        if (!skill) {
          // Check if it's a paid skill that requires upgrade
          return `# Access Restricted: ${skillId}
This skill is a commercial package requiring an active Pro or Enterprise license.
Current tier: **${license.tier.toUpperCase()}**

${license.message}

To unlock this skill or obtain an API key, visit:
https://skills.illicomedia.com/pricing`;
        }

        const content = loadSkillContent(skillId);
        const watermark = generateCanaryWatermark(
          license.customerName || 'community_user',
          skillId,
        );

        return `${watermark}\n\n${content}`;
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

  /**
   * Starts the stdio event loop
   */
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

        // Do not respond to notifications
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
