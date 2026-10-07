#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/**
 * Fredo QA Skills — Model Context Protocol (MCP) Server CLI
 *
 * Runs an MCP server on stdio for Cursor, Claude Desktop, Antigravity, and Copilot.
 * Paid tiers need a signed license file, discovered from FREDO_QA_LICENSE_FILE,
 * ~/.config/fredo-qa/license.json, or .qa-license.json in the working directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FredoQaMcpServer } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const server = new FredoQaMcpServer();

// Log diagnostic to stderr so stdout remains 100% clean for JSON-RPC MCP
process.stderr.write(
  `[fredo-qa-mcp-server] Starting Model Context Protocol server on stdio (PID: ${process.pid})...\n`,
);

server.startStdio();
