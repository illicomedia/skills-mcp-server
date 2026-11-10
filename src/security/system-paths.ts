/**
 * System locations a project can never be (pure path logic, no disk access). Paths are compared
 * lower-case with "/" separators, so Windows paths, WSL mounts of Windows drives and
 * case-insensitive filesystems (macOS, Windows) are covered by the same lists.
 */

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
  // macOS
  '/system',
  '/library',
  '/private/etc',
  '/private/var/run',
];
const WINDOWS_TREES: readonly string[] = [
  '/windows',
  '/program files',
  '/program files (x86)',
  '/programdata',
];

/** "c:/x" (Windows) or "/mnt/c/x" (WSL): the drive's path ("/x"), or null for another path. */
const DRIVE_PATH = /^(?:[a-z]:|\/mnt\/[a-z])(\/.*)?$/;

function isUnder(candidate: string, tree: string): boolean {
  return candidate === tree || candidate.startsWith(`${tree}/`);
}

/**
 * Whether a path is a system directory: a system root itself (`/`, `/usr`, `/root`, a drive
 * root) or anything inside a system tree (`/etc/ssh`, `/usr/bin`, `C:\Windows\System32`,
 * `/mnt/c/Windows`). Whole-tree blocks stop at the system folders: `/usr/local/src`,
 * `/root/project` or `/mnt/c/Users/me/project` stay usable.
 */
export function isBlockedSystemPath(candidate: string): boolean {
  if (candidate === '') {
    return false;
  }
  const lowered = candidate.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  const normalized = lowered === '' ? '/' : lowered;
  const drive = DRIVE_PATH.exec(normalized);
  if (drive) {
    const rest = drive[1] ?? '/';
    return rest === '/' || WINDOWS_TREES.some((tree) => isUnder(rest, tree));
  }
  return POSIX_EXACT.has(normalized) || POSIX_TREES.some((tree) => isUnder(normalized, tree));
}
