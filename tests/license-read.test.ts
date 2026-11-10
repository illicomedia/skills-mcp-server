import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { validateLicense } from '../dist/license/license.js';
import { readTextBounded } from '../dist/security/path-guard.js';
import { TEST_LICENSE_OPTIONS } from './license-fixture.ts';

const posix = process.platform !== 'win32';

function withTemp(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-read-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('readTextBounded: a file of exactly the cap is read, one byte more is refused', () => {
  withTemp((dir) => {
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'é'.repeat(4));
    assert.equal(readTextBounded(file, 8), 'éééé');
    assert.throws(() => readTextBounded(file, 7), /exceeds 7 bytes/);
  });
});

test('readTextBounded: a directory is not a regular file', () => {
  withTemp((dir) => {
    assert.throws(() => readTextBounded(dir, 10), /not a regular file/);
  });
});

test('readTextBounded: a missing file keeps its filesystem error', () => {
  assert.throws(() => readTextBounded('/nonexistent/fredo-qa-file', 10), /ENOENT/);
});

test('license path: an endless device is refused instead of exhausting memory', {
  skip: !posix,
}, () => {
  const res = validateLicense('/dev/zero', TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, false);
  assert.equal(res.tier, 'free');
  assert.match(res.message, /not a regular file/);
});

test('license path: a named pipe is refused instead of blocking the server', {
  skip: !posix,
}, () => {
  withTemp((dir) => {
    const fifo = path.join(dir, 'license.json');
    execFileSync('mkfifo', [fifo]);
    const res = validateLicense(fifo, TEST_LICENSE_OPTIONS);
    assert.equal(res.tier, 'free');
    assert.match(res.message, /not a regular file/);
  });
});

test('license path: a /proc file that claims size 0 still obeys the byte cap', {
  skip: process.platform !== 'linux',
}, () => {
  assert.throws(() => readTextBounded('/proc/self/environ', 1), /exceeds 1 bytes/);
});
