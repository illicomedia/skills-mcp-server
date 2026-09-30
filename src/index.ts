#!/usr/bin/env node

/**
 * Fredo QA Skills — Model Context Protocol (MCP) Server CLI
 *
 * Runs an MCP server on stdio for Cursor, Claude Desktop, Antigravity, and Copilot.
 * License key can be passed via FREDO_QA_LICENSE_KEY environment variable.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FredoQaMcpServer } from './server.js';

// Pre-flight License Security Lock (Rule 7)
function verifyLicenseLock(): void {
  const rootLicense = path.resolve(process.cwd(), 'LICENSE');
  const pkgLicense = path.resolve(__dirname, '..', 'LICENSE');
  const hasValidLicense =
    (fs.existsSync(rootLicense) && fs.statSync(rootLicense).size > 0) ||
    (fs.existsSync(pkgLicense) && fs.statSync(pkgLicense).size > 0);

  if (!hasValidLicense) {
    process.stderr.write(
      '[FATAL] License Pre-Flight Security Lock failed: missing or empty LICENSE file. Halting execution.\n',
    );
    process.exit(1);
  }
}

verifyLicenseLock();

const licenseKey = process.env.FREDO_QA_LICENSE_KEY;
const server = new FredoQaMcpServer(licenseKey);

// Log diagnostic to stderr so stdout remains 100% clean for JSON-RPC MCP
process.stderr.write(
  `[fredo-qa-mcp-server] Starting Model Context Protocol server on stdio (PID: ${process.pid})...\n`,
);

server.startStdio();
