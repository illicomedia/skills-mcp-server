import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { validateSafeProjectPath } from '../dist/security/path-guard.js';

// A home of our own: os.homedir() reads HOME (USERPROFILE on Windows) at each call.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-cred-home-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
before(() => {
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});
after(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

const STORES = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.azure',
  '.kube',
  '.docker',
  '.config/gcloud',
  '.config/gh',
  '.password-store',
  '.oci',
  'Library/Keychains',
];

function dir(rel: string): string {
  const full = path.join(fakeHome, rel);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

for (const store of STORES) {
  test(`credential store ~/${store}: the folder, a sub-folder and a link to it are refused`, () => {
    const target = dir(store);
    const nested = dir(path.join(store, 'nested', 'deeper'));
    const link = path.join(fakeHome, `link-${store.replace(/\W/g, '_')}`);
    fs.symlinkSync(target, link);
    for (const candidate of [target, nested, link, `${target}/`, path.join(nested, '..')]) {
      assert.throws(
        () => validateSafeProjectPath(candidate, 'op'),
        /cannot target credential directory/,
        candidate,
      );
    }
  });
}

test('credential stores: look-alike folders next to them stay usable', () => {
  for (const rel of [
    '.sshx',
    '.ssh-backup-notes',
    '.config/other',
    '.config/ghostty',
    '.config/gcloud-docs',
    'Library/Other',
    'Library/KeychainsNotes',
    '.password-store-docs',
    'projects/.ssh-lookalike',
    'projects/app/.aws-docs',
  ]) {
    const target = dir(rel);
    assert.equal(validateSafeProjectPath(target, 'op'), fs.realpathSync(target), rel);
  }
});

test('credential stores: the error names the store and the operation', () => {
  const target = dir('.config/gh');
  assert.throws(
    () => validateSafeProjectPath(target, 'quick_check'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('[quick_check]') &&
      error.message.includes(path.join(fakeHome, '.config', 'gh')),
  );
});
