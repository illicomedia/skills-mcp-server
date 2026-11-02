#!/usr/bin/env node

/**
 * Release workflow of @illicomedia/skills-mcp-server. See docs/operations/mcp-publish-process.md.
 *
 * A published version is permanent: this script never unpublishes, and never deprecates versions
 * in bulk. A release reaches users in two explicit steps:
 *  1. publish: build, test, smoke-test the packed tarball, publish under the `next` tag.
 *  2. promote: point `latest` at a published version. The same command rolls back.
 *
 * --ship runs the whole release for one version: publish, install it back from the registry and
 * check it, promote it, then deprecate the version it replaces. It stops at the first failure.
 *
 * Usage (add --dry-run to preview):
 *  node scripts/release.mjs [--bump patch|minor|major]
 *  node scripts/release.mjs --promote <version>
 *  node scripts/release.mjs --deprecate <version> --message "<reason>. Use <version>."
 *  node scripts/release.mjs --ship [--bump patch|minor|major]
 *  node scripts/release.mjs --smoke-only
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  bumpVersion,
  changelogHasVersion,
  extractChangelogSection,
  nextDistTagAfterPromotion,
  parseReleaseArgs,
  smokeTestServer,
} from './release-lib.mjs';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_JSON_PATH = resolve(PKG_DIR, 'package.json');
const SNAPSHOT_PATH = resolve(PKG_DIR, '../../website/src/data/generated/catalog.snapshot.json');
const REGISTRY_ATTEMPTS = 30;
const REGISTRY_WAIT_MS = 10_000;

async function confirmStep(promptMessage, { yes = false, defaultYes = true } = {}) {
  if (yes || !process.stdin.isTTY) {
    return defaultYes;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = await rl.question(`\x1b[33m[release]\x1b[0m ? ${promptMessage} ${hint} `);
    const cleaned = answer.trim().toLowerCase();
    if (!cleaned) {
      return defaultYes;
    }
    return cleaned === 'y' || cleaned === 'yes' || cleaned === 'o' || cleaned === 'oui';
  } finally {
    rl.close();
  }
}

async function askOption(promptMessage, options) {
  if (!process.stdin.isTTY) {
    return options[0];
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\x1b[33m[release]\x1b[0m ? ${promptMessage} `);
    return answer.trim().toLowerCase();
  } finally {
    rl.close();
  }
}

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
  // npm 12 wraps the answer in an array.
  const [state] = [JSON.parse(raw)].flat();
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

/** The website shows the MCP version from this tracked snapshot when in monorepo. */
function syncWebsiteSnapshot(version) {
  if (!existsSync(SNAPSHOT_PATH)) {
    return;
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  snapshot.mcpServer.version = version;
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/** Ensures an annotated git tag exists for the release version. */
function ensureGitTag(version, { dryRun = false } = {}) {
  const tagName = `v${version}`;
  let tagExists = false;
  try {
    tagExists = Boolean(run(`git tag -l "${tagName}"`));
  } catch {
    return;
  }
  if (tagExists) {
    log(`Git tag ${tagName} already exists.`);
    return;
  }
  if (dryRun) {
    log(`[dry-run] Would create git tag ${tagName}`);
    return;
  }
  run(`git tag -a "${tagName}" -m "chore(mcp): release ${version}"`);
  logSuccess(`Created annotated git tag ${tagName}.`);
  log(`Push tag to remote: git push origin ${tagName}`);
}

/** pnpm refuses to publish a dirty tree: better to say so before anything changes. */
function requireCleanTree() {
  const changes = run('git status --porcelain');
  if (changes) {
    throw new Error(`Commit or discard these changes first:\n${changes}`);
  }
}

function requireChangelog(version) {
  if (!changelogHasVersion(readFileSync(resolve(PKG_DIR, 'CHANGELOG.md'), 'utf8'), version)) {
    throw new Error(`CHANGELOG.md has no "## ${version} - <date>" section.`);
  }
}

/** Installs the published version as a user would. A new version can take a moment to appear. */
async function verifyFromRegistry(pkg, version, { yes = false } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), 'fqa-registry-'));
  try {
    writeFileSync(join(workDir, 'package.json'), '{"private":true}\n', 'utf8');
    for (let attempt = 1; attempt <= REGISTRY_ATTEMPTS; attempt += 1) {
      try {
        run(`npm install --no-audit --no-fund --ignore-scripts "${pkg.name}@${version}"`, {
          cwd: workDir,
        });
        break;
      } catch (error) {
        if (attempt === REGISTRY_ATTEMPTS) {
          logError(`v${version} installation timed out after ${REGISTRY_ATTEMPTS} attempts.`);
          const proceed = await confirmStep(
            `v${version} is not yet answering on local CDN cache. Skip verification and proceed to promote?`,
            { yes, defaultYes: false },
          );
          if (proceed) {
            logSuccess('Skipping registry install verification upon user confirmation.');
            return;
          }
          throw error;
        }
        if (attempt === 12 && process.stdin.isTTY && !yes) {
          const action = await askOption(
            `v${version} is taking time to replicate on npm CDN. [W]ait, [S]kip verification, or [A]bort? (W/s/a):`,
            ['w', 's', 'a'],
          );
          if (action === 's') {
            logSuccess('Skipping registry install verification upon user confirmation.');
            return;
          }
          if (action === 'a') {
            throw new Error('Verification aborted by user.');
          }
        }
        log(`v${version} is not installable yet, waiting (${attempt}/${REGISTRY_ATTEMPTS})...`);
        await sleep(REGISTRY_WAIT_MS);
      }
    }
    const binName = Object.keys(pkg.bin)[0];
    const binPath = join(workDir, 'node_modules', '.bin', binName);
    const { tools } = await smokeTestServer(binPath, version);
    logSuccess(`Published v${version} installs from the registry and exposes ${tools} tools.`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function ship(pkg, options) {
  const { dryRun, bump, yes = false } = options;
  const { name: packageName } = pkg;
  requireLogin();
  const version = bump ? bumpVersion(pkg.version, bump) : pkg.version;
  requireChangelog(version);
  if (!dryRun && pkg.version !== version) {
    requireCleanTree();
  }
  const previous = registryState(packageName).distTags.latest;

  log(`\n\x1b[1m=== Release Plan for ${packageName} ===\x1b[0m`);
  log(`  Target Version:  v${version} (${bump ?? 'current'})`);
  log(`  Previous Latest: v${previous}`);
  log(`  Mode:            ${dryRun ? 'DRY-RUN (preview only)' : 'LIVE EXECUTION'}`);
  log('=========================================\n');

  if (!dryRun) {
    const proceed = await confirmStep(`Proceed with shipping v${version}?`, {
      yes,
      defaultYes: true,
    });
    if (!proceed) {
      log('Release aborted by user.');
      return;
    }
  }

  await publish(pkg, { dryRun, bump, commitBump: true, yes });
  if (dryRun) {
    log(`[dry-run] Would verify v${version}, promote it, deprecate v${previous}.`);
    return;
  }
  await verifyFromRegistry(pkg, version, { yes });
  promote(pkg, { dryRun, version });

  // Deprecate previous version
  if (previous && previous !== version) {
    if (runNpmQuery(`view "${packageName}@${previous}" deprecated`)) {
      log(`v${previous} is already deprecated.`);
    } else {
      const message = `Superseded by ${version}. Use ${version}.`;
      deprecate(pkg, { dryRun, version: previous, message });
    }

    const deprecateOlder = await confirmStep(
      `Would you like to also deprecate all older versions (< ${version}) to point to ${version}?`,
      { yes, defaultYes: true },
    );
    if (deprecateOlder) {
      runNpmInteractive([
        'deprecate',
        `${packageName}@<${version}`,
        `Superseded by ${version}. Use ${version}.`,
      ]);
      logSuccess(`Deprecated all versions < ${version}.`);
    }
  }

  // Push commit and tags to origin
  const pushGit = await confirmStep(
    `Push release commit and git tag v${version} to remote origin?`,
    { yes, defaultYes: true },
  );
  if (pushGit) {
    log('Pushing main and tags to remote origin...');
    runInteractive('git', ['push', 'origin', 'main', '--tags'], PKG_DIR);
    logSuccess('Pushed commits and tags to origin.');
  }

  logSuccess(`\n🚀 Successfully released and finalized v${version}!\n`);
}

async function publish(pkg, { dryRun, bump, commitBump = false }) {
  const { name: packageName } = pkg;
  requireLogin();
  const { versions, distTags } = registryState(packageName);
  const version = bump ? bumpVersion(pkg.version, bump) : pkg.version;

  if (versions.includes(version)) {
    if (distTags.next === version) {
      logSuccess(
        `v${version} is already published under the \`next\` dist-tag. Resuming release process...`,
      );
      return;
    }
    if (distTags.latest === version) {
      logSuccess(`v${version} is already published and promoted as \`latest\`.`);
      return;
    }
    throw new Error(`v${version} is already published and npm never allows it again. Use --bump.`);
  }

  if (bump && dryRun) {
    log(`[dry-run] Would update package.json to v${version}`);
  } else if (bump) {
    pkg.version = version;
    writeFileSync(PKG_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    syncWebsiteSnapshot(version);
    logSuccess(
      existsSync(SNAPSHOT_PATH)
        ? `Updated package.json and the website snapshot to v${version}`
        : `Updated package.json to v${version}`,
    );
  }

  log('Running build and test suite...');
  run('pnpm run build');
  run('pnpm test');
  logSuccess('All tests passed.');
  await smokeTestTarball(pkg);

  if (commitBump && bump && !dryRun) {
    const filesToStage = ['package.json'];
    if (existsSync(SNAPSHOT_PATH)) {
      filesToStage.push(`"${SNAPSHOT_PATH}"`);
    }
    const changelogText = readFileSync(resolve(PKG_DIR, 'CHANGELOG.md'), 'utf8');
    const summary = extractChangelogSection(changelogText, version);
    const commitMsg = summary
      ? `chore(mcp): release ${version}\n\n${summary}`
      : `chore(mcp): release ${version}`;
    run(`git add ${filesToStage.join(' ')}`);
    runInteractive('git', ['commit', '-m', commitMsg], PKG_DIR);
  }

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
  log(`Then promote it: pnpm run release -- --promote ${version}`);
}

function promote({ name: packageName }, { dryRun, version }) {
  requireLogin();
  const distTags = requirePublished(packageName, version);
  const deprecated = runNpmQuery(`view "${packageName}@${version}" deprecated`);
  if (deprecated) {
    throw new Error(`${packageName}@${version} is deprecated: ${deprecated}`);
  }
  if (distTags.latest === version) {
    logSuccess(`\`latest\` already points at v${version}.`);
    ensureGitTag(version, { dryRun });
    return;
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
  ensureGitTag(version, { dryRun });
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

  if (options.action === 'ship') {
    await ship(pkg, options);
  } else if (options.action === 'smoke') {
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
