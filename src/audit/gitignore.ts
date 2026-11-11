import type { AuditContext } from './types.js';

/**
 * Reading .gitignore the way git does, for the audit's "is this secret kept out of git" checks.
 * Pure logic over the file's text: the audit context does the reading.
 */

/** The .gitignore that applies to the project root: its own, else the nearest one above it. */
export function gitignoreOf(ctx: AuditContext): { content: string; fromParent: boolean } {
  const own = ctx.readFile('.gitignore');
  return own === null
    ? { content: ctx.readParentFile('.gitignore') ?? '', fromParent: true }
    : { content: own, fromParent: false };
}

/** A gitignore glob without "/", "[" or "\\" as a regular expression ("*" and "?" stop at "/"). */
function globToRegExp(pattern: string, ignoreCase: boolean): RegExp {
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
  return new RegExp(`^${body}$`, ignoreCase ? 'i' : '');
}

/**
 * Whether git would ignore `fileName` at the root of the audited project, read the way
 * git reads a .gitignore (last matching rule wins, leading whitespace counts, trailing spaces do
 * not, CR and BOM are dropped). `fromParent` means the rules come from a .gitignore higher up in
 * the repository: anchored rules ("/name") then apply to that folder, not to the project.
 *
 * Fail closed: a rule this reader cannot evaluate ("[...]", "\\", a path with "/") never counts
 * as ignoring the file, and a negation that might match restores it. A positive rule matches
 * case-sensitively, a negation case-insensitively (git may run with core.ignorecase).
 */
export function isIgnoredAtRoot(content: string, fileName: string, fromParent: boolean): boolean {
  let ignored = false;
  for (const raw of content.replace(/^\uFEFF/, '').split('\n')) {
    const line = raw.replace(/\r$/, '').replace(/(?<!\\) +$/, '');
    if (line === '' || line.startsWith('#')) {
      continue;
    }
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
    if (pattern === '' || pattern.endsWith('/') || (anchored && fromParent)) {
      // Nothing, a directory-only rule, or a rule rooted in another folder: never this file
      continue;
    }
    if (/[/[\\]/.test(pattern)) {
      if (negated) {
        ignored = false;
      }
      continue;
    }
    if (globToRegExp(pattern, negated).test(fileName)) {
      ignored = !negated;
    }
  }
  return ignored;
}
