import * as path from 'node:path';
import { exists, fileSize } from '../security/path-guard.js';

/**
 * Pre-flight License Security Lock (Rule 7): the server refuses to run without a non-empty
 * LICENSE file in the working directory or in its own package directory.
 * Returns null when the lock is satisfied, otherwise why it is not.
 */
export function licenseLockProblem(cwd: string, packageDir: string): string | null {
  const present = [cwd, packageDir].some((dir) => {
    const file = path.join(dir, 'LICENSE');
    return exists(file) && fileSize(file) > 0;
  });
  return present
    ? null
    : 'License Pre-Flight Security Lock failed: missing or empty LICENSE file. Halting execution.';
}
