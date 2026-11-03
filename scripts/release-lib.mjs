/**
 * Pure helpers of the release workflow (scripts/release.mjs), kept apart so they can be tested
 * without touching git or the npm registry.
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const BUMPS = ['patch', 'minor', 'major'];
const FLAGS_WITH_VALUE = [
  '--bump',
  '--promote',
  '--deprecate',
  '--message',
  '--tarball',
  '--check-tag',
  '--release-notes',
];
const FLAGS = ['--dry-run', '--smoke-only', '--ship', '--yes', '-y'];
const ACTIONS = [
  '--ship',
  '--promote',
  '--deprecate',
  '--smoke-only',
  '--check-tag',
  '--release-notes',
];
const DEFAULT_SMOKE_TIMEOUT_MS = 10_000;
const UNRELEASED_HEADING = /^## \[?Unreleased\]?\s*$/i;

/** MCP protocol revision the smoke test announces as a client. */
export const SMOKE_PROTOCOL_VERSION = '2024-11-05';

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

function requireValue(flags, flag, hint) {
  const value = flags.get(flag);
  if (!value) {
    throw new Error(`${flag} expects ${hint}`);
  }
  return value;
}

/** Turns the command line into one release action; anything unknown or ambiguous throws. */
export function parseReleaseArgs(argv) {
  const flags = readFlags(argv);
  const dryRun = flags.has('--dry-run');
  const yes = flags.has('--yes') || flags.has('-y');
  const actions = ACTIONS.filter((flag) => flags.has(flag));
  if (actions.length > 1) {
    throw new Error(`Choose one action, got: ${actions.join(', ')}`);
  }
  const [action = 'prepare'] = actions;
  if (flags.has('--bump') && !['prepare', '--ship'].includes(action)) {
    throw new Error('--bump only applies to a prepare or --ship');
  }
  if (flags.has('--message') && action !== '--deprecate') {
    throw new Error('--message only applies to --deprecate');
  }
  if (flags.has('--tarball') && action !== '--smoke-only') {
    throw new Error('--tarball only applies to --smoke-only');
  }
  const base = { dryRun, yes };
  switch (action) {
    case '--ship':
      return { action: 'ship', ...base, bump: bumpOf(flags) };
    case '--promote':
      return { action: 'promote', ...base, version: exactVersion(action, flags.get(action)) };
    case '--deprecate': {
      const version = exactVersion(action, flags.get(action));
      const message = requireValue(flags, '--message', '"<reason>. Use <version>."');
      return { action: 'deprecate', ...base, version, message };
    }
    case '--smoke-only':
      return { action: 'smoke', ...base, tarball: flags.get('--tarball') ?? null };
    case '--check-tag':
      return {
        action: 'check-tag',
        ...base,
        tag: requireValue(flags, action, 'a tag such as v1.5.0'),
      };
    case '--release-notes':
      if (!SEMVER.test(flags.get(action))) {
        throw new Error(`${action} expects a version such as 1.5.0 or 2.0.0-rc.1`);
      }
      return { action: 'release-notes', ...base, version: flags.get(action) };
    default:
      return { action: 'prepare', ...base, bump: bumpOf(flags) };
  }
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

/** The git tag a version is released under. CI refuses to publish when they disagree. */
export function tagForVersion(version) {
  return `v${version}`;
}

/** Throws unless `tag` is exactly the tag of `version` (refs/tags/ prefix tolerated). */
export function checkTagMatchesVersion(tag, version) {
  const name = tag.replace(/^refs\/tags\//, '');
  if (name !== tagForVersion(version)) {
    throw new Error(`Tag ${name} does not match package.json version ${version}`);
  }
  return name;
}

function isVersionHeading(line, version) {
  return line.startsWith(`## ${version} `) || line.startsWith(`## [${version}]`);
}

/** A release must say what changed before it can ship: `## 1.5.0 - <date>` or `## [1.5.0]`. */
export function changelogHasVersion(changelog, version) {
  return changelog.split('\n').some((line) => isVersionHeading(line, version));
}

function sectionAfter(lines, startIndex) {
  const sectionLines = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      break;
    }
    sectionLines.push(lines[i]);
  }
  return sectionLines.join('\n').trim();
}

/** Extracts the markdown section for a release version from CHANGELOG.md. */
export function extractChangelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const startIndex = lines.findIndex((line) => isVersionHeading(line, version));
  return startIndex === -1 ? '' : sectionAfter(lines, startIndex);
}

/**
 * Turns the `## Unreleased` section into `## <version> - <date>` and opens a fresh empty
 * `## Unreleased` above it. Returns the changelog unchanged when the version already has its
 * section; throws when there is neither a version section nor unreleased notes to stamp.
 */
export function stampChangelog(changelog, version, date) {
  if (changelogHasVersion(changelog, version)) {
    return changelog;
  }
  const lines = changelog.split('\n');
  const index = lines.findIndex((line) => UNRELEASED_HEADING.test(line));
  if (index === -1 || !sectionAfter(lines, index)) {
    throw new Error(
      `CHANGELOG.md has no "## ${version} - <date>" section and no notes under "## Unreleased".`,
    );
  }
  lines.splice(index, 1, '## Unreleased', '', `## ${version} - ${date}`);
  return lines.join('\n');
}

/** "owner/repo" of the GitHub repository in package.json, or null when it is not on GitHub. */
export function githubRepoSlug(repository) {
  const url = typeof repository === 'string' ? repository : (repository?.url ?? '');
  return /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
}

const GREEN = ['success', 'skipped', 'neutral'];

/**
 * Why the GitHub checks of a commit do not allow a release, or null when every check has
 * finished green. `checkRuns` is the answer of GET /repos/{slug}/commits/{sha}/check-runs.
 */
export function ciProblem(checkRuns) {
  const runs = checkRuns?.check_runs ?? [];
  if (runs.length === 0) {
    return 'GitHub reports no CI checks for this commit yet.';
  }
  const pending = runs.filter((run) => run.status !== 'completed').map((run) => run.name);
  if (pending.length > 0) {
    return `CI is still running: ${pending.join(', ')}.`;
  }
  const failed = runs.filter((run) => !GREEN.includes(run.conclusion));
  if (failed.length > 0) {
    return `CI is not green: ${failed.map((run) => `${run.name} (${run.conclusion})`).join(', ')}.`;
  }
  return null;
}

/** True when the `next` tag still points at the version that has just become `latest`. */
export function nextDistTagAfterPromotion(distTags, promotedVersion) {
  return distTags.next === promotedVersion;
}

/** npm 12 wraps `npm view --json` answers in an array; older clients do not. */
export function parseRegistryState(raw) {
  const [state] = [JSON.parse(raw)].flat();
  return { versions: [state.versions].flat(), distTags: state['dist-tags'] ?? {} };
}

/**
 * Starts a built server and runs a real MCP stdio session: initialize, the initialized
 * notification, tools/list, then tools/call get_version. Resolves with the number of tools;
 * rejects when the server crashes, stays silent, speaks no protocol version, reports another
 * version or exposes no tools.
 */
export function smokeTestServer(
  command,
  expectedVersion,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
  args = [],
) {
  return new Promise((resolve, reject) => {
    const server = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = [];
    let settled = false;
    let tools = 0;

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

    const send = (message) => {
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    };

    const timer = setTimeout(
      () => finish(new Error(`Server gave no answer within ${timeoutMs} ms`)),
      timeoutMs,
    );

    const onInitialize = (result) => {
      if (typeof result?.protocolVersion !== 'string') {
        return finish(new Error('Server answered initialize without a protocolVersion'));
      }
      const version = result.serverInfo?.version;
      if (version !== expectedVersion) {
        return finish(new Error(`Server reports version ${version}, expected ${expectedVersion}`));
      }
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/list', params: {} });
    };

    const onToolsList = (result) => {
      tools = (result?.tools ?? []).length;
      if (tools === 0) {
        return finish(new Error('Server exposes no tools'));
      }
      send({ id: 3, method: 'tools/call', params: { name: 'get_version', arguments: {} } });
    };

    const onGetVersion = (result) => {
      const text = result?.content?.[0]?.text ?? '';
      if (result?.isError || !text.includes(`"version": "${expectedVersion}"`)) {
        return finish(new Error(`tools/call get_version failed: ${text}`));
      }
      finish(null, { tools });
    };

    const handlers = { 1: onInitialize, 2: onToolsList, 3: onGetVersion };

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
      handlers[message.id]?.(message.result);
    });

    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: SMOKE_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'release-smoke-test', version: expectedVersion },
      },
    });
  });
}
