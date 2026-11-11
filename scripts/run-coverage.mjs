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
import { COVERAGE_HELP, wantsHelp } from './cli-help.mjs';

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
    // Command-line shims (argument reading, process.exit, real git/npm/GitHub calls): the --help
    // tests start them, which must not count them. Their logic lives in the *-flow and *-lib
    // modules and in cli-help.mjs, all covered.
    '--test-coverage-exclude=scripts/run-coverage.mjs',
    '--test-coverage-exclude=scripts/release.mjs',
    '--test-coverage-exclude=scripts/github-settings.mjs',
    '--test-coverage-exclude=scripts/check-clean.mjs',
    'tests/**/*.test.ts',
  ];
  // Opt-in only: FREDO_TEST_ISOLATION_NONE=1 on Node 24+ when process isolation skews V8 counts.
  if (major >= 24 && process.env.FREDO_TEST_ISOLATION_NONE === '1') {
    args.splice(1, 0, '--test-isolation=none');
  }
  return args;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain && wantsHelp(process.argv.slice(2))) {
  process.stdout.write(COVERAGE_HELP);
  process.exit(0);
}
if (isMain) {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const args = coverageArgs(major);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', shell: false });
  process.exit(result.status ?? 1);
}
