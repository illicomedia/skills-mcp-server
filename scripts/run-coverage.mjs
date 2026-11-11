#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/**
 * Single entry for `pnpm test:coverage`. Builds Node's test argv so CI#31 cannot recur:
 * `--test-isolation=none` is only added on Node >= 24 (unsupported on 22 → "bad option").
 * Coverage quirks on 22 are handled via tsconfig `useDefineForClassFields: false`, not that flag.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @param {number} major */
export function coverageArgs(major) {
  const args = [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-lines=100',
    '--test-coverage-branches=100',
    '--test-coverage-functions=100',
    '--test-coverage-exclude=tests/**',
    '--test-coverage-exclude=**/fqa-*/**',
    // The runner is a CLI shim; do not count its process.exit path against product coverage.
    '--test-coverage-exclude=scripts/run-coverage.mjs',
    'tests/**/*.test.ts',
  ];
  // Opt-in only: FREDO_TEST_ISOLATION_NONE=1 on Node 24+ when process isolation skews V8 counts.
  if (major >= 24 && process.env.FREDO_TEST_ISOLATION_NONE === '1') {
    args.splice(1, 0, '--test-isolation=none');
  }
  return args;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const args = coverageArgs(major);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', shell: false });
  process.exit(result.status ?? 1);
}
