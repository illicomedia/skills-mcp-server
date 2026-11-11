// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** CHANGELOG.md: the "## Unreleased" notes, version sections and the release stamp. */
const UNRELEASED_HEADING = /^## \[?Unreleased\]?\s*$/i;

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
