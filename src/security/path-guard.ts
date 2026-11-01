import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BLOCKED_EXACT_PATHS = new Set<string>([
  '/',
  '/bin',
  '/sbin',
  '/boot',
  '/dev',
  '/etc',
  '/proc',
  '/sys',
  '/root',
  '/usr',
  '/var/run',
  'C:\\',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
]);

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

  // 2. Block system roots and core system folders
  const normalized = path.normalize(resolved);
  if (BLOCKED_EXACT_PATHS.has(normalized)) {
    throw new Error(
      `[${operationName}] Security restriction: cannot target system directory '${normalized}'.`,
    );
  }

  // 3. Block sensitive credential stores (~/.ssh, ~/.aws, etc.)
  for (const sensitiveDir of getSensitiveUserDirs()) {
    if (normalized === sensitiveDir || normalized.startsWith(`${sensitiveDir}${path.sep}`)) {
      throw new Error(
        `[${operationName}] Security restriction: cannot target credential directory '${sensitiveDir}'.`,
      );
    }
  }

  return resolved;
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
