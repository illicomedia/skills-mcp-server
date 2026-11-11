// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** `pnpm release` without an action: what is published and what is pending (read-only). */

import { unreleasedSummary } from './changelog.mjs';
import { git, RELEASE_BRANCH, registryState } from './shared.mjs';
import { tagForVersion } from './versions.mjs';

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
