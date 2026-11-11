/**
 * Pure helpers of the release workflow (scripts/release.mjs), kept apart so they can be tested
 * without touching git or the npm registry.
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { parseArgs } from 'node:util';

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const BUMPS = ['patch', 'minor', 'major', 'prerelease', 'release'];
const PREID = /^[a-z]+$/;
const DEFAULT_SMOKE_TIMEOUT_MS = 10_000;
const UNRELEASED_HEADING = /^## \[?Unreleased\]?\s*$/i;

/** MCP protocol revision the smoke test announces as a client. */
export const SMOKE_PROTOCOL_VERSION = '2024-11-05';

/** npm needs this version for Trusted Publishing (OIDC) and `npm stage publish`. */
export const MIN_NPM_FOR_STAGING = '11.5.1';

/** What each value option expects, for the error when it is missing or wrong. */
const VALUE_OPTIONS = {
  bump: `one of ${BUMPS.join(', ')}`,
  approve: 'a version such as 3.0.0 or 3.0.0-rc.1',
  preid: 'lowercase letters, such as rc',
  promote: 'an exact version such as 1.5.0',
  deprecate: 'an exact version such as 1.5.0',
  undeprecate: 'an exact version such as 1.5.0',
  message: '"<cause>. Upgrade to <package>@<range> (<prerequisites>)."',
  'tarball-dir': 'a folder holding one .tgz',
  'check-tag': 'a tag such as v1.5.0',
  'release-notes': 'a version such as 1.5.0 or 2.0.0-rc.1',
  'github-release': 'a tag such as v1.5.0',
};
const SWITCHES = ['dry-run', 'with-listing', 'publish-listing', 'smoke-only', 'expect-refusal'];
const OPTIONS = {
  ...Object.fromEntries(Object.keys(VALUE_OPTIONS).map((name) => [name, { type: 'string' }])),
  ...Object.fromEntries(
    [...SWITCHES, 'ship', 'stage', 'rehearse'].map((name) => [name, { type: 'boolean' }]),
  ),
  yes: { type: 'boolean', short: 'y' },
};

/**
 * The actions, one per command line: the name they run as, what their own value must be
 * (exact version, any version, a tag), and whether they need a tarball folder.
 */
const ACTIONS = {
  ship: { as: 'ship' },
  approve: { as: 'approve', value: SEMVER },
  promote: { as: 'promote', value: EXACT_VERSION },
  deprecate: { as: 'deprecate', value: EXACT_VERSION },
  undeprecate: { as: 'undeprecate', value: EXACT_VERSION },
  'publish-listing': { as: 'publish-listing' },
  'smoke-only': { as: 'smoke', tarball: 'optional' },
  'expect-refusal': { as: 'expect-refusal', tarball: 'required' },
  stage: { as: 'stage', tarball: 'required' },
  rehearse: { as: 'rehearse', tarball: 'required' },
  'github-release': { as: 'github-release', value: /./, key: 'tag', tarball: 'required' },
  'check-tag': { as: 'check-tag', value: /./, key: 'tag' },
  'release-notes': { as: 'release-notes', value: SEMVER },
};
const TARBALL_ACTIONS = Object.keys(ACTIONS).filter((name) => ACTIONS[name].tarball);

/** Options that only some actions take: who takes them, as said in the error. */
const ONLY = {
  bump: [['prepare', 'ship'], 'a prepare or --ship'],
  'with-listing': [['promote', 'ship'], '--promote or --ship'],
  message: [['deprecate'], '--deprecate'],
  'tarball-dir': [TARBALL_ACTIONS, TARBALL_ACTIONS.map((name) => `--${name}`).join(', ')],
};

const expects = (name) => new Error(`--${name} expects ${VALUE_OPTIONS[name]}`);

/** node:util parseArgs, with this tool's error messages. */
function readOptions(argv) {
  let parsed;
  try {
    const args = argv.filter((item) => item !== '--');
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    // parseArgs quotes what it rejects: '--name', '-y, --yes' or '--name <value>'.
    const quoted = error.message.split("'")[1].split(/[ ,]+/);
    const flag = quoted.find((part) => part.startsWith('--')) ?? quoted[0];
    if (error.code !== 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      throw new Error(`Unknown option: ${flag}`);
    }
    const name = flag.slice(2);
    throw name in VALUE_OPTIONS ? expects(name) : new Error(`${flag} takes no value`);
  }
  if (parsed.positionals.length > 0) {
    throw new Error(`Unknown option: ${parsed.positionals[0]}`);
  }
  return parsed.values;
}

function checkCombinations(values, action) {
  for (const [name, [actions, where]] of Object.entries(ONLY)) {
    if (values[name] !== undefined && !actions.includes(action)) {
      throw new Error(`--${name} only applies to ${where}`);
    }
  }
  if (values.preid !== undefined) {
    if (!['patch', 'minor', 'major'].includes(values.bump)) {
      throw new Error('--preid only applies with --bump patch, minor or major');
    }
    if (!PREID.test(values.preid)) {
      throw expects('preid');
    }
  }
  if (values.bump !== undefined && !BUMPS.includes(values.bump)) {
    throw expects('bump');
  }
}

/** Turns the command line into one release action; anything unknown or ambiguous throws. */
export function parseReleaseArgs(argv) {
  const values = readOptions(argv);
  const given = Object.keys(ACTIONS).filter((name) => values[name] !== undefined);
  if (given.length > 1) {
    throw new Error(`Choose one action, got: ${given.map((name) => `--${name}`).join(', ')}`);
  }
  // No action: a release with --bump, else the read-only status (cutting is always explicit).
  const name = given[0] ?? (values.bump === undefined ? 'status' : 'prepare');
  checkCombinations(values, name);
  const spec = ACTIONS[name] ?? { as: name };
  const result = { action: spec.as, dryRun: Boolean(values['dry-run']), yes: Boolean(values.yes) };
  if (spec.value) {
    if (!spec.value.test(values[name])) {
      throw expects(name);
    }
    result[spec.key ?? 'version'] = values[name];
  }
  if (name === 'prepare' || name === 'ship') {
    result.bump = values.bump ?? null;
    Object.assign(result, values.preid === undefined ? {} : { preid: values.preid });
  }
  if (name === 'deprecate') {
    if (!values.message) {
      throw expects('message');
    }
    result.message = values.message;
  }
  if (spec.tarball === 'required' && !values['tarball-dir']) {
    throw expects('tarball-dir');
  }
  if (spec.tarball) {
    result.tarballDir = values['tarball-dir'] ?? null;
  }
  return values['with-listing'] ? { ...result, withListing: true } : result;
}

/** True when `version` (x.y.z, optionally with a pre-release) is at least `minimum` (x.y.z). */
export function versionAtLeast(version, minimum) {
  const parts = (value) => value.split('-')[0].split('.').map(Number);
  const [a, b] = [parts(version), parts(minimum)];
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return true;
}

/** The file name `pnpm pack` / `npm pack` gives a package: @scope/name 1.2.3 -> scope-name-1.2.3.tgz */
export function tarballFileName(name, version) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

/** The GitHub step outputs the release workflow needs, after checking the tag. */
export function ciTagOutputs(tag, pkg) {
  const name = checkTagMatchesVersion(tag, pkg.version);
  return `ref=refs/tags/${name}\nname=${pkg.name}\nversion=${pkg.version}\n`;
}

/**
 * The next version. patch / minor / major from a stable x.y.z, optionally as a first release
 * candidate (`preid` "rc": 3.0.0-rc.0); `prerelease` moves to the next candidate (rc.0 -> rc.1);
 * `release` turns a candidate into its final version (3.0.0-rc.1 -> 3.0.0).
 */
export function bumpVersion(currentVersion, type, preid = null) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(currentVersion);
  if (!match) {
    throw new Error(`Cannot parse semantic version: ${currentVersion}`);
  }
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  const [candidateId, candidate] = [match[4], Number(match[5])];
  if (type === 'prerelease' || type === 'release') {
    if (!candidateId) {
      throw new Error(`${currentVersion} is not a release candidate; --bump ${type} needs one.`);
    }
    const base = `${major}.${minor}.${patch}`;
    return type === 'release' ? base : `${base}-${candidateId}.${candidate + 1}`;
  }
  if (candidateId) {
    throw new Error(
      `${currentVersion} is a release candidate: use --bump prerelease or --bump release.`,
    );
  }
  const next =
    type === 'major'
      ? `${major + 1}.0.0`
      : type === 'minor'
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;
  return preid ? `${next}-${preid}.0` : next;
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

/**
 * What waits under `## Unreleased`: its `###` headings, the number of entries, and the bump they
 * call for (Breaking: major; Added or Changed: minor; anything else: patch; nothing: null).
 */
export function unreleasedSummary(changelog) {
  const lines = changelog.split('\n');
  const index = lines.findIndex((line) => UNRELEASED_HEADING.test(line));
  const section = index === -1 ? [] : sectionAfter(lines, index).split('\n');
  const headings = section
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(4).trim());
  const entries = section.filter((line) => line.startsWith('- ')).length;
  let bump = null;
  if (entries > 0) {
    bump = 'patch';
    if (headings.some((heading) => /^(added|changed)$/i.test(heading))) {
      bump = 'minor';
    }
    if (headings.some((heading) => /^breaking$/i.test(heading))) {
      bump = 'major';
    }
  }
  return { headings, entries, bump };
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
  if (version.includes('-')) {
    // A release candidate copies the notes: they stay under Unreleased for the final version.
    let end = index + 1;
    while (end < lines.length && !lines[end].startsWith('## ')) {
      end += 1;
    }
    const notes = sectionAfter(lines, index);
    lines.splice(end, 0, `## ${version} - ${date}`, '', notes, '');
    return lines.join('\n');
  }
  lines.splice(index, 1, '## Unreleased', '', `## ${version} - ${date}`);
  return lines.join('\n');
}

/**
 * Stamps the release date in keys.ts (SERVER_RELEASE_DATE).
 * Replaces the existing SERVER_RELEASE_DATE with `<date>T00:00:00Z`.
 */
export function stampReleaseDate(source, date) {
  return source.replace(
    /export const SERVER_RELEASE_DATE = '[^']+';/,
    `export const SERVER_RELEASE_DATE = '${date}T00:00:00Z';`,
  );
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

/**
 * Starts a built server that must refuse to run (an unsupported Node.js): resolves when it exits
 * with code 1 and a [FATAL] "not supported" message, printing nothing on stdout; rejects when it
 * exits otherwise or stays alive. Its stdin is empty: a server that wrongly starts sees the end of
 * its input and exits with code 0, which is rejected.
 */
export function expectServerRefusal(command, timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS, args = []) {
  return new Promise((resolve, reject) => {
    const server = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    const timer = setTimeout(() => {
      server.kill();
      reject(new Error(`Server did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    server.stdout.on('data', (chunk) => {
      output.stdout += String(chunk);
    });
    server.stderr.on('data', (chunk) => {
      output.stderr += String(chunk);
    });
    server.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 1 && !output.stdout && /\[FATAL\].*not supported/.test(output.stderr)) {
        resolve(output.stderr.trim());
      } else {
        reject(
          new Error(
            `Expected a refusal, got exit ${code}: ${output.stderr || output.stdout}`.trim(),
          ),
        );
      }
    });
  });
}

/** The official MCP Registry publisher the release accepts: installed by the maintainer, verified. */
export const MCP_PUBLISHER_VERSION = '1.8.7';

/** The schema of server.json, the MCP Registry listing. */
const MCP_SERVER_SCHEMA =
  'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';

const MCP_NAME = /^io\.github\.[A-Za-z0-9-]+\/[a-zA-Z0-9._-]+$/;

/** A command in a deprecation message: an AI agent reading the warning could run it unasked. */
const SHELL_COMMAND =
  /\b(npm|npx|pnpm|yarn|bunx?)\s+(i|install|add|exec|dlx|x)\b|\bcurl\b|\|\s*(ba)?sh\b/i;

/**
 * D21: a deprecation names its cause, the range to use instead and what the upgrade needs:
 * "<Cause>. Upgrade to <package>@<range> (<prerequisites>)." Under 256 characters, and no shell
 * command: an AI agent reading the warning could run it without asking.
 */
export function deprecationProblems(message, packageName) {
  const problems = [];
  const target = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shape = new RegExp(`^\\S.*\\. Upgrade to ${target}@[\\^~]?\\d+\\.\\d+\\.\\d+ \\(.+\\)\\.$`);
  if (!shape.test(message)) {
    problems.push(`write it as "<Cause>. Upgrade to ${packageName}@<range> (<prerequisites>)."`);
  }
  if (message.length > 256) {
    problems.push(`${message.length} characters, 256 at most`);
  }
  if (SHELL_COMMAND.test(message)) {
    problems.push('it prescribes a shell command');
  }
  return problems;
}

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

/**
 * Parses `npm stage list <package>` output (blocks of "key: value" lines, each starting with
 * "id:") into entries: { id, packageName, version, status, tag, shasum, ... }. No staged
 * version gives [].
 */
export function parseStageList(text) {
  const entries = [];
  let current = null;
  for (const line of text.split('\n')) {
    const match = /^\s*([a-z][a-z ]*?):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1].replace(/ (\w)/g, (_, letter) => letter.toUpperCase());
    if (key === 'id') {
      current = { id: match[2].trim() };
      entries.push(current);
    } else if (current) {
      current[key] = match[2].trim();
    }
  }
  return entries;
}
