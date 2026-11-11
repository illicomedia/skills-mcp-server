import * as assert from 'node:assert';
import test, { describe } from 'node:test';
import { LICENSE_SCHEMA_VERSION, validateLicense } from '../../dist/license/license.js';
import { licenseBody, signedLicense, TEST_LICENSE_OPTIONS } from '../helpers/license-fixture.ts';

describe('license › license-leak', () => {
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

  const FIELDS = [
    'license_id',
    'licensee',
    'contact',
    'issued_at',
    'updates_until',
    'key_id',
    'signature',
    'tier',
    'seats',
    'schema_version',
    '$schema',
  ] as const;

  test('license errors: no field of an unsigned document is ever echoed, whatever its value', () => {
    for (const field of FIELDS) {
      for (const value of [SECRET, 7, true, null, [SECRET], { [SECRET]: SECRET }]) {
        const text = JSON.stringify({ ...licenseBody(), [field]: value });
        const result = validateLicense(text, TEST_LICENSE_OPTIONS);
        assert.equal(result.valid, false, `${field}=${JSON.stringify(value)}`);
        assert.doesNotMatch(
          result.message,
          new RegExp(SECRET),
          `${field}=${JSON.stringify(value)}`,
        );
      }
    }
  });

  test('license errors: no binding content is echoed', () => {
    for (const binding of [
      { kind: SECRET },
      { kind: 'none', [SECRET]: 1 },
      SECRET,
      [SECRET],
      null,
    ]) {
      const result = validateLicense(
        JSON.stringify({ ...licenseBody(), binding }),
        TEST_LICENSE_OPTIONS,
      );
      assert.equal(result.valid, false);
      assert.doesNotMatch(result.message, new RegExp(SECRET));
    }
  });

  test('license errors: unknown key names of every shape are not echoed', () => {
    const names = [
      SECRET,
      `${SECRET}\n`,
      '__proto__',
      'constructor',
      '\u202Eevil',
      'x'.repeat(200_000),
    ];
    for (const name of names) {
      const text = `{"schema_version":1,${JSON.stringify(name)}:1}`;
      const result = validateLicense(
        text.length > 60_000 ? text.slice(0, 60_000) : text,
        TEST_LICENSE_OPTIONS,
      );
      assert.equal(result.valid, false);
      assert.doesNotMatch(result.message, new RegExp(SECRET));
      assert.ok(result.message.length < 400, 'message stays short');
    }
  });

  test('license errors: a file that is not a license echoes nothing about its content', () => {
    for (const text of [
      `{"${SECRET}": "${SECRET}"}`,
      `["${SECRET}"]`,
      `"${SECRET}"`,
      SECRET,
      `{"schema_version":1,"${SECRET}":2,`,
      `{"schema_version":"${SECRET}"}`,
      `{"schema_version":1,"$schema":"${SECRET}"}`,
    ]) {
      const result = validateLicense(
        text.startsWith('{') ? text : `{${text}`,
        TEST_LICENSE_OPTIONS,
      );
      assert.equal(result.valid, false);
      assert.doesNotMatch(result.message, new RegExp(SECRET), text);
    }
  });

  test('license errors: a signed license from an untrusted key echoes neither key id nor licensee', () => {
    const result = validateLicense(
      signedLicense({ key_id: SECRET, licensee: `${SECRET}-licensee` }),
      TEST_LICENSE_OPTIONS,
    );
    assert.equal(result.valid, false);
    assert.doesNotMatch(result.message, new RegExp(SECRET));
    assert.equal(result.customerName, undefined);
  });

  test('license errors: a tampered signed license reveals nothing of the file either', () => {
    const doc = JSON.parse(signedLicense());
    doc.licensee = `${SECRET}-tampered`;
    const result = validateLicense(JSON.stringify(doc), TEST_LICENSE_OPTIONS);
    assert.equal(result.valid, false);
    assert.doesNotMatch(result.message, new RegExp(SECRET));
    assert.equal(result.customerName, undefined);
    assert.equal(result.licenseId, undefined);
  });
});
