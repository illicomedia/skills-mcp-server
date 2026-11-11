// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** The npm steps after CI: approve the staged version, verify it, promote, deprecate. */

import { deprecationProblems, githubRepoSlug, parseStageList } from './checks.mjs';
import { installAndSmoke } from './ci.mjs';
import { publishListing, readListing } from './listing.mjs';
import { prepare } from './prepare.mjs';
import {
  approve,
  deprecationOf,
  npm,
  REGISTRY_ATTEMPTS,
  REGISTRY_WAIT_MS,
  registryState,
  requireLogin,
} from './shared.mjs';
import { nextDistTagAfterPromotion, tagForVersion, tarballFileName } from './versions.mjs';

/** How long --approve waits for CI to stage a version: 40 polls of 90 s, one hour. */
const STAGE_ATTEMPTS = 40;

const STAGE_POLL_MS = 90_000;

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
