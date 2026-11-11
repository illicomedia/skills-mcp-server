// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** Version numbers and tags: comparison, bumps, tarball and tag names. */
export const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export const BUMPS = ['patch', 'minor', 'major', 'prerelease', 'release'];

export const PREID = /^[a-z]+$/;

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

/** True when the `next` tag still points at the version that has just become `latest`. */
export function nextDistTagAfterPromotion(distTags, promotedVersion) {
  return distTags.next === promotedVersion;
}
