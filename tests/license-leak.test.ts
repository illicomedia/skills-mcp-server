import * as assert from 'node:assert';
import test from 'node:test';
import { LICENSE_SCHEMA_VERSION, validateLicense } from '../dist/license/license.js';
import { licenseBody, signedLicense, TEST_LICENSE_OPTIONS } from './license-fixture.ts';

const SECRET = 'S3CR3T-do-not-echo';

function message(source: string): string {
  const result = validateLicense(source, TEST_LICENSE_OPTIONS);
  assert.equal(result.valid, false);
  assert.equal(result.tier, 'free');
  return result.message;
}

test('license errors: an unknown field name from the file is not echoed', () => {
  const text = JSON.stringify({ ...licenseBody(), [SECRET]: 'x', signature: 'AAAA' });
  const msg = message(text);
  assert.doesNotMatch(msg, new RegExp(SECRET));
  assert.match(msg, /not supported/);
});

test('license errors: an untrusted key id value from the file is not echoed', () => {
  const text = signedLicense({ key_id: SECRET });
  const msg = message(text);
  assert.doesNotMatch(msg, new RegExp(SECRET));
  assert.match(msg, /not trusted/);
});

test('license errors: a newer format version number from the file is not echoed', () => {
  const version = LICENSE_SCHEMA_VERSION + 4242;
  const msg = message(JSON.stringify({ ...licenseBody(), schema_version: version }));
  assert.doesNotMatch(msg, new RegExp(String(version)));
  assert.match(msg, /newer MCP server/);
});

test('license errors: a wrong $schema value from the file is not echoed', () => {
  const msg = message(JSON.stringify({ ...licenseBody(), $schema: `https://${SECRET}.example` }));
  assert.doesNotMatch(msg, new RegExp(SECRET));
  assert.match(msg, /\$schema/);
});
