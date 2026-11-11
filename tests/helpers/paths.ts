import * as path from 'node:path';

/**
 * The repository root, from this file's location: tests must not depend on the folder they are
 * started from (an IDE, a sub-folder, a script all start node --test elsewhere).
 */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** A file of the built package, by its path inside dist/. */
export function distFile(rel: string): string {
  return path.join(REPO_ROOT, 'dist', rel);
}
