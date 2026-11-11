/**
 * Release orchestration of @illicomedia/skills-mcp-server. See docs/operations/mcp-publish-process.md.
 *
 * Everything that touches git, npm, the file system or the user goes through `ctx`, so tests can
 * drive each flow with a fake runner. scripts/release.mjs wires the real one.
 *
 * Publishing is CI's job (.github/workflows/release.yml, npm Trusted Publishing): this module
 * never runs `npm publish`. It prepares a release (gates, version, changelog, commit, tag, push),
 * waits for CI to stage it and a maintainer to approve it (`npm stage approve`, 2FA) onto `next`,
 * verifies it from the registry, then moves `latest` after a human confirms. It never unpublishes, and deprecates one version at a time, on request only.
 */

import {
  bumpVersion,
  ciProblem,
  deprecationProblems,
  extractChangelogSection,
  githubRepoSlug,
  listingAtVersion,
  listingProblems,
  MCP_PUBLISHER_VERSION,
  MIN_NPM_FOR_STAGING,
  nextDistTagAfterPromotion,
  parseRegistryState,
  parseStageList,
  stampChangelog,
  stampReleaseDate,
  tagForVersion,
  tarballFileName,
  unreleasedSummary,
  versionAtLeast,
} from './release-lib.mjs';

const RELEASE_BRANCH = 'main';
export const REGISTRY_ATTEMPTS = 30;
const REGISTRY_WAIT_MS = 10_000;
const MCP_REGISTRY_API = 'https://registry.modelcontextprotocol.io/v0/servers';
const LISTING = 'server.json';
/** How long --approve waits for CI to stage a version: 40 polls of 90 s, one hour. */
const STAGE_ATTEMPTS = 40;
const STAGE_POLL_MS = 90_000;

function git(ctx, ...args) {
  return ctx.sh('git', args);
}

function npm(ctx, ...args) {
  return ctx.sh('npm', args);
}

/** server.json, the MCP Registry listing, or null when the package has none. */
function readListing(ctx) {
  if (!ctx.listDir(ctx.pkgDir).includes(LISTING)) {
    return null;
  }
  return JSON.parse(ctx.readFile(ctx.join(ctx.pkgDir, LISTING)));
}

function listingReady(listing, pkg, version) {
  const problems = listingProblems(listing, pkg, version);
  if (problems.length > 0) {
    throw new Error(`server.json is not ready for ${version}:\n  - ${problems.join('\n  - ')}`);
  }
}

export function registryState(ctx, packageName) {
  try {
    return parseRegistryState(npm(ctx, 'view', packageName, 'versions', 'dist-tags', '--json'));
  } catch (error) {
    if (/E404/.test(error.message)) {
      return { versions: [], distTags: {} };
    }
    throw error;
  }
}

function deprecationOf(ctx, packageName, version) {
  return npm(ctx, 'view', `${packageName}@${version}`, 'deprecated');
}

function requireLogin(ctx) {
  try {
    ctx.ok(`Logged into npm as: ${npm(ctx, 'whoami')}`);
  } catch {
    throw new Error('Not logged in to npm. Run `npm login` first.');
  }
}

/** A step that changes shared state: refused unless someone said yes (or passed --yes). */
export async function approve(ctx, question, { yes }) {
  if (yes) {
    return true;
  }
  if (!ctx.interactive) {
    throw new Error(`${question} Needs confirmation: run in a terminal or pass --yes.`);
  }
  return ctx.confirm(question);
}

/** Why GitHub CI does not allow releasing this commit, or null when every check is green. */
async function ciGate(ctx, pkg, sha) {
  const slug = githubRepoSlug(pkg.repository);
  if (!slug) {
    return 'package.json "repository" is not a GitHub URL, so CI status cannot be checked.';
  }
  try {
    const url = `https://api.github.com/repos/${slug}/commits/${sha}/check-runs?per_page=100`;
    return ciProblem(await ctx.fetchJson(url));
  } catch (error) {
    return `Could not read CI status from GitHub: ${error.message}`;
  }
}

/** Problems that make a release unsafe. In dry-run they are reported, not thrown. */
async function preflight(ctx, pkg, version, { dryRun }) {
  const problems = [];
  const branch = git(ctx, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== RELEASE_BRANCH) {
    problems.push(`Releases are cut from ${RELEASE_BRANCH}, not ${branch}.`);
  }
  const changes = git(ctx, 'status', '--porcelain');
  if (changes) {
    problems.push(`Commit or discard these changes first:\n${changes}`);
  }
  git(ctx, 'fetch', '--quiet', 'origin', RELEASE_BRANCH, '--tags');
  const head = git(ctx, 'rev-parse', 'HEAD');
  if (head !== git(ctx, 'rev-parse', `origin/${RELEASE_BRANCH}`)) {
    problems.push(`HEAD is not origin/${RELEASE_BRANCH}: pull or push first.`);
  }
  const ci = await ciGate(ctx, pkg, head);
  if (ci) {
    problems.push(ci);
  }
  const tag = tagForVersion(version);
  if (git(ctx, 'tag', '--list', tag)) {
    problems.push(`Tag ${tag} already exists.`);
  }
  if (registryState(ctx, pkg.name).versions.includes(version)) {
    problems.push(`${pkg.name}@${version} is already on npm, which never allows it again.`);
  }
  if (problems.length > 0) {
    const report = problems.map((problem) => `  - ${problem}`).join('\n');
    if (!dryRun) {
      throw new Error(`Release preflight failed:\n${report}`);
    }
    ctx.warn(`[dry-run] Preflight would fail:\n${report}`);
  }
}

/** Installs the package into an empty folder, as a user would, and runs the smoke session. */
async function installAndSmoke(ctx, spec, version) {
  const dir = ctx.makeTempDir();
  try {
    ctx.writeFile(ctx.join(dir, 'package.json'), '{"private":true}\n');
    ctx.sh('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', spec], { cwd: dir });
    const { tools } = await ctx.smokeServer(dir, version);
    return tools;
  } finally {
    ctx.removeDir(dir);
  }
}

/**
 * The absolute path of the one tarball in `dir`, which must be this package at this version.
 * Absolute on purpose: npm reads a relative "dir/file.tgz" as a GitHub repository (user/repo).
 */
export function findTarball(ctx, pkg, dir) {
  const tarballs = ctx.listDir(dir).filter((file) => file.endsWith('.tgz'));
  const expected = tarballFileName(pkg.name, pkg.version);
  if (tarballs.length !== 1 || tarballs[0] !== expected) {
    throw new Error(
      `Expected exactly ${expected} in ${dir}, found: ${tarballs.join(', ') || 'none'}`,
    );
  }
  return ctx.resolve(ctx.join(dir, expected));
}

/** Packs the build once and smoke-tests that tarball, or the one in `tarballDir`. */
export async function smoke(ctx, pkg, { tarballDir = null } = {}) {
  let dir = tarballDir;
  if (!dir) {
    ctx.sh('pnpm', ['run', 'build']);
    dir = ctx.makeTempDir();
    ctx.sh('pnpm', ['pack', '--pack-destination', dir]);
  }
  try {
    const tools = await installAndSmoke(ctx, findTarball(ctx, pkg, dir), pkg.version);
    ctx.ok(`Packed tarball v${pkg.version} starts and exposes ${tools} tools.`);
  } finally {
    if (!tarballDir) {
      ctx.removeDir(dir);
    }
  }
}

/**
 * CI on unsupported Node.js lines: the installed package must refuse to start (decision D7).
 * Installs the tarball as a user would, then expects a [FATAL] exit before any answer.
 */
export async function expectRefusal(ctx, pkg, { tarballDir }) {
  const dir = ctx.makeTempDir();
  try {
    ctx.writeFile(ctx.join(dir, 'package.json'), '{"private":true}\n');
    const tarball = findTarball(ctx, pkg, tarballDir);
    ctx.sh('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], {
      cwd: dir,
    });
    const message = await ctx.refusingServer(dir);
    ctx.ok(`The installed package refuses this Node.js, as intended: ${message}`);
  } finally {
    ctx.removeDir(dir);
  }
}

/** npm too old for Trusted Publishing and `npm stage` fails before anything is attempted. */
function requireNpmForStaging(ctx) {
  const version = npm(ctx, '--version');
  if (!versionAtLeast(version, MIN_NPM_FOR_STAGING)) {
    throw new Error(
      `npm ${version} cannot stage; npm ${MIN_NPM_FOR_STAGING} or later is required.`,
    );
  }
}

function stageArgs(tarball, dryRun) {
  return [
    'stage',
    'publish',
    tarball,
    '--tag',
    'next',
    '--access',
    'public',
    dryRun ? '--dry-run' : '--provenance',
  ];
}

/**
 * CI only (release.yml): stages the tested tarball on npm under `next`, for a maintainer to
 * approve with 2FA. Skips a version already on npm, so a re-run is harmless.
 */
export function stage(ctx, pkg, { tarballDir }) {
  requireNpmForStaging(ctx);
  if (registryState(ctx, pkg.name).versions.includes(pkg.version)) {
    ctx.ok(`${pkg.name}@${pkg.version} is already published; nothing to stage.`);
    return;
  }
  ctx.sh('npm', stageArgs(findTarball(ctx, pkg, tarballDir), false), { interactive: true });
  ctx.summary(
    [
      `### ${pkg.name}@${pkg.version} is staged, not public yet`,
      '',
      `Approve it with 2FA: \`npm stage list ${pkg.name}\`, then \`npm stage approve <stage-id>\`.`,
      `It then appears under \`next\`; move \`latest\` with \`pnpm release --promote ${pkg.version}\`.`,
      '',
    ].join('\n'),
  );
}

/**
 * CI on every push (ci.yml): the release path up to staging, without staging anything. Checks
 * the tag logic, the release notes, the npm client, the tarball, and dry-runs the exact staging
 * command on a copy versioned <version>-ci.<run>.<attempt>, which can never exist on npm (npm
 * refuses an existing version even in a dry run).
 */
export function rehearse(ctx, pkg, { tarballDir }) {
  const tag = tagForVersion(pkg.version);
  const changelog = ctx.readFile(ctx.join(ctx.pkgDir, 'CHANGELOG.md'));
  if (!extractChangelogSection(changelog, pkg.version)) {
    throw new Error(`CHANGELOG.md has no release notes for ${pkg.version}.`);
  }
  requireNpmForStaging(ctx);
  findTarball(ctx, pkg, tarballDir);

  const runId = `ci.${ctx.env.GITHUB_RUN_ID ?? 'local'}.${ctx.env.GITHUB_RUN_ATTEMPT ?? '0'}`;
  const rehearsal = { ...pkg, version: `${pkg.version}-${runId}` };
  const work = ctx.makeTempDir();
  const out = ctx.makeTempDir();
  try {
    for (const file of pkg.files) {
      ctx.copy(ctx.join(ctx.pkgDir, file), ctx.join(work, file));
    }
    ctx.writeFile(ctx.join(work, 'package.json'), `${JSON.stringify(rehearsal, null, 2)}\n`);
    ctx.sh('npm', ['pack', '--pack-destination', out], { cwd: work });
    ctx.sh('npm', stageArgs(findTarball(ctx, rehearsal, out), true));
  } finally {
    ctx.removeDir(work);
    ctx.removeDir(out);
  }
  ctx.ok(`Release rehearsal passed for ${tag}: notes, npm client, tarball, staging command.`);
}

/** CI only (release.yml): the GitHub Release for a tag, with its notes and the tarball. */
export function githubRelease(ctx, pkg, { tag, tarballDir }) {
  try {
    ctx.sh('gh', ['release', 'view', tag]);
    ctx.ok(`Release ${tag} already exists.`);
    return;
  } catch {
    // Not created yet.
  }
  const notesFile = ctx.join(ctx.makeTempDir(), 'NOTES.md');
  const changelog = ctx.readFile(ctx.join(ctx.pkgDir, 'CHANGELOG.md'));
  ctx.writeFile(notesFile, `${extractChangelogSection(changelog, pkg.version)}\n`);
  const args = ['release', 'create', tag, findTarball(ctx, pkg, tarballDir)];
  args.push('--verify-tag', '--title', tag, '--notes-file', notesFile);
  if (pkg.version.includes('-')) {
    args.push('--prerelease');
  }
  ctx.sh('gh', args);
  ctx.ok(`Created the GitHub Release ${tag}.`);
}

/** The same gates CI runs, in the same order. */
async function runGates(ctx, pkg) {
  for (const script of ['lint', 'build', 'test:coverage']) {
    ctx.log(`Running pnpm run ${script}...`);
    ctx.sh('pnpm', ['run', script]);
  }
  await smoke(ctx, pkg);
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** npm's dist-tags for the status: null values when the registry cannot say. */
function publishedState(ctx, pkg) {
  try {
    const { versions, distTags } = registryState(ctx, pkg.name);
    if (versions.length === 0) {
      ctx.warn(`${pkg.name} was never published on npm.`);
      return { latest: null, next: null, versions };
    }
    return { latest: distTags.latest ?? null, next: distTags.next ?? null, versions };
  } catch {
    ctx.warn('npm registry not reachable: published versions unknown.');
    return { latest: null, next: null, versions: [] };
  }
}

/** Status: the commits since the tag of this version (null when it is not tagged). */
function pendingCommits(ctx, version) {
  const tag = tagForVersion(version);
  if (git(ctx, 'tag', '--list', tag) !== tag) {
    ctx.warn(`${tag} is not tagged: v${version} has not been released from this repository.`);
    return null;
  }
  const subjects = git(ctx, 'log', '--format=%s', `${tag}..HEAD`).split('\n').filter(Boolean);
  if (subjects.length > 0) {
    ctx.log(`Pending: ${plural(subjects.length, 'commit')} since ${tag}:`);
    for (const subject of subjects.slice(0, 10)) {
      ctx.log(`  - ${subject}`);
    }
    if (subjects.length > 10) {
      ctx.log(`  ... and ${subjects.length - 10} more`);
    }
  }
  return subjects.length;
}

/** Status: branch, commits not pushed and uncommitted files. */
function workingTreeState(ctx) {
  const branch = git(ctx, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== RELEASE_BRANCH) {
    ctx.warn(`On branch ${branch} (releases are cut from ${RELEASE_BRANCH}).`);
  }
  const unpushed = Number(git(ctx, 'rev-list', '--count', `origin/${RELEASE_BRANCH}..HEAD`));
  if (unpushed > 0) {
    ctx.warn(`${plural(unpushed, 'commit')} not pushed to origin/${RELEASE_BRANCH}.`);
  }
  const dirty = git(ctx, 'status', '--porcelain').split('\n').filter(Boolean).length;
  if (dirty > 0) {
    ctx.warn(`${plural(dirty, 'uncommitted file')}: commit or discard before a release.`);
  }
  return { unpushed, dirty };
}

/**
 * What `pnpm release` shows without an action: the published versions and what is pending.
 * Read-only: it runs git and npm queries, changes nothing and asks nothing.
 */
export async function status(ctx, pkg) {
  const { version } = pkg;
  const { latest, next, versions } = publishedState(ctx, pkg);
  const waiting = next !== null && next !== latest;
  ctx.log(`${pkg.name}: package.json is at v${version}`);
  ctx.log(`npm latest: ${latest ? `v${latest}` : 'none'}`);
  if (waiting) {
    ctx.log(`npm next:   v${next} (public under "next", not yet "latest")`);
  }
  if (versions.length > 0 && !versions.includes(version)) {
    ctx.warn(`v${version} is not on npm.`);
  }
  const { unpushed, dirty } = workingTreeState(ctx);
  const commitsSinceTag = pendingCommits(ctx, version);

  const notes = unreleasedSummary(ctx.readFile(ctx.join(ctx.pkgDir, 'CHANGELOG.md')));
  if (notes.entries > 0) {
    const under = notes.headings.length > 0 ? ` (${notes.headings.join(', ')})` : '';
    ctx.log(`Unreleased notes: ${notes.entries}${under} in CHANGELOG.md`);
    ctx.log(`Next: pnpm release --bump ${notes.bump} --dry-run   (then without --dry-run)`);
  } else if (commitsSinceTag) {
    ctx.warn('Commits are pending but there are no notes under "## Unreleased" in CHANGELOG.md.');
  }
  if (waiting) {
    ctx.log(`Next: pnpm release --promote ${next}   (moves "latest", npm 2FA)`);
  }
  if (notes.entries === 0 && commitsSinceTag === 0 && !waiting) {
    ctx.ok('Nothing to release: the published version is up to date.');
  }
  const tagged = commitsSinceTag !== null;
  return { version, latest, next, tagged, commitsSinceTag, unpushed, dirty, bump: notes.bump };
}

/**
 * Cuts a release: preflight, version bump, changelog stamp, gates, release commit, annotated
 * tag, atomic push. The tag push is what makes CI publish. Returns the version, and whether it
 * was pushed.
 */
export async function prepare(
  ctx,
  pkg,
  { bump = null, preid = null, dryRun = false, yes = false } = {},
) {
  const version = bump ? bumpVersion(pkg.version, bump, preid) : pkg.version;
  const tag = tagForVersion(version);
  const changelogPath = ctx.join(ctx.pkgDir, 'CHANGELOG.md');
  const changelog = ctx.readFile(changelogPath);
  const stamped = stampChangelog(changelog, version, ctx.today());
  await preflight(ctx, pkg, version, { dryRun });

  ctx.log(`Release plan: ${pkg.name} ${pkg.version} -> ${version} (tag ${tag})`);
  if (dryRun) {
    ctx.log('[dry-run] Would stamp CHANGELOG.md, run lint, build, test:coverage and smoke,');
    ctx.log(`[dry-run] commit "chore(release): ${version}", tag ${tag}, push both.`);
    return { version, pushed: false };
  }

  const pkgPath = ctx.join(ctx.pkgDir, 'package.json');
  const released = { ...pkg, version };
  const listing = readListing(ctx);
  const files = ['package.json', 'CHANGELOG.md'];
  ctx.writeFile(pkgPath, `${JSON.stringify(released, null, 2)}\n`);
  ctx.writeFile(changelogPath, stamped);
  const keysPath = ctx.join(ctx.pkgDir, 'src', 'license', 'keys.ts');
  const hasKeys = ctx.listDir(ctx.join(ctx.pkgDir, 'src', 'license')).includes('keys.ts');
  if (hasKeys) {
    files.push('src/license/keys.ts');
    ctx.writeFile(keysPath, stampReleaseDate(ctx.readFile(keysPath), ctx.today()));
  }
  if (listing) {
    files.push(LISTING);
    ctx.writeFile(
      ctx.join(ctx.pkgDir, LISTING),
      `${JSON.stringify(listingAtVersion(listing, version), null, 2)}\n`,
    );
  }
  try {
    if (listing) {
      listingReady(listingAtVersion(listing, version), released, version);
    }
    await runGates(ctx, released);
  } catch (error) {
    git(ctx, 'checkout', '--', ...files);
    throw error;
  }

  const notes = extractChangelogSection(stamped, version);
  git(ctx, 'add', ...files);
  git(ctx, 'commit', '--quiet', '-m', `chore(release): ${version}\n\n${notes}`.trim());
  git(ctx, 'tag', '-a', tag, '-m', `Release ${version}`);
  ctx.ok(`Committed and tagged ${tag}.`);

  if (!(await approve(ctx, `Push ${RELEASE_BRANCH} and ${tag} to origin?`, { yes }))) {
    ctx.log(`Not pushed. When ready: git push --atomic origin ${RELEASE_BRANCH} ${tag}`);
    return { version, pushed: false };
  }
  git(ctx, 'push', '--atomic', 'origin', RELEASE_BRANCH, `refs/tags/${tag}`);
  ctx.ok(
    `Pushed ${tag}: after full CI, the release workflow stages it on npm for your 2FA approval.`,
  );
  return { version, pushed: true };
}

/** The latest Release workflow run for a tag (public GitHub API), or null when unknown. */
async function releaseRun(ctx, slug, tag) {
  try {
    const runs = await ctx.fetchJson(
      `https://api.github.com/repos/${slug}/actions/workflows/release.yml/runs?branch=${encodeURIComponent(tag)}&per_page=1`,
    );
    return (runs.workflow_runs ?? [])[0] ?? null;
  } catch {
    return null;
  }
}

async function waitForStage(ctx, pkg, version, slug) {
  const tag = tagForVersion(version);
  let linked = false;
  for (let attempt = 1; attempt <= STAGE_ATTEMPTS; attempt += 1) {
    const staged = parseStageList(npm(ctx, 'stage', 'list', pkg.name)).find(
      (entry) => entry.version === version && entry.status === 'staged',
    );
    if (staged) {
      return staged;
    }
    const run = await releaseRun(ctx, slug, tag);
    if (run?.status === 'completed' && run.conclusion !== 'success') {
      throw new Error(`The release workflow for ${tag} ended "${run.conclusion}": ${run.html_url}`);
    }
    if (run && !linked) {
      linked = true;
      ctx.log(`Release workflow for ${tag}: ${run.html_url}`);
      ctx.log(
        'When its CI is green, approve the "npm-publish" deployment there (Review deployments).',
      );
    }
    ctx.log(`Waiting for ${tag} to be staged on npm (${attempt}/${STAGE_ATTEMPTS})...`);
    await ctx.sleep(STAGE_POLL_MS);
  }
  throw new Error(`${tag} was not staged within the hour; check the release workflow, then retry.`);
}

async function releaseTarballSha1(ctx, pkg, version, slug) {
  const url = `https://github.com/${slug}/releases/download/${tagForVersion(version)}/${tarballFileName(pkg.name, version)}`;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const sha1 = await ctx.downloadSha1(url);
    if (sha1) {
      return sha1;
    }
    await ctx.sleep(REGISTRY_WAIT_MS);
  }
  throw new Error(
    `The GitHub Release tarball is not available (${url}); the staged version cannot be verified.`,
  );
}

/**
 * The maintainer's npm step of a release: waits until CI has staged the version (showing the
 * workflow link, where the npm-publish deployment is approved in the browser), checks that the
 * staged tarball is the one attached to the GitHub Release, asks, approves it with npm (2FA),
 * and waits until it is public under `next`. The GitHub approval itself stays a human click.
 */
export async function approveStaged(ctx, pkg, { version, yes = false }) {
  if (registryState(ctx, pkg.name).versions.includes(version)) {
    ctx.ok(`${pkg.name}@${version} is already public on npm.`);
    return;
  }
  const slug = githubRepoSlug(pkg.repository);
  const staged = await waitForStage(ctx, pkg, version, slug);
  const sha1 = await releaseTarballSha1(ctx, pkg, version, slug);
  if (sha1 !== staged.shasum) {
    throw new Error(
      `Staged shasum ${staged.shasum} is not the GitHub Release tarball (${sha1}). Do not approve; reject it: npm stage reject ${staged.id}`,
    );
  }
  ctx.ok(
    `Staged ${version} is the tarball CI tested and attached to the GitHub Release (sha1 ${sha1}).`,
  );
  const question = `Approve ${pkg.name}@${version} on npm (2FA)? It becomes public under \`next\`.`;
  if (!(await approve(ctx, question, { yes }))) {
    ctx.log(`Not approved. Later: pnpm release --approve ${version}`);
    return;
  }
  ctx.sh('npm', ['stage', 'approve', staged.id], { interactive: true });
  for (let attempt = 1; attempt <= REGISTRY_ATTEMPTS; attempt += 1) {
    if (registryState(ctx, pkg.name).versions.includes(version)) {
      ctx.ok(
        `${pkg.name}@${version} is public under \`next\`. After trying it: pnpm release --promote ${version}`,
      );
      return;
    }
    await ctx.sleep(REGISTRY_WAIT_MS);
  }
  throw new Error(
    `${pkg.name}@${version} was approved but is not public yet; check npm stage list.`,
  );
}

/** Installs the published version from the registry; a new version can take a moment to answer. */
export async function verifyFromRegistry(ctx, pkg, version) {
  const spec = `${pkg.name}@${version}`;
  let lastError;
  for (let attempt = 1; attempt <= REGISTRY_ATTEMPTS; attempt += 1) {
    try {
      const tools = await installAndSmoke(ctx, spec, version);
      ctx.ok(`${spec} installs from the registry and exposes ${tools} tools.`);
      return;
    } catch (error) {
      lastError = error;
      ctx.log(`${spec} is not installable yet (${attempt}/${REGISTRY_ATTEMPTS})...`);
      await ctx.sleep(REGISTRY_WAIT_MS);
    }
  }
  throw new Error(`${spec} failed verification from the registry: ${lastError.message}`);
}

/** Points `latest` at a published, verified version. The same command rolls back. */
export async function promote(
  ctx,
  pkg,
  { version, dryRun = false, yes = false, withListing = false },
) {
  const { versions, distTags } = registryState(ctx, pkg.name);
  if (!versions.includes(version)) {
    throw new Error(`${pkg.name}@${version} is not published. Published: ${versions.join(', ')}`);
  }
  const deprecated = deprecationOf(ctx, pkg.name, version);
  if (deprecated) {
    throw new Error(`${pkg.name}@${version} is deprecated: ${deprecated}`);
  }
  if (distTags.latest === version) {
    ctx.ok(`\`latest\` already points at v${version}.`);
    return;
  }
  const commands = [['dist-tag', 'add', `${pkg.name}@${version}`, 'latest']];
  if (nextDistTagAfterPromotion(distTags, version)) {
    commands.push(['dist-tag', 'rm', pkg.name, 'next']);
  }
  if (dryRun) {
    for (const command of commands) {
      ctx.log(`[dry-run] Would verify v${version}, then run: npm ${command.join(' ')}`);
    }
    return;
  }
  requireLogin(ctx);
  await verifyFromRegistry(ctx, pkg, version);
  const question = `Move \`latest\` from v${distTags.latest ?? 'none'} to v${version}?`;
  if (!(await approve(ctx, question, { yes }))) {
    ctx.log('Promotion cancelled; `latest` did not move.');
    return;
  }
  for (const command of commands) {
    ctx.sh('npm', command, { interactive: true });
  }
  ctx.ok(`\`latest\` now points at v${version} (was v${distTags.latest ?? 'none'}).`);
  if (!withListing) {
    ctx.log('MCP Registry listing skipped (opt-in: --with-listing, or later --publish-listing).');
  } else if (readListing(ctx)?.version === version) {
    await publishListing(ctx, pkg, { version, yes });
  } else {
    ctx.log(`MCP Registry listing not touched: server.json is not at ${version} (a rollback?).`);
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

/** Marks ONE broken or unsupported version as "do not use", with the reason and the fix. */
export async function deprecate(ctx, pkg, { version, message, dryRun = false, yes = false }) {
  const problems = deprecationProblems(message, pkg.name);
  if (problems.length > 0) {
    throw new Error(`The deprecation message does not follow D21: ${problems.join('; ')}.`);
  }
  const { versions, distTags } = registryState(ctx, pkg.name);
  if (!versions.includes(version)) {
    throw new Error(`${pkg.name}@${version} is not published.`);
  }
  if (distTags.latest === version) {
    throw new Error(`v${version} is \`latest\`. Promote another version first.`);
  }
  const command = ['deprecate', `${pkg.name}@${version}`, message];
  if (dryRun) {
    ctx.log(`[dry-run] Would run: npm ${command.join(' ')}`);
    return;
  }
  requireLogin(ctx);
  if (!(await approve(ctx, `Deprecate v${version} ("${message}")?`, { yes }))) {
    ctx.log('Deprecation cancelled.');
    return;
  }
  ctx.sh('npm', command, { interactive: true });
  ctx.ok(`Deprecated ${pkg.name}@${version}.`);
}

/**
 * Lifts the deprecation of one version (npm's empty message), the first step of an emergency
 * rollback: --promote refuses a deprecated version. Never done in bulk, always confirmed.
 */
export async function undeprecate(ctx, pkg, { version, dryRun = false, yes = false }) {
  const { versions } = registryState(ctx, pkg.name);
  if (!versions.includes(version)) {
    throw new Error(`${pkg.name}@${version} is not published.`);
  }
  if (!deprecationOf(ctx, pkg.name, version)) {
    throw new Error(`${pkg.name}@${version} is not deprecated.`);
  }
  if (dryRun) {
    ctx.log(`[dry-run] Would run: npm deprecate ${pkg.name}@${version} ""`);
    return;
  }
  requireLogin(ctx);
  const question = `Un-deprecate v${version} (it installs again without any warning)?`;
  if (!(await approve(ctx, question, { yes }))) {
    ctx.log('Un-deprecation cancelled.');
    return;
  }
  ctx.sh('npm', ['deprecate', `${pkg.name}@${version}`, ''], { interactive: true });
  ctx.ok(`${pkg.name}@${version} is no longer deprecated.`);
}

/** prepare, wait for CI to publish to `next`, then verify and promote (with confirmation). */
export async function ship(ctx, pkg, options) {
  const { version, pushed } = await prepare(ctx, pkg, options);
  if (options.dryRun) {
    ctx.log(`[dry-run] Would wait for CI to stage v${version}, approve it, verify it, promote it.`);
    return;
  }
  if (!pushed) {
    ctx.log('Stopped before publishing: nothing was pushed, so CI has nothing to release.');
    return;
  }
  await approveStaged(ctx, pkg, { version, yes: options.yes });
  if (registryState(ctx, pkg.name).versions.includes(version)) {
    await promote(ctx, pkg, { ...options, version });
  }
}
