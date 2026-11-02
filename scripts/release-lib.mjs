/**
 * Pure helpers of the release workflow (scripts/release.mjs), kept apart so they can be tested
 * without touching the npm registry.
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const BUMPS = ['patch', 'minor', 'major'];
const FLAGS_WITH_VALUE = ['--bump', '--promote', '--deprecate', '--message'];
const FLAGS = ['--dry-run', '--smoke-only', '--ship'];
const DEFAULT_SMOKE_TIMEOUT_MS = 10_000;

function readFlags(argv) {
  const flags = new Map();
  const items = argv.filter((item) => item !== '--');
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (FLAGS.includes(item)) {
      flags.set(item, true);
    } else if (FLAGS_WITH_VALUE.includes(item)) {
      index += 1;
      flags.set(item, items[index] ?? '');
    } else {
      throw new Error(`Unknown option: ${item}`);
    }
  }
  return flags;
}

function exactVersion(flag, value) {
  if (!EXACT_VERSION.test(value)) {
    throw new Error(`${flag} expects an exact version such as 1.5.0`);
  }
  return value;
}

function bumpOf(flags) {
  const bump = flags.get('--bump') ?? null;
  if (bump !== null && !BUMPS.includes(bump)) {
    throw new Error(`--bump expects one of ${BUMPS.join(', ')}`);
  }
  return bump;
}

/** Turns the command line into one release action; anything unknown or ambiguous throws. */
export function parseReleaseArgs(argv) {
  const flags = readFlags(argv);
  const dryRun = flags.has('--dry-run');
  const actions = ['--ship', '--promote', '--deprecate', '--smoke-only'].filter((flag) =>
    flags.has(flag),
  );
  if (actions.length > 1) {
    throw new Error(`Choose one action, got: ${actions.join(', ')}`);
  }
  if (actions.length === 1 && actions[0] !== '--ship' && flags.has('--bump')) {
    throw new Error('--bump only applies to a publish');
  }
  if (flags.has('--message') && !flags.has('--deprecate')) {
    throw new Error('--message only applies to --deprecate');
  }
  if (flags.has('--ship')) {
    return { action: 'ship', dryRun, bump: bumpOf(flags) };
  }
  if (flags.has('--promote')) {
    return {
      action: 'promote',
      dryRun,
      version: exactVersion('--promote', flags.get('--promote')),
    };
  }
  if (flags.has('--deprecate')) {
    const version = exactVersion('--deprecate', flags.get('--deprecate'));
    const message = flags.get('--message');
    if (!message) {
      throw new Error('--deprecate needs --message "<reason>. Use <version>."');
    }
    return { action: 'deprecate', dryRun, version, message };
  }
  if (flags.has('--smoke-only')) {
    return { action: 'smoke', dryRun };
  }
  return { action: 'publish', dryRun, bump: bumpOf(flags) };
}

export function bumpVersion(currentVersion, type) {
  if (!EXACT_VERSION.test(currentVersion)) {
    throw new Error(`Cannot parse semantic version: ${currentVersion}`);
  }
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  if (type === 'major') {
    return `${major + 1}.0.0`;
  }
  if (type === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

/** True when the `next` tag still points at the version that has just become `latest`. */
/** A release must say what changed before it can ship. */
export function changelogHasVersion(changelog, version) {
  return changelog.split('\n').some((line) => line.startsWith(`## ${version} `));
}

/** Extracts the markdown section for a release version from CHANGELOG.md. */
export function extractChangelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const startIndex = lines.findIndex((line) => line.startsWith(`## ${version} `));
  if (startIndex === -1) {
    return '';
  }
  const sectionLines = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      break;
    }
    sectionLines.push(lines[i]);
  }
  return sectionLines.join('\n').trim();
}

export function nextDistTagAfterPromotion(distTags, promotedVersion) {
  return distTags.next === promotedVersion;
}

/**
 * Starts a built server and runs a real stdio exchange (initialize, then tools/list). Resolves
 * with the number of tools; rejects when the server crashes, stays silent, reports another
 * version or exposes no tools.
 */
export function smokeTestServer(binPath, expectedVersion, timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const server = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = [];
    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.kill();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const send = (id, method) => {
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: {} })}\n`);
    };

    const timer = setTimeout(
      () => finish(new Error(`Server gave no answer within ${timeoutMs} ms`)),
      timeoutMs,
    );

    server.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    server.stdin.on('error', finish);
    server.on('error', (error) => finish(error));
    server.on('exit', (code) =>
      finish(new Error(`Server exited early with code ${code}: ${stderr.join('').trim()}`)),
    );

    readline.createInterface({ input: server.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        const version = message.result?.serverInfo?.version;
        if (version !== expectedVersion) {
          finish(new Error(`Server reports version ${version}, expected ${expectedVersion}`));
          return;
        }
        send(2, 'tools/list');
      } else if (message.id === 2) {
        const tools = message.result?.tools ?? [];
        if (tools.length === 0) {
          finish(new Error('Server exposes no tools'));
          return;
        }
        finish(null, { tools: tools.length });
      }
    });

    send(1, 'initialize');
  });
}
