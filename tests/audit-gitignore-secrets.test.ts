import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { auditCheckPassed, gitAvailable, gitIgnores, repo, writeFiles } from './git-fixture.ts';

/**
 * Differential tests of the .env and private-key checks against git: the audit may warn when git
 * would ignore a secret (fail closed), never report it ignored when git would commit it.
 */

const ENV_CHECK = '.gitignore mentions .env';
const KEY_CHECK = 'private key and secret hygiene in .gitignore';
const BOM = String.fromCharCode(0xfeff);

/** [gitignore content, must the audit agree exactly with git?] */
const ENV: [string, boolean][] = [
  ['.env\n', true],
  ['.env*\n', true],
  ['*.env\n', true],
  ['.env.*\n', true],
  ['.env/\n', true],
  ['/.env\n', true],
  ['**/.env\n', true],
  [' .env\n', true],
  ['.env\t\n', true],
  ['.env   \n', true],
  [`${BOM}.env\r\n`, true],
  ['.env\n!.env\n', true],
  ['*\n!.env\n', true],
  ['.env.local\n', true],
  ['!.env\n', true],
  ['#.env\n', true],
  ['secrets/.env\n', true],
  ['.ENV\n', false],
  ['[.]env\n', false],
  ['', true],
];

/** A nested key file, so folder rules count: [gitignore content, exact?] */
const NESTED_KEY: [string, boolean][] = [
  ['*.key\n', true],
  ['*.pem\n', true],
  ['certs/\n', true],
  ['/certs/\n', true],
  ['certs\n', true],
  ['/certs\n', true],
  ['**/certs/\n', true],
  ['cert?/\n', true],
  ['server.key\n', true],
  ['/server.key\n', true],
  ['**/*.key\n', true],
  [' *.key\n', true],
  ['*.key\t\n', true],
  ['*.key\n!server.key\n', true],
  ['certs/\n!certs/\n', true],
  ['*\n', true],
  ['*.KEY\n', true],
  ['certs/*.key\n', false],
  ['*.key\n!*.KEY\n', false],
  ['certs/\n!certs/server.key\n', false],
  ['certs/\n!server.key\n', false],
  ['', true],
];

/** A key at the project root: [gitignore content, exact?] */
const ROOT_KEY: [string, boolean][] = [
  ['id_rsa\n', true],
  ['id_*\n', true],
  ['/id_rsa\n', true],
  ['id_rsa/\n', true],
  ['*.pem\n', true],
  ['id_rsa\n!id_*\n', true],
];

function differential(
  label: string,
  corpus: [string, boolean][],
  files: Record<string, string>,
  probe: string,
  check: string,
): void {
  for (const ignoreCase of [false, true]) {
    for (const [content, exact] of corpus) {
      test(`${label} vs git (ignorecase=${ignoreCase}): ${JSON.stringify(content)}`, {
        skip: !gitAvailable,
      }, () => {
        const dir = repo();
        writeFiles(dir, { ...files, '.gitignore': content });
        const gitSays = gitIgnores(dir, probe, ignoreCase);
        const ours = auditCheckPassed(dir, check);
        assert.ok(!(ours && !gitSays), 'audit says ignored but git would commit the secret');
        if (exact && !ignoreCase) {
          assert.equal(ours, gitSays);
        }
      });
    }
  }
}

differential('.env', ENV, { '.env': 'SECRET=1' }, '.env', ENV_CHECK);
differential('nested key', NESTED_KEY, { 'certs/server.key': 'k' }, 'certs/server.key', KEY_CHECK);
differential('root key', ROOT_KEY, { id_rsa: 'k' }, 'id_rsa', KEY_CHECK);

test('private keys: one committed key file fails the check even when another is ignored', {
  skip: !gitAvailable,
}, () => {
  const dir = repo();
  writeFiles(dir, { 'certs/a.key': 'k', 'b.pem': 'k', '.gitignore': '*.key\n' });
  assert.equal(gitIgnores(dir, 'certs/a.key', false), true);
  assert.equal(gitIgnores(dir, 'b.pem', false), false);
  assert.equal(auditCheckPassed(dir, KEY_CHECK), false);
});

test('.env: a parent .gitignore counts, its anchored rules do not', { skip: !gitAvailable }, () => {
  for (const [content, expected] of [
    ['.env\n', true],
    ['/.env\n', false],
    ['.env\n!/.env\n', true],
  ] as const) {
    const top = repo();
    writeFiles(top, { '.gitignore': content, 'child/.env': 'S=1', 'child/package.json': '{}' });
    assert.equal(gitIgnores(top, 'child/.env', false), expected, content);
    assert.equal(auditCheckPassed(path.join(top, 'child'), ENV_CHECK), expected, content);
  }
});

test('all .gitignore checks together read a huge file and many key files in time', () => {
  const dir = repo();
  const files: Record<string, string> = {
    '.env': 'S=1',
    '.qa-license.json': '{}',
    '.gitignore': `${'build-output-*/\n'.repeat(200_000)}.env\n*.key\n.qa-license.json\n`,
  };
  for (let i = 0; i < 200; i += 1) {
    files[`certs/k${i}.key`] = 'k';
  }
  writeFiles(dir, files);
  const started = Date.now();
  assert.equal(auditCheckPassed(dir, ENV_CHECK), true);
  assert.equal(auditCheckPassed(dir, KEY_CHECK), true);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});
