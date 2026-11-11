// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** The tarball steps CI runs: smoke test, refusal check, npm staging, rehearsal, GitHub Release. */

import { extractChangelogSection } from './changelog.mjs';
import { MIN_NPM_FOR_STAGING } from './checks.mjs';
import { npm, registryState } from './shared.mjs';
import { tagForVersion, tarballFileName, versionAtLeast } from './versions.mjs';
/** Installs the package into an empty folder, as a user would, and runs the smoke session. */
export async function installAndSmoke(ctx, spec, version) {
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
