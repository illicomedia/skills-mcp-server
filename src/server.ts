import * as readline from 'node:readline';
import { ToolExecutor } from './executor.js';
import { MCP_TOOLS, findToolDefinition, validateToolParams } from './tools.js';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';

export { MCP_TOOLS };

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
