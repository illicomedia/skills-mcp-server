#!/usr/bin/env node

/**
 * Fredo QA Skills — Model Context Protocol (MCP) Server CLI
 *
 * Runs an MCP server on stdio for Cursor, Claude Desktop, Antigravity, and Copilot.
 * License key can be passed via FREDO_QA_LICENSE_KEY environment variable.
 */

import { FredoQaMcpServer } from './server.js';

const licenseKey = process.env.FREDO_QA_LICENSE_KEY;
const server = new FredoQaMcpServer(licenseKey);

// Log diagnostic to stderr so stdout remains 100% clean for JSON-RPC MCP
process.stderr.write(
  `[fredo-qa-mcp-server] Starting Model Context Protocol server on stdio (PID: ${process.pid})...\n`,
);

server.startStdio();
