// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** The production API. Committed, so what gets published is reviewable. */
export const PRODUCTION_API_ENDPOINT = 'https://www.illicomedia.com/api/v1';

/**
 * FREDO_QA_API_URL overrides the endpoint, for testing or a future host. License keys would follow it,
 * so only HTTPS is accepted. Anything else keeps the default.
 */
export function resolveApiEndpoint(override: string | undefined): string {
  const value = override?.trim();
  if (!value) {
    return PRODUCTION_API_ENDPOINT;
  }
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') {
      return value.replace(/\/+$/, '');
    }
  } catch {
    // Not a URL: refused below.
  }
  // stderr: stdout carries the MCP protocol.
  console.error('[fredo-qa] FREDO_QA_API_URL ignored: it must be an https:// URL.');
  return PRODUCTION_API_ENDPOINT;
}
