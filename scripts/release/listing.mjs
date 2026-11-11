// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** The MCP Registry listing (server.json): its checks and its publication. */

import { approve, npm, registryState } from './shared.mjs';

/** The official MCP Registry publisher the release accepts: installed by the maintainer, verified. */
const MCP_PUBLISHER_VERSION = '1.8.7';

/** The schema of server.json, the MCP Registry listing. */
const MCP_SERVER_SCHEMA =
  'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';

const MCP_NAME = /^io\.github\.[A-Za-z0-9-]+\/[a-zA-Z0-9._-]+$/;

/**
 * What is wrong with the MCP Registry listing (server.json) for this package at this version.
 * The registry checks that the npm package's "mcpName" equals the listing's name; the rest keeps
 * the listing pointing at exactly the npm package and version being released.
 */
export function listingProblems(listing, pkg, version) {
  const problems = [];
  const npmPackage = (listing.packages ?? [])[0] ?? {};
  if (listing.$schema !== MCP_SERVER_SCHEMA) {
    problems.push(`$schema must be ${MCP_SERVER_SCHEMA}`);
  }
  if (!MCP_NAME.test(listing.name ?? '') || listing.name !== pkg.mcpName) {
    problems.push(
      `name must be package.json "mcpName" (io.github.<owner>/<name>): ${listing.name}`,
    );
  }
  const description = listing.description ?? '';
  if (description.length < 1 || description.length > 100) {
    problems.push(`description must be 1 to 100 characters (has ${description.length})`);
  }
  if (listing.version !== version || npmPackage.version !== version) {
    problems.push(`version and packages[0].version must be ${version}`);
  }
  if (
    (listing.packages ?? []).length !== 1 ||
    npmPackage.registryType !== 'npm' ||
    npmPackage.identifier !== pkg.name ||
    npmPackage.transport?.type !== 'stdio'
  ) {
    problems.push(`packages must be exactly one npm package ${pkg.name} over stdio`);
  }
  return problems;
}

/** The listing with its version (and its npm package's) set to `version`. */
export function listingAtVersion(listing, version) {
  return {
    ...listing,
    version,
    packages: (listing.packages ?? []).map((entry) => ({ ...entry, version })),
  };
}

const MCP_REGISTRY_API = 'https://registry.modelcontextprotocol.io/v0/servers';

export const LISTING = 'server.json';

/** server.json, the MCP Registry listing, or null when the package has none. */
export function readListing(ctx) {
  if (!ctx.listDir(ctx.pkgDir).includes(LISTING)) {
    return null;
  }
  return JSON.parse(ctx.readFile(ctx.join(ctx.pkgDir, LISTING)));
}

export function listingReady(listing, pkg, version) {
  const problems = listingProblems(listing, pkg, version);
  if (problems.length > 0) {
    throw new Error(`server.json is not ready for ${version}:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * Publishes server.json to the official MCP Registry, a listing that points at the npm package.
 * Runs after the version is public on npm (the registry checks it, and its "mcpName"), with the
 * exact pinned mcp-publisher, which the maintainer installs and verifies (Sigstore). Skips a
 * version already listed. Called by --promote; --publish-listing retries it alone.
 */
export async function publishListing(ctx, pkg, { version, dryRun = false, yes = false }) {
  const listing = readListing(ctx);
  if (!listing) {
    ctx.log('No server.json: there is no MCP Registry listing to publish.');
    return;
  }
  listingReady(listing, pkg, version);
  if (!registryState(ctx, pkg.name).versions.includes(version)) {
    throw new Error(`${pkg.name}@${version} is not public on npm; the MCP Registry checks it.`);
  }
  const published = npm(ctx, 'view', `${pkg.name}@${version}`, 'mcpName');
  if (published !== listing.name) {
    throw new Error(
      `${pkg.name}@${version} was published with mcpName "${published}", not "${listing.name}": ` +
        'the MCP Registry would refuse it. Only versions published with mcpName can be listed.',
    );
  }
  const listed = await ctx.fetchJson(
    `${MCP_REGISTRY_API}?search=${encodeURIComponent(listing.name)}`,
  );
  const servers = listed.servers ?? [];
  if (servers.some(({ server }) => server.name === listing.name && server.version === version)) {
    ctx.ok(`${listing.name} ${version} is already listed in the MCP Registry.`);
    return;
  }
  if (dryRun) {
    ctx.log(`[dry-run] Would publish ${listing.name} ${version} to the MCP Registry.`);
    return;
  }
  let reported = '';
  try {
    // mcp-publisher prints its version on stderr (Go's log package).
    reported = ctx.sh('mcp-publisher', ['--version'], { withStderr: true });
  } catch {
    // Not installed: reported stays empty.
  }
  if (
    !new RegExp(`mcp-publisher v?${MCP_PUBLISHER_VERSION.replaceAll('.', '\\.')} `).test(reported)
  ) {
    throw new Error(
      `mcp-publisher ${MCP_PUBLISHER_VERSION} is required (found: ${reported || 'none'}). ` +
        'Install it as the release runbook shows, verified against its Sigstore signature.',
    );
  }
  ctx.sh('mcp-publisher', ['validate'], { interactive: true });
  if (!(await approve(ctx, `Publish ${listing.name} ${version} to the MCP Registry?`, { yes }))) {
    ctx.log(`Listing not published. Later: pnpm release --publish-listing`);
    return;
  }
  ctx.sh('mcp-publisher', ['publish'], { interactive: true });
  ctx.ok(`Published ${listing.name} ${version} to the MCP Registry.`);
}
