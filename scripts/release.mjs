#!/usr/bin/env node

/**
 * Release command line of @illicomedia/skills-mcp-server. See docs/operations/mcp-publish-process.md.
 *
 * CI publishes (release.yml on a v* tag, npm Trusted Publishing, under `next`). This command
 * prepares releases and moves `latest`; it never publishes, never unpublishes, and never
 * deprecates in bulk. Steps that change shared state ask first, and fail closed without a
 * terminal unless --yes is given.
 *
 * Usage (add --dry-run to preview):
 *  pnpm release [--bump patch|minor|major]           prepare: gates, commit, tag, push
 *  pnpm release --ship [--bump patch|minor|major]    prepare, wait for CI, verify, promote
 *  pnpm release --promote <version>                  verify from npm, move `latest` (rollback too)
 *  pnpm release --deprecate <version> --message "<reason>. Use <version>."
 *  pnpm release --smoke-only [--tarball-dir <dir>]  pack (or take) a tarball and smoke-test it
 *  pnpm release --rehearse --tarball-dir <dir>       CI, every push: the release path, staging dry-run
 *  pnpm release --expect-refusal --tarball-dir <dir> CI, Node 18/20: the installed package must refuse
 *  pnpm release --check-tag <tag>                    CI: the tag must match package.json; prints outputs
 *  pnpm release --stage --tarball-dir <dir>          CI release: stage the tarball on npm under next
 *  pnpm release --github-release <tag> --tarball-dir <dir>  CI release: the GitHub Release
 *  pnpm release --release-notes <version>            CI: print that version's changelog section
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  deprecate,
  expectRefusal,
  githubRelease,
  prepare,
  promote,
  rehearse,
  ship,
  smoke,
  stage,
} from './release-flow.mjs';
import {
  ciTagOutputs,
  expectServerRefusal,
  extractChangelogSection,
  parseReleaseArgs,
  smokeTestServer,
} from './release-lib.mjs';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const color = (code, symbol) => (msg) =>
  console.error(`\x1b[${code}m[release]\x1b[0m ${symbol} ${msg}`);

/** Runs a command without a shell (arguments are never re-parsed); throws on a non-zero exit. */
function sh(command, args, { cwd = PKG_DIR, interactive = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: interactive ? 'inherit' : 'pipe',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})\n${detail}`);
  }
  return (result.stdout ?? '').trim();
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`\x1b[33m[release]\x1b[0m ? ${question} [y/N] `)).trim();
    return /^(y|yes|o|oui)$/i.test(answer);
  } finally {
    rl.close();
  }
}

/** The installed package's bin entry, started through node so it works the same on every OS. */
function installedEntry(installDir) {
  const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
  const installed = join(installDir, 'node_modules', ...pkg.name.split('/'));
  const { bin } = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  return join(installed, Object.values(bin)[0]);
}

function smokeServer(installDir, version) {
  return smokeTestServer(process.execPath, version, undefined, [installedEntry(installDir)]);
}

function refusingServer(installDir) {
  return expectServerRefusal(process.execPath, undefined, [installedEntry(installDir)]);
}

/** Reads a public GitHub API answer (a GITHUB_TOKEN in the environment raises the rate limit). */
async function fetchJson(url) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'skills-mcp-server-release',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

const ctx = {
  pkgDir: PKG_DIR,
  fetchJson,
  interactive: Boolean(process.stdin.isTTY),
  sh,
  confirm,
  smokeServer,
  refusingServer,
  sleep,
  log: color(36, 'i'),
  ok: color(32, '✔'),
  warn: color(33, '!'),
  join,
  resolve,
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => writeFileSync(path, text, 'utf8'),
  listDir: (path) => readdirSync(path),
  copy: (from, to) => cpSync(from, to, { recursive: true }),
  /** The GitHub job summary when running in Actions, the log otherwise. */
  summary: (markdown) =>
    process.env.GITHUB_STEP_SUMMARY
      ? appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
      : console.error(markdown),
  env: {
    GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT,
  },
  makeTempDir: () => mkdtempSync(join(tmpdir(), 'fqa-release-')),
  removeDir: (path) => rmSync(path, { recursive: true, force: true }),
  today: () => new Date().toISOString().slice(0, 10),
};

async function main() {
  const options = parseReleaseArgs(process.argv.slice(2));
  const pkg = JSON.parse(ctx.readFile(join(PKG_DIR, 'package.json')));
  switch (options.action) {
    case 'check-tag':
      // stdout is the GitHub step output (ref, name, version); the log goes to stderr.
      process.stdout.write(ciTagOutputs(options.tag, pkg));
      ctx.ok(`Tag ${options.tag} matches package.json.`);
      return;
    case 'expect-refusal':
      await expectRefusal(ctx, pkg, options);
      return;
    case 'stage':
      stage(ctx, pkg, options);
      return;
    case 'rehearse':
      rehearse(ctx, pkg, options);
      return;
    case 'github-release':
      githubRelease(ctx, pkg, options);
      return;
    case 'release-notes':
      process.stdout.write(
        `${extractChangelogSection(ctx.readFile(join(PKG_DIR, 'CHANGELOG.md')), options.version)}\n`,
      );
      return;
    case 'smoke':
      await smoke(ctx, pkg, options);
      return;
    case 'promote':
      await promote(ctx, pkg, options);
      return;
    case 'deprecate':
      await deprecate(ctx, pkg, options);
      return;
    case 'ship':
      await ship(ctx, pkg, options);
      return;
    default:
      await prepare(ctx, pkg, options);
  }
}

main().catch((err) => {
  color(31, '✖')(`Release failed: ${err.message}`);
  process.exit(1);
});
