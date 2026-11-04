/**
 * Static sets and directory heuristics for code audits.
 * Kept in-memory to prevent disk I/O failure modes and tampering (Security-First approach).
 */

export const DEFAULT_IGNORED_SCAN_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'vendor',
  '.venv',
  'venv',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
]);
