/**
 * The only module of the server that touches the disk (decision D17): path checks, read helpers,
 * and write helpers that refuse any target outside the project root before acting. A test fails
 * if any other shipped module imports node:fs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// System locations a project can never be. Compared lower-case with "/" separators, so a
// Windows path and a case-insensitive filesystem (macOS) are covered by the same lists.
const POSIX_EXACT = new Set<string>(['/', '/root', '/usr']);
const POSIX_TREES: readonly string[] = [
  '/bin',
  '/sbin',
  '/boot',
  '/dev',
  '/etc',
  '/proc',
  '/sys',
  '/lib',
  '/lib64',
  '/usr/bin',
  '/usr/sbin',
  '/usr/lib',
  '/usr/lib64',
  '/usr/libexec',
  '/var/run',
  '/private/etc',
];
const WINDOWS_TREES: readonly string[] = [
  '/windows',
  '/program files',
  '/program files (x86)',
  '/programdata',
];

function isUnder(candidate: string, tree: string): boolean {
  return candidate === tree || candidate.startsWith(`${tree}/`);
}

/**
 * Whether a path is a system directory: a system root itself (`/`, `/usr`, `/root`, a drive
 * root) or anything inside a system tree (`/etc/ssh`, `/usr/bin`, `C:\\Windows\\System32`).
 * Whole-tree blocks stop at the system folders: `/usr/local/src` or `/root/project` stay usable.
 * @public Called with Windows-style paths by tests on every platform.
 */
export function isBlockedSystemPath(candidate: string): boolean {
  if (candidate === '') {
    return false;
  }
  const lowered = candidate.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  const normalized = lowered === '' ? '/' : lowered;
  const drive = /^[a-z]:(\/.*)?$/.exec(normalized);
  if (drive) {
    const rest = drive[1] ?? '/';
    return rest === '/' || WINDOWS_TREES.some((tree) => isUnder(rest, tree));
  }
  return POSIX_EXACT.has(normalized) || POSIX_TREES.some((tree) => isUnder(normalized, tree));
}

function getSensitiveUserDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.ssh'),
    path.join(home, '.aws'),
    path.join(home, '.gnupg'),
    path.join(home, '.azure'),
    path.join(home, '.kube'),
    path.join(home, '.docker'),
  ];
}

/**
 * Validates and canonicalizes a project path, rejecting sensitive system directories,
 * credential stores, and non-directories.
 */
export function validateSafeProjectPath(projectPath: string, operationName: string): string {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error(`[${operationName}] project_path must be a non-empty string.`);
  }

  const resolved = path.resolve(projectPath);

  // 1. Must exist and be a directory
  if (!fs.existsSync(resolved)) {
    throw new Error(`[${operationName}] Target directory does not exist: '${resolved}'.`);
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`[${operationName}] Target path is not a directory: '${resolved}'.`);
  }

  // 2. Resolve canonical realpath to prevent symlink traversal to sensitive areas
  const real = fs.realpathSync(resolved);

  // 3. Block system roots and core system folders (check both resolved path and symlink target)
  const normalized = path.normalize(resolved);
  if (isBlockedSystemPath(normalized) || isBlockedSystemPath(real)) {
    throw new Error(
      `[${operationName}] Security restriction: cannot target system directory '${normalized}'.`,
    );
  }

  // 4. Block sensitive credential stores (~/.ssh, ~/.aws, etc.)
  for (const sensitiveDir of getSensitiveUserDirs()) {
    if (
      normalized === sensitiveDir ||
      normalized.startsWith(`${sensitiveDir}${path.sep}`) ||
      real === sensitiveDir ||
      real.startsWith(`${sensitiveDir}${path.sep}`)
    ) {
      throw new Error(
        `[${operationName}] Security restriction: cannot target credential directory '${sensitiveDir}'.`,
      );
    }
  }

  return real;
}

/**
 * Validates that a target write directory stays safely inside the project root and is not escaped via symlinks.
 */
export function validateSafeWriteTarget(projectRoot: string, targetPath: string): void {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTarget = path.resolve(targetPath);

  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Security restriction: write target '${resolvedTarget}' escapes project root '${resolvedRoot}'.`,
    );
  }

  // Prevent symlink hijacking of parent folders
  let current = resolvedTarget;
  while (current.length >= resolvedRoot.length) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      const real = fs.realpathSync(current);
      const realRel = path.relative(resolvedRoot, real);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error(
          `Security restriction: symlink '${current}' points outside project root to '${real}'.`,
        );
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

// ---------------------------------------------------------------------------------------------
// Reads. The server reads the audited project, its own package files and the user's license
// folder; these helpers return safe defaults instead of throwing where callers expect a probe.

export type DirEntry = fs.Dirent;

export function exists(target: string): boolean {
  return fs.existsSync(target);
}

export function isDirectory(target: string): boolean {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

export function isSymbolicLink(target: string): boolean {
  return fs.lstatSync(target).isSymbolicLink();
}

export function realPath(target: string): string {
  return fs.realpathSync(target);
}

export function fileSize(target: string): number {
  return fs.statSync(target).size;
}

export function readText(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Reads a small text file defensively: only a regular file is opened (a device such as
 * /dev/zero never ends, a named pipe blocks the open), and reading stops one byte past
 * `maxBytes` whatever size the file claims (files under /proc report size 0).
 */
export function readTextBounded(file: string, maxBytes: number): string {
  if (!fs.statSync(file).isFile()) {
    throw new Error('not a regular file');
  }
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
      if (read === 0) {
        break;
      }
      length += read;
    }
    if (length > maxBytes) {
      throw new Error(`file exceeds ${maxBytes} bytes`);
    }
    return buffer.toString('utf8', 0, length);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function listDir(directory: string): string[] {
  return fs.readdirSync(directory);
}

export function listDirEntries(directory: string): DirEntry[] {
  return fs.readdirSync(directory, { withFileTypes: true });
}

// ---------------------------------------------------------------------------------------------
// Writes. Each one checks its target with validateSafeWriteTarget first: a write outside the
// project root, or through a symlink leading outside it, throws before anything is touched.

/**
 * For operations on a directory entry itself (remove, move, unlink): the entry must sit inside
 * root, and the folders above it must not lead outside through a symlink. The entry may itself be
 * a symlink: removing or moving a link never touches what it points to.
 */
function validateEntryInside(root: string, entry: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(entry));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Security restriction: '${entry}' is not inside project root '${root}'.`);
  }
  validateSafeWriteTarget(root, path.dirname(entry));
}

export function makeDirInside(root: string, directory: string): void {
  validateSafeWriteTarget(root, directory);
  fs.mkdirSync(directory, { recursive: true });
}

export function writeTextInside(root: string, file: string, text: string): void {
  validateSafeWriteTarget(root, file);
  fs.writeFileSync(file, text, 'utf8');
}

/** Removes an entry (a symlink is removed as a link; rmSync never follows links). */
export function removeInside(root: string, target: string): void {
  validateEntryInside(root, target);
  fs.rmSync(target, { recursive: true, force: true });
}

/** Removes a symbolic link itself (never what it points to). */
export function unlinkInside(root: string, link: string): void {
  validateEntryInside(root, link);
  fs.unlinkSync(link);
}

/** Moves a directory entry (a symlink moves as a link); both locations must be inside root. */
export function renameInside(root: string, from: string, to: string): void {
  validateEntryInside(root, from);
  validateEntryInside(root, to);
  fs.renameSync(from, to);
}

export function copyDirInside(root: string, from: string, to: string): void {
  validateEntryInside(root, to);
  fs.cpSync(from, to, { recursive: true });
}
