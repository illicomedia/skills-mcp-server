#!/usr/bin/env node

/**
 * Release workflow of @illicomedia/skills-mcp-server. See docs/operations/mcp-publish-process.md.
 *
 * A published version is permanent: this script never unpublishes, and never deprecates versions
 * in bulk. A release reaches users in two explicit steps:
 *  1. publish: build, test, smoke-test the packed tarball, publish under the `next` tag.
 *  2. promote: point `latest` at a published version. The same command rolls back.
 *
 * Usage (add --dry-run to preview):
 *  node scripts/release.mjs [--bump patch|minor|major]
 *  node scripts/release.mjs --promote <version>
 *  node scripts/release.mjs --deprecate <version> --message "<reason>. Use <version>."
 *  node scripts/release.mjs --smoke-only
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bumpVersion,
  nextDistTagAfterPromotion,
  parseReleaseArgs,
  smokeTestServer,
} from './release-lib.mjs';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_JSON_PATH = resolve(PKG_DIR, 'package.json');

function log(msg) {
  console.log(`\x1b[36m[release]\x1b[0m ℹ ${msg}`);
}

function logSuccess(msg) {
  console.log(`\x1b[32m[release]\x1b[0m ✔ ${msg}`);
}

function logError(msg) {
  console.error(`\x1b[31m[release]\x1b[0m ✖ ${msg}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: PKG_DIR, stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}

function runInteractive(cmd, cmdArgs, cwd = PKG_DIR) {
  const res = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: process.env });
  if (res.status !== 0) {
    throw new Error(`Command failed with exit code ${res.status}: ${cmd} ${cmdArgs.join(' ')}`);
  }
}

/**
 * Registry lifecycle commands (dist-tag, deprecate) go through the npm client: pnpm deprecate does not
 * support security-key 2FA ("Upgrade your client to npm@latest"). npm runs from the home directory:
 * devEngines rejects npm inside this repository.
 */
function runNpmInteractive(cmdArgs) {
  runInteractive('npm', cmdArgs, homedir());
}

function runNpmQuery(query) {
  return run(`npm ${query}`, { cwd: homedir() });
}

function registryState(packageName) {
  const raw = runNpmQuery(`view "${packageName}" versions dist-tags --json`);
  const state = JSON.parse(raw);
  return { versions: [state.versions].flat(), distTags: state['dist-tags'] ?? {} };
}

function requireLogin() {
  try {
    logSuccess(`Logged into npm as: ${runNpmQuery('whoami')}`);
  } catch {
    throw new Error('Not logged in to npm. Run `npm login` from your home directory first.');
  }
}

function requirePublished(packageName, version) {
  const { versions, distTags } = registryState(packageName);
  if (!versions.includes(version)) {
    throw new Error(
      `${packageName}@${version} is not published. Published: ${versions.join(', ')}`,
    );
  }
  return distTags;
}

/** Installs the tarball a user would download into an empty folder and talks to its binary. */
async function smokeTestTarball(pkg) {
  run('pnpm run build');
  const workDir = mkdtempSync(join(tmpdir(), 'fqa-release-'));
  try {
    const tarball = join(
      workDir,
      run(`pnpm pack --pack-destination "${workDir}" --json`).match(/[^/"]+\.tgz/)[0],
    );
    writeFileSync(join(workDir, 'package.json'), '{"private":true}\n', 'utf8');
    run(`npm install --no-audit --no-fund --ignore-scripts "${tarball}"`, { cwd: workDir });
    const binName = Object.keys(pkg.bin)[0];
    const { tools } = await smokeTestServer(
      join(workDir, 'node_modules', '.bin', binName),
      pkg.version,
    );
    logSuccess(`Packed tarball v${pkg.version} starts and exposes ${tools} tools.`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function publish(pkg, { dryRun, bump }) {
  const { name: packageName } = pkg;
  requireLogin();
  const { versions } = registryState(packageName);
  const version = bump ? bumpVersion(pkg.version, bump) : pkg.version;
  if (versions.includes(version)) {
    throw new Error(`v${version} is already published and npm never allows it again. Use --bump.`);
  }

  if (bump && dryRun) {
    log(`[dry-run] Would update package.json to v${version}`);
  } else if (bump) {
    pkg.version = version;
    writeFileSync(PKG_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    logSuccess(`Updated package.json to v${version}`);
  }

  log('Running build and test suite...');
  run('pnpm run build');
  run('pnpm test');
  logSuccess('All tests passed.');
  await smokeTestTarball(pkg);

  const publishArgs = ['publish', '--access', 'public', '--tag', 'next'];
  if (process.env.GITHUB_ACTIONS === 'true') {
    publishArgs.push('--provenance');
  }
  if (dryRun) {
    log(`[dry-run] Would execute: pnpm ${publishArgs.join(' ')}`);
    return;
  }
  runInteractive('pnpm', publishArgs);
  logSuccess(
    `Published ${packageName}@${version} under the \`next\` tag. \`latest\` did not move.`,
  );
  log(`Try it: npx -y ${packageName}@next`);
  log(`Then promote it: pnpm run mcp:release -- --promote ${version}`);
}

function promote({ name: packageName }, { dryRun, version }) {
  requireLogin();
  const distTags = requirePublished(packageName, version);
  const deprecated = runNpmQuery(`view "${packageName}@${version}" deprecated`);
  if (deprecated) {
    throw new Error(`${packageName}@${version} is deprecated: ${deprecated}`);
  }
  const commands = [['dist-tag', 'add', `${packageName}@${version}`, 'latest']];
  if (nextDistTagAfterPromotion(distTags, version)) {
    commands.push(['dist-tag', 'rm', packageName, 'next']);
  }
  for (const command of commands) {
    if (dryRun) {
      log(`[dry-run] Would execute: npm ${command.join(' ')}`);
    } else {
      runNpmInteractive(command);
    }
  }
  if (!dryRun) {
    logSuccess(`\`latest\` now points at v${version} (was v${distTags.latest}).`);
  }
}

function deprecate({ name: packageName }, { dryRun, version, message }) {
  requireLogin();
  const distTags = requirePublished(packageName, version);
  if (distTags.latest === version) {
    throw new Error(`v${version} is \`latest\`. Promote another version first.`);
  }
  const command = ['deprecate', `${packageName}@${version}`, message];
  if (dryRun) {
    log(`[dry-run] Would execute: npm ${command.join(' ')}`);
    return;
  }
  runNpmInteractive(command);
  logSuccess(`Deprecated ${packageName}@${version}.`);
}

async function main() {
  const options = parseReleaseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(PKG_JSON_PATH, 'utf8'));
  log(`${pkg.name} v${pkg.version}: ${options.action}${options.dryRun ? ' (dry-run)' : ''}`);

  if (options.action === 'smoke') {
    await smokeTestTarball(pkg);
  } else if (options.action === 'promote') {
    promote(pkg, options);
  } else if (options.action === 'deprecate') {
    deprecate(pkg, options);
  } else {
    await publish(pkg, options);
  }
}

main().catch((err) => {
  logError(`Release failed: ${err.message}`);
  process.exit(1);
});
