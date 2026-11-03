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
  extractChangelogSection,
  githubRepoSlug,
  listingAtVersion,
  listingProblems,
  MCP_PUBLISHER_VERSION,
  MIN_NPM_FOR_STAGING,
  nextDistTagAfterPromotion,
  parseRegistryState,
  stampChangelog,
  tagForVersion,
  tarballFileName,
  versionAtLeast,
} from './release-lib.mjs';

const RELEASE_BRANCH = 'main';
export const REGISTRY_ATTEMPTS = 30;
const REGISTRY_WAIT_MS = 10_000;
const MCP_REGISTRY_API = 'https://registry.modelcontextprotocol.io/v0/servers';
const LISTING = 'server.json';
/** CI (about 8 minutes) plus a maintainer approving the staged version with 2FA. */
const PUBLISH_ATTEMPTS = 180;

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

/**
 * Waits until the version is public on npm. CI only stages it (npm Trusted Publishing may not
 * publish directly); it goes public when a maintainer approves the staged version with 2FA.
 */
export async function waitForPublish(ctx, pkg, version) {
  ctx.log(`When CI is green, it stages v${version}. Approve it with 2FA in another terminal:`);
  ctx.log(`  npm stage list ${pkg.name}`);
  ctx.log('  npm stage approve <stage-id>');
  for (let attempt = 1; attempt <= PUBLISH_ATTEMPTS; attempt += 1) {
    if (registryState(ctx, pkg.name).versions.includes(version)) {
      ctx.ok(`${pkg.name}@${version} is public on npm.`);
      return;
    }
    if (attempt % 6 === 1) {
      ctx.log(
        `Waiting for v${version} to be staged and approved (${attempt}/${PUBLISH_ATTEMPTS})...`,
      );
    }
    await ctx.sleep(REGISTRY_WAIT_MS);
  }
  throw new Error(
    `v${version} is not public yet. Check the release workflow run, approve the staged version (npm stage approve), then run --promote ${version}.`,
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
export async function promote(ctx, pkg, { version, dryRun = false, yes = false }) {
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
  if (readListing(ctx)?.version === version) {
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

/** prepare, wait for CI to publish to `next`, then verify and promote (with confirmation). */
export async function ship(ctx, pkg, options) {
  const { version, pushed } = await prepare(ctx, pkg, options);
  if (options.dryRun) {
    ctx.log(`[dry-run] Would wait for CI to publish v${version}, verify it, then promote it.`);
    return;
  }
  if (!pushed) {
    ctx.log('Stopped before publishing: nothing was pushed, so CI has nothing to release.');
    return;
  }
  await waitForPublish(ctx, pkg, version);
  await promote(ctx, pkg, { ...options, version });
}
