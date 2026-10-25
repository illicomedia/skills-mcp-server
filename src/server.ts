// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import * as readline from 'node:readline';
import { ToolExecutor } from './executor.js';
import type { LicenseOptions } from './license.js';
import { MCP_TOOLS, findToolDefinition, validateToolParams } from './tools.js';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';
import { SERVER_VERSION } from './version.js';

export { MCP_TOOLS };

export const DEFAULT_API_ENDPOINT =
  process.env.FREDO_QA_API_URL || 'https://www.illicomedia.com/api';

export class FredoQaMcpServer {
  private licenseKey?: string;
  private readonly licenseOptions: LicenseOptions;

  /**
   * @param licenseSource Signed license JSON or a path to it. When omitted, the license file
   *   is discovered (FREDO_QA_LICENSE_FILE, user config, then project `.qa-license.json`).
   */
  constructor(licenseSource?: string, licenseOptions: LicenseOptions = {}) {
    this.licenseKey = licenseSource;
    this.licenseOptions = licenseOptions;
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
              name: '@illicomedia/skills-mcp-server',
              version: SERVER_VERSION,
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

        // 1. Verify tool exists (error -32601)
        const toolDef = findToolDefinition(toolName);
        if (!toolDef) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Tool not found: '${toolName}'`,
            },
          };
        }

        // 2. Strict schema and parameter validation (error -32602)
        const validationError = validateToolParams(toolDef, toolArgs);
        if (validationError) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Invalid params for tool '${toolName}': ${validationError}`,
            },
          };
        }

        // 3. Execute tool
        try {
          const content = ToolExecutor.execute(
            toolName,
            toolArgs,
            this.licenseKey,
            (k) => this.setLicenseKey(k),
            this.licenseOptions,
          );
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
