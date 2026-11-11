import type { AuditContext } from './types.js';

/**
 * Reading .gitignore the way git does, for the audit's "is this secret kept out of git" checks.
 * Pure logic over the file's text: the audit context does the reading.
 */

/** The .gitignore that applies to the project root: its own, else the nearest one above it. */
function gitignoreOf(ctx: AuditContext): { content: string; fromParent: boolean } {
  const own = ctx.readFile('.gitignore');
  return own === null
    ? { content: ctx.readParentFile('.gitignore') ?? '', fromParent: true }
    : { content: own, fromParent: false };
}

/** One rule of a .gitignore, ready to match. `matches` is null when it cannot be evaluated. */
interface GitignoreRule {
  negated: boolean;
  anchored: boolean;
  folderOnly: boolean;
  matches: ((name: string) => boolean) | null;
}

/** A glob without "/", "[" or a backslash ("*" and "?" stop at "/"); plain names skip RegExp. */
function nameMatcher(pattern: string, ignoreCase: boolean): (name: string) => boolean {
  if (!/[*?]/.test(pattern)) {
    const wanted = ignoreCase ? pattern.toLowerCase() : pattern;
    return (name) => (ignoreCase ? name.toLowerCase() : name) === wanted;
  }
  const body = pattern
    .split('')
    .map((char) => {
      if (char === '*') {
        return '[^/]*';
      }
      if (char === '?') {
        return '[^/]';
      }
      return char.replace(/[.+^${}()|]/g, '\\$&');
    })
    .join('');
  const glob = new RegExp(`^${body}$`, ignoreCase ? 'i' : '');
  return (name) => glob.test(name);
}

/**
 * The rules of a .gitignore, read the way git reads them: leading whitespace counts, trailing
 * spaces do not (unless escaped), CR and a leading BOM are dropped, "#" starts a comment. With
 * `fromParent` (rules from a .gitignore higher up), anchored rules belong to that folder and are
 * left out. A positive rule matches case-sensitively, a negation case-insensitively (git may run
 * with core.ignorecase), so neither choice can report a committed file as ignored.
 *
 * Rules are returned last first, and a line that appears again later is dropped: the last
 * matching rule wins, so an earlier copy can never decide.
 */
function parseRules(content: string, fromParent: boolean): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  const seen = new Set<string>();
  for (const raw of content
    .replace(/^\uFEFF/, '')
    .split('\n')
    .reverse()) {
    const line = raw.replace(/\r$/, '').replace(/(?<!\\) +$/, '');
    if (line === '' || line.startsWith('#') || seen.has(line)) {
      continue;
    }
    seen.add(line);
    const negated = line.startsWith('!');
    let pattern = negated ? line.slice(1) : line;
    let anchored = false;
    if (pattern.startsWith('/')) {
      anchored = true;
      pattern = pattern.slice(1);
    }
    while (pattern.startsWith('**/')) {
      anchored = false;
      pattern = pattern.slice(3);
    }
    const folderOnly = pattern.endsWith('/');
    if (folderOnly) {
      pattern = pattern.slice(0, -1);
    }
    if (pattern === '' || (anchored && fromParent)) {
      continue;
    }
    const matches = /[/[\\]/.test(pattern) ? null : nameMatcher(pattern, negated);
    rules.push({ negated, anchored, folderOnly, matches });
  }
  return rules;
}

const parsed = new WeakMap<AuditContext, GitignoreRule[]>();

/** The .gitignore rules of the audited project, read and parsed once per audit. */
export function gitignoreRules(ctx: AuditContext): readonly GitignoreRule[] {
  let rules = parsed.get(ctx);
  if (!rules) {
    const { content, fromParent } = gitignoreOf(ctx);
    rules = parseRules(content, fromParent);
    parsed.set(ctx, rules);
  }
  return rules;
}

/**
 * Whether git would ignore `relPath` (a file, relative to the audited project). The last matching
 * rule wins; a rule without "/" matches the file's name or any folder above it, an anchored one
 * only the top entry, a folder rule ("name/") only folders.
 *
 * Fail closed: a rule that cannot be evaluated ("[...]", a backslash, a path with "/") never
 * counts as ignoring the file, and such a negation restores it.
 */
export function isIgnored(rules: readonly GitignoreRule[], relPath: string): boolean {
  const segments = relPath.split('/');
  const folders = segments.slice(0, -1);
  // Rules come last first: the first one that decides is the one git would apply.
  for (const rule of rules) {
    if (rule.matches === null) {
      if (rule.negated) {
        return false;
      }
      continue;
    }
    const names = rule.folderOnly ? folders : segments;
    const candidates = rule.anchored ? names.slice(0, 1) : names;
    if (candidates.some(rule.matches)) {
      return !rule.negated;
    }
  }
  return false;
}
