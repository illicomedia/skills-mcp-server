// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** Cutting a release: preflight, CI gate, local gates, version, changelog, commit, tag, push. */

import { extractChangelogSection, stampChangelog, stampReleaseDate } from './changelog.mjs';
import { ciProblem, githubRepoSlug } from './checks.mjs';
import { smoke } from './ci.mjs';
import { LISTING, listingAtVersion, listingReady, readListing } from './listing.mjs';
import { approve, git, RELEASE_BRANCH, registryState } from './shared.mjs';
import { bumpVersion, tagForVersion } from './versions.mjs';

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
