// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { coverageArgs } from '../scripts/run-coverage.mjs';

test('package.json test:coverage goes through run-coverage.mjs (no raw Node flags)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts['test:coverage'], 'node scripts/run-coverage.mjs');
  assert.doesNotMatch(pkg.scripts['test:coverage'], /test-isolation/);
});

test('coverage argv never passes --test-isolation=none on Node 22', () => {
  const prev = process.env.FREDO_TEST_ISOLATION_NONE;
  process.env.FREDO_TEST_ISOLATION_NONE = '1';
  try {
    assert.ok(!coverageArgs(22).includes('--test-isolation=none'));
    assert.ok(coverageArgs(24).includes('--test-isolation=none'));
  } finally {
    if (prev === undefined) {
      delete process.env.FREDO_TEST_ISOLATION_NONE;
    } else {
      process.env.FREDO_TEST_ISOLATION_NONE = prev;
    }
  }
});
