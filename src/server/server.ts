import type { LicenseOptions } from '../license/license.js';
import type { JsonRpcRequest, JsonRpcResponse } from '../types.js';
import { SERVER_VERSION } from '../version.js';
import { ToolExecutor } from './executor.js';
import { LineFramer } from './framing.js';
import { findToolDefinition, MCP_TOOLS, validateToolParams } from './tools.js';

export const MAX_REQUEST_BYTES = 1024 * 1024; // 1MB DoS guard per JSON-RPC frame

const parseError = (message: string): string =>
  JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message } });

/** The answer to a request line larger than MAX_REQUEST_BYTES (the line itself is dropped). */
function oversizeError(): string {
  return parseError(
    `Parse error: request line exceeds maximum allowed size of ${MAX_REQUEST_BYTES} bytes.`,
  );
}

export class FredoQaMcpServer {
  private licenseKey?: string;
  private readonly licenseOptions: LicenseOptions;

  /**
   * @param licenseSource Signed license JSON or a path to it. When omitted, the license file
   *   is discovered (user config, then project `.qa-license.json`).
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
    const write = (output: string | null): void => {
      if (output !== null) {
        process.stdout.write(`${output}\n`);
      }
    };
    const framer = new LineFramer(
      MAX_REQUEST_BYTES,
      (line) => write(this.handleLine(line)),
      () => write(oversizeError()),
    );
    process.stdin.on('data', (chunk: Buffer) => framer.push(chunk));
    process.stdin.on('end', () => framer.end());
  }

  /** One line of the stdio protocol: the JSON to answer with, or null when no answer is due. */
  public handleLine(line: string): string | null {
    if (Buffer.byteLength(line, 'utf8') > MAX_REQUEST_BYTES) {
      return oversizeError();
    }
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const request = JSON.parse(trimmed) as JsonRpcRequest;
      const response = this.handleRequest(request);
      return request.id === undefined ? null : JSON.stringify(response);
    } catch (err) {
      return parseError(`Parse error: ${(err as Error).message}`);
    }
  }
}
