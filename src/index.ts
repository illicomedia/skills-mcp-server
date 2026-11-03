#!/usr/bin/env node

/**
 * Fredo QA Skills — Model Context Protocol (MCP) Server CLI
 *
 * Runs an MCP server on stdio for Cursor, Claude Desktop, Antigravity, and Copilot.
 * Paid tiers need a signed license file, discovered from FREDO_QA_LICENSE_FILE,
 * ~/.config/fredo-qa/license.json, or .qa-license.json in the working directory.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenseLockProblem } from './license/lock.js';
import { unsupportedRuntimeReason } from './security/runtime-guard.js';
import { FredoQaMcpServer } from './server/server.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Refuse to start, before reading any codebase, on a Node.js line without security fixes
// or without the MIT LICENSE next to the server.
const startupProblem =
  unsupportedRuntimeReason(process.version) ?? licenseLockProblem(process.cwd(), packageDir);
if (startupProblem) {
  process.stderr.write(`[FATAL] ${startupProblem}\n`);
  process.exit(1);
}

const server = new FredoQaMcpServer();

// Log diagnostic to stderr so stdout remains 100% clean for JSON-RPC MCP
process.stderr.write(
  `[fredo-qa-mcp-server] Starting Model Context Protocol server on stdio (PID: ${process.pid})...\n`,
);

server.startStdio();
