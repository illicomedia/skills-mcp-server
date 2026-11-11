// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** Pure checks on what GitHub and npm answer: CI runs, registry state, stage list, D21. */
/** npm needs this version for Trusted Publishing (OIDC) and `npm stage publish`. */
export const MIN_NPM_FOR_STAGING = '11.5.1';

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

/** npm 12 wraps `npm view --json` answers in an array; older clients do not. */
export function parseRegistryState(raw) {
  const [state] = [JSON.parse(raw)].flat();
  return { versions: [state.versions].flat(), distTags: state['dist-tags'] ?? {} };
}

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
