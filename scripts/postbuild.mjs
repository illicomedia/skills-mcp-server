#!/usr/bin/env node

/**
 * Runs after `tsc`. Makes the build owner-writable (some mounted file systems hand out read-only
 * files, which breaks the next build) and the CLI entry executable. No-op on Windows, where
 * npm creates .cmd shims instead.
 */

import { chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

function makeWritable(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    const { mode } = stats;
    if (stats.isDirectory()) {
      chmodSync(path, mode | 0o700);
      makeWritable(path);
    } else {
      chmodSync(path, mode | 0o600);
    }
  }
}

if (process.platform !== 'win32') {
  makeWritable(DIST);
  chmodSync(join(DIST, 'index.js'), 0o755);
}
