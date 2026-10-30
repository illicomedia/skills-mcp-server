#!/usr/bin/env node

/**
 * Automated release and lifecycle workflow for @illicomedia/skills-mcp-server.
 *
 * Guarantees:
 *  1. Verification: runs build and full test suite before touching the registry.
 *  2. Immutability check: ensures package version is not already published on npm.
 *  3. Interactive 2FA / WebAuthn support: inherits stdio so physical security key prompts work.
 *  4. Provenance: automatically enables --provenance when running in GitHub Actions for Socket.dev 100% score.
 *  5. Deprecation & Unpublish lifecycle:
 *      - Automatically deprecates all strictly older versions (< newVersion).
 *      - Optional --unpublish-older: attempts to delete (unpublish) previous versions (<72h) from registry.
 *      - Always guarantees that the new latest version is clean and never marked deprecated.
 *  6. Post-release audit: queries registry and outputs an audit summary.
 *
 * Usage:
 *  node scripts/release.mjs [--dry-run] [--bump patch|minor|major] [--deprecate-only] [--unpublish-older]
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_DIR = resolve(__dirname, '..');
const PKG_JSON_PATH = resolve(PKG_DIR, 'package.json');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isDeprecateOnly = args.includes('--deprecate-only');
const shouldUnpublishOlder = args.includes('--unpublish-older');
const bumpIdx = args.indexOf('--bump');
const bumpType = bumpIdx !== -1 && args[bumpIdx + 1] ? args[bumpIdx + 1] : null;

function log(msg, symbol = 'ℹ') {
  console.log(`\x1b[36m[release]\x1b[0m ${symbol} ${msg}`);
}

function logSuccess(msg) {
  console.log(`\x1b[32m[release]\x1b[0m ✔ ${msg}`);
}

function logWarn(msg) {
  console.log(`\x1b[33m[release]\x1b[0m ⚠ ${msg}`);
}

function logError(msg) {
  console.error(`\x1b[31m[release]\x1b[0m ✖ ${msg}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: PKG_DIR, stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}

function runInteractive(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd: PKG_DIR,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`Command failed with exit code ${res.status}: ${cmd} ${cmdArgs.join(' ')}`);
  }
}

/**
 * Registry lifecycle commands (deprecate, unpublish) go through the npm client: pnpm deprecate does not
 * support security-key 2FA ("Upgrade your client to npm@latest") and rejects the empty message that
 * clears a deprecation. npm runs from the home directory: devEngines rejects npm inside this repository.
 */
function runNpmInteractive(cmdArgs) {
  const res = spawnSync('npm', cmdArgs, { cwd: homedir(), stdio: 'inherit', env: process.env });
  if (res.status !== 0) {
    throw new Error(`Command failed with exit code ${res.status}: npm ${cmdArgs.join(' ')}`);
  }
}

function bumpVersion(currentVersion, type) {
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    throw new Error(`Cannot parse semantic version: ${currentVersion}`);
  }
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${type}. Expected patch, minor, or major.`);
  }
}

async function main() {
  console.log('\n========================================================');
  console.log('  MCP Server Release & Deprecation Automation');
  console.log('========================================================\n');

  // 1. Read package.json
  const pkg = JSON.parse(readFileSync(PKG_JSON_PATH, 'utf8'));
  let version = pkg.version;
  const packageName = pkg.name;

  log(`Package: \x1b[1m${packageName}\x1b[0m`);
  log(`Current package.json version: \x1b[1mv${version}\x1b[0m`);

  // Handle optional bump
  if (bumpType) {
    const nextVersion = bumpVersion(version, bumpType);
    log(`Bumping version from \x1b[33mv${version}\x1b[0m to \x1b[32mv${nextVersion}\x1b[0m (${bumpType})...`);
    if (!isDryRun) {
      pkg.version = nextVersion;
      writeFileSync(PKG_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      version = nextVersion;
      logSuccess(`Updated package.json to v${version}`);
    } else {
      version = nextVersion;
      log(`[dry-run] Would update package.json to v${version}`);
    }
  }

  // 2. Pre-flight authentication check
  log('Checking npm authentication...');
  try {
    const whoami = run('pnpm whoami');
    logSuccess(`Logged into npm as: \x1b[1m${whoami}\x1b[0m`);
  } catch (err) {
    logError('Not logged in to npm. Run `pnpm login` first.');
    process.exit(1);
  }

  // 3. Query existing published versions
  log(`Checking published versions for ${packageName} on npm registry...`);
  let publishedVersions = [];
  try {
    const raw = run(`pnpm view "${packageName}" versions --json`);
    publishedVersions = JSON.parse(raw);
    if (!Array.isArray(publishedVersions)) {
      publishedVersions = [publishedVersions];
    }
  } catch (err) {
    logWarn(`Could not fetch versions (first release?): ${err.message}`);
  }

  log(`Published versions on npm: ${publishedVersions.length ? publishedVersions.join(', ') : 'none'}`);

  if (!isDeprecateOnly) {
    // 4. Version immutability check
    if (publishedVersions.includes(version)) {
      logError(`Version v${version} is ALREADY published on npm registry!`);
      logError(`npm does not permit republishing over an existing version.`);
      logError(`Use --bump [patch|minor|major] or update package.json before releasing.`);
      process.exit(1);
    }

    // 5. Build & Test verification
    log('Building package (tsc)...');
    run('pnpm run build');
    logSuccess('Build completed successfully.');

    log('Running test suite...');
    run('pnpm test');
    logSuccess('All tests passed.');

    // 6. Publish to npm
    const publishArgs = ['publish', '--access', 'public'];
    if (process.env.GITHUB_ACTIONS === 'true') {
      log('Detected GitHub Actions environment, enabling SLSA provenance...');
      publishArgs.push('--provenance');
    }

    log(`Publishing \x1b[1m${packageName}@${version}\x1b[0m to npm...`);
    if (isDryRun) {
      log(`[dry-run] Would execute: pnpm ${publishArgs.join(' ')}`);
    } else {
      console.log('\n--- pnpm publish output (follow 2FA security key prompt if requested) ---');
      runInteractive('pnpm', publishArgs);
      console.log('--- end of publish output ---\n');
      logSuccess(`Successfully published ${packageName}@${version}!`);
    }
  } else {
    log('Running in --deprecate-only mode (skipping publish).');
  }

  // 7. Optional: Unpublish older versions if requested
  const olderVersions = publishedVersions.filter((v) => v !== version);
  if (shouldUnpublishOlder && olderVersions.length > 0) {
    log(`Attempting to unpublish (delete) ${olderVersions.length} older version(s)...`);
    for (const oldVer of olderVersions) {
      log(`Unpublishing ${packageName}@${oldVer} --force...`);
      if (isDryRun) {
        log(`[dry-run] Would execute: npm unpublish "${packageName}@${oldVer}" --force`);
      } else {
        try {
          runNpmInteractive(['unpublish', `${packageName}@${oldVer}`, '--force']);
          logSuccess(`Unpublished (deleted) ${packageName}@${oldVer}`);
        } catch (err) {
          logWarn(`Could not unpublish ${packageName}@${oldVer} (likely >72h old): falling back to deprecation.`);
        }
      }
    }
  }

  // 8. Automated deprecation of superseded versions (< newVersion)
  const deprecateSpec = `${packageName}@<${version}`;
  const deprecateMessage = `Superseded by ${packageName}@${version}. Please upgrade to latest.`;

  log(`Deprecating older versions: \x1b[33m${deprecateSpec}\x1b[0m...`);
  if (isDryRun) {
    log(`[dry-run] Would execute: npm deprecate "${deprecateSpec}" "${deprecateMessage}"`);
    log(`[dry-run] Would execute: npm deprecate "${packageName}@${version}" "" (ensure latest is clean)`);
  } else {
    try {
      runNpmInteractive(['deprecate', deprecateSpec, deprecateMessage]);
      logSuccess(`Deprecated all versions strictly below v${version}.`);
    } catch (err) {
      logWarn(`npm deprecate warning: ${err.message}`);
    }

    // Guard: guarantee that the new release is never marked deprecated
    try {
      runNpmInteractive(['deprecate', `${packageName}@${version}`, '']);
      logSuccess(`Guaranteed that ${packageName}@${version} is active and not deprecated.`);
    } catch (err) {
      // Ignored if already clean
    }
  }

  // 9. Post-release audit & verification
  log('Auditing registry state...');
  try {
    const latestTag = run(`pnpm view "${packageName}" dist-tags.latest`);
    const allVersionsRaw = run(`pnpm view "${packageName}" versions --json`);
    const allVersions = JSON.parse(allVersionsRaw);
    const latestDeprecate = run(`pnpm view "${packageName}@${version}" deprecated 2>/dev/null || true`);

    console.log('\n--------------------------------------------------------');
    console.log(`  Registry Audit for ${packageName}`);
    console.log('--------------------------------------------------------');
    console.log(`  Latest Tag:         ${latestTag === version ? `\x1b[32m${latestTag} (matches release)\x1b[0m` : `\x1b[33m${latestTag}\x1b[0m`}`);
    console.log(`  Latest Deprecated:  ${latestDeprecate ? `\x1b[31m${latestDeprecate}\x1b[0m` : `\x1b[32mClean (Not deprecated)\x1b[0m`}`);
    console.log(`  Active Versions:    ${allVersions.length} (${allVersions.join(', ')})`);
    console.log('--------------------------------------------------------\n');
  } catch (err) {
    logWarn(`Could not fetch post-release audit: ${err.message}`);
  }

  logSuccess(`Release process completed successfully!`);
}

main().catch((err) => {
  logError(`Release failed: ${err.message}`);
  process.exit(1);
});
