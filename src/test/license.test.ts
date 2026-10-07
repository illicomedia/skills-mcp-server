// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { canonicalJson, validateLicense } from '../license.js';
import { TRUSTED_LICENSE_KEYS } from '../license-keys.js';
import {
  TEST_LICENSE_OPTIONS,
  licenseBody,
  signLicense,
  signedLicense,
} from './license-fixture.js';

test('License: no license source runs in free mode', () => {
  const res = validateLicense(undefined, TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, false);
  assert.equal(res.tier, 'free');
  assert.equal(res.keyType, 'none');
  assert.equal(res.fallbackMode, true);
});

test('License: a correctly signed pro license unlocks pro', () => {
  const res = validateLicense(signedLicense(), TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, true);
  assert.equal(res.tier, 'pro');
  assert.equal(res.keyType, 'signed');
  assert.equal(res.customerName, 'Example SAS');
  assert.equal(res.licenseId, 'LIC-2026-000123');
  assert.equal(res.updatesUntil, '2027-10-01T00:00:00Z');
});

test('License: a correctly signed enterprise license unlocks enterprise', () => {
  const res = validateLicense(signedLicense({ tier: 'enterprise' }), TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, true);
  assert.equal(res.tier, 'enterprise');
});

test('License: legacy prefix keys no longer unlock anything', () => {
  for (const key of [
    'fqa_live_ent_bigcorp_7fffffff_abcdef123456',
    'fqa_live_pro_acme_7fffffff_abcdef123456',
    'fqa_test_anything',
  ]) {
    const res = validateLicense(key, TEST_LICENSE_OPTIONS);
    assert.equal(res.valid, false, key);
    assert.equal(res.tier, 'free', key);
  }
});

test('License: a tampered field invalidates the signature', () => {
  const tampered = JSON.parse(signedLicense()) as Record<string, unknown>;
  tampered.tier = 'enterprise';
  const res = validateLicense(JSON.stringify(tampered), TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, false);
  assert.equal(res.tier, 'free');
  assert.match(res.message, /signature/i);
});

test('License: an extended updates_until is rejected as tampering', () => {
  const tampered = JSON.parse(signedLicense()) as Record<string, unknown>;
  tampered.updates_until = '2099-01-01T00:00:00Z';
  assert.equal(validateLicense(JSON.stringify(tampered), TEST_LICENSE_OPTIONS).valid, false);
});

test('License: a license signed by an untrusted key is rejected', () => {
  const { privateKey: rogue } = crypto.generateKeyPairSync('ed25519');
  const res = validateLicense(signLicense(licenseBody(), rogue), TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, false);
  assert.match(res.message, /signature/i);
});

test('License: an unknown key id is rejected', () => {
  const res = validateLicense(signedLicense({ key_id: 'other' }), TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, false);
  assert.match(res.message, /key id/i);
});

test('License: a build released after updates_until runs in free mode', () => {
  const res = validateLicense(signedLicense({ updates_until: '2026-10-06T23:59:59Z' }), {
    ...TEST_LICENSE_OPTIONS,
  });
  assert.equal(res.valid, false);
  assert.equal(res.isExpired, true);
  assert.equal(res.tier, 'free');
});

test('License: retention does not depend on the current date', () => {
  const res = validateLicense(signedLicense({ updates_until: '2026-10-07T00:00:00Z' }), {
    ...TEST_LICENSE_OPTIONS,
    releaseDate: '2026-10-07T00:00:00Z',
  });
  assert.equal(res.valid, true);
});

test('License: malformed documents are rejected without throwing', () => {
  for (const source of ['{', '{"tier":"pro"}', '[]', signedLicense({ seats: 0 })]) {
    const res = validateLicense(source, TEST_LICENSE_OPTIONS);
    assert.equal(res.valid, false, source);
    assert.equal(res.tier, 'free', source);
  }
});

test('License: unsupported binding kinds are rejected', () => {
  const res = validateLicense(
    signedLicense({ binding: { kind: 'github_org', org: 'x' } }),
    TEST_LICENSE_OPTIONS,
  );
  assert.equal(res.valid, false);
  assert.match(res.message, /binding/i);
});

test('License: discovery order is env file, user config, then project file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-license-'));
  try {
    const home = path.join(dir, 'home');
    const project = path.join(dir, 'project');
    fs.mkdirSync(path.join(home, '.config', 'fredo-qa'), { recursive: true });
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, '.qa-license.json'), signedLicense({ licensee: 'P' }));
    const base = { ...TEST_LICENSE_OPTIONS, homeDir: home, projectRoot: project };
    assert.equal(validateLicense(undefined, base).customerName, 'P');

    fs.writeFileSync(
      path.join(home, '.config', 'fredo-qa', 'license.json'),
      signedLicense({ licensee: 'U' }),
    );
    assert.equal(validateLicense(undefined, base).customerName, 'U');

    const envFile = path.join(dir, 'env-license.json');
    fs.writeFileSync(envFile, signedLicense({ licensee: 'E' }));
    const withEnv = { ...base, env: { FREDO_QA_LICENSE_FILE: envFile } };
    assert.equal(validateLicense(undefined, withEnv).customerName, 'E');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('License: an explicit path to a license file is accepted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-license-'));
  try {
    const file = path.join(dir, 'license.json');
    fs.writeFileSync(file, signedLicense());
    assert.equal(validateLicense(file, TEST_LICENSE_OPTIONS).valid, true);
    assert.equal(validateLicense(path.join(dir, 'missing.json'), TEST_LICENSE_OPTIONS).valid, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('License: canonical JSON sorts keys recursively and drops whitespace', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null } }), '{"a":{"c":null,"d":[1,"x"]},"b":1}');
});

test('License: release builds embed only public keys and no test keys', () => {
  for (const pem of Object.values(TRUSTED_LICENSE_KEYS)) {
    assert.equal(crypto.createPublicKey(pem).asymmetricKeyType, 'ed25519');
    assert.doesNotMatch(pem, /PRIVATE/);
  }
  const source = fs.readFileSync(new URL('../license.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fqa_test_|fqa_live_/);
});
