import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { validateLicense } from '../../dist/license/license.js';
import { FredoQaMcpServer } from '../../dist/server/server.js';
import { signedLicense, TEST_LICENSE_OPTIONS } from '../helpers/license-fixture.ts';
import { callToolText, withTempDir } from '../helpers/mcp-fixture.ts';

/**
 * A license path passed by the caller (set_license_key, verify_license, license_key arguments)
 * must not tell an agent anything about a file that is not a valid license: whether it exists,
 * is a folder, a device, too large, JSON, an object, license-shaped or signed by another key.
 */

const posix = process.platform !== 'win32';

/** Every kind of path that is not a usable license, built under `dir`. */
function unusablePaths(dir: string): Record<string, string> {
  const write = (name: string, content: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };
  const doc = JSON.parse(signedLicense());
  const paths: Record<string, string> = {
    missing: path.join(dir, 'missing.json'),
    'missing folder': path.join(dir, 'nope', 'license.json'),
    folder: dir,
    empty: write('empty.json', ''),
    'not JSON': write('text.json', 'hello'),
    'JSON array': write('array.json', '[1]'),
    'JSON string': write('string.json', '"x"'),
    'other JSON object': write('package.json', '{"name":"app","version":"1.0.0"}'),
    'license-shaped, wrong schema version': write(
      'v9.json',
      JSON.stringify({ ...doc, schema_version: 9 }),
    ),
    'license-shaped, unknown field': write('extra.json', JSON.stringify({ ...doc, extra: 1 })),
    'tampered license': write('tampered.json', JSON.stringify({ ...doc, tier: 'enterprise' })),
    'untrusted key': write('untrusted.json', signedLicense({ key_id: 'other-key' })),
    'too large': write('big.json', `${signedLicense()}${' '.repeat(70_000)}`),
  };
  if (posix) {
    paths.device = '/dev/zero';
    paths['null device'] = '/dev/null';
    const fifo = path.join(dir, 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    paths['named pipe'] = fifo;
    if (process.getuid?.() !== 0) {
      paths.unreadable = write('locked.json', signedLicense());
      fs.chmodSync(paths.unreadable, 0o000);
    }
  }
  return paths;
}

test('caller path: every unusable path gets the same answer, free tier', () => {
  withTempDir('fqa-oracle-', (dir) => {
    const results = Object.entries(unusablePaths(dir)).map(([label, file]) => {
      const res = validateLicense(file, TEST_LICENSE_OPTIONS);
      assert.equal(res.valid, false, label);
      assert.equal(res.tier, 'free', label);
      assert.equal(res.isExpired, false, label);
      assert.equal(res.customerName, undefined, label);
      assert.equal(res.licenseId, undefined, label);
      return res.message;
    });
    assert.equal(new Set(results).size, 1, [...new Set(results)].join('\n'));
    assert.match(results[0], /could not be used/);
    assert.match(results[0], /~\/\.config\/fredo-qa\/license\.json/);
  });
});

test('caller path: the uniform answer never repeats the path or anything from the file', () => {
  withTempDir('fqa-oracle-SECRETDIR-', (dir) => {
    const file = path.join(dir, 'SECRETNAME.json');
    fs.writeFileSync(file, '{"SECRETKEY": "SECRETVALUE"}');
    const res = validateLicense(file, TEST_LICENSE_OPTIONS);
    assert.doesNotMatch(res.message, /SECRET/);
  });
});

test('caller path: a valid license still verifies and an expired one still says so', () => {
  withTempDir('fqa-oracle-', (dir) => {
    const valid = path.join(dir, 'license.json');
    fs.writeFileSync(valid, signedLicense());
    assert.equal(validateLicense(valid, TEST_LICENSE_OPTIONS).valid, true);
    assert.equal(validateLicense(`  ${valid}  `, TEST_LICENSE_OPTIONS).valid, true);

    const expired = path.join(dir, 'expired.json');
    fs.writeFileSync(expired, signedLicense({ updates_until: '2026-01-01T00:00:00Z' }));
    const res = validateLicense(expired, TEST_LICENSE_OPTIONS);
    assert.equal(res.isExpired, true);
    assert.match(res.message, /covers releases up to/);
  });
});

test('inline JSON keeps its detailed reasons (the caller already holds the content)', () => {
  const doc = JSON.parse(signedLicense());
  const messages = [
    '{',
    '{}',
    JSON.stringify({ ...doc, extra: 1 }),
    JSON.stringify({ ...doc, tier: 'enterprise' }),
    signedLicense({ key_id: 'other-key' }),
  ].map((text) => validateLicense(text, TEST_LICENSE_OPTIONS).message);
  assert.equal(new Set(messages).size, messages.length);
  assert.ok(messages.every((m) => !/could not be used/.test(m)));
});

test("the fixed discovery locations keep their detailed reasons (the user's own files)", () => {
  withTempDir('fqa-oracle-home-', (home) => {
    fs.mkdirSync(path.join(home, '.config', 'fredo-qa'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'fredo-qa', 'license.json'), 'not json');
    const res = validateLicense(undefined, { ...TEST_LICENSE_OPTIONS, homeDir: home });
    assert.match(res.message, /not valid JSON/);
  });
  withTempDir('fqa-oracle-project-', (project) => {
    fs.writeFileSync(path.join(project, '.qa-license.json'), '[]');
    const res = validateLicense(undefined, { ...TEST_LICENSE_OPTIONS, projectRoot: project });
    assert.match(res.message, /JSON object/);
  });
});

test('MCP tools: set_license_key and verify_license answer the same for any unusable path', () => {
  withTempDir('fqa-oracle-mcp-', (dir) => {
    const server = new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS);
    const answers = new Set<string>();
    for (const file of Object.values(unusablePaths(dir))) {
      for (const tool of ['set_license_key', 'verify_license']) {
        const answer = JSON.parse(callToolText(server, tool, { license_key: file }));
        answers.add(`${tool}:${answer.message}`);
      }
    }
    assert.equal(answers.size, 2, [...answers].join('\n'));
  });
});
