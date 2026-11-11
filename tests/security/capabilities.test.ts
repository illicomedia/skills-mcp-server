import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

/**
 * The capabilities the README and SECURITY.md declare, checked on the built package that ships
 * (dist/), the code supply-chain scanners such as Socket analyse.
 */

const DIST = path.resolve(import.meta.dirname, '..', '..', 'dist');

function shippedCode(): Array<{ file: string; code: string }> {
  return fs
    .readdirSync(DIST, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ file, code: fs.readFileSync(path.join(DIST, file), 'utf8') }));
}

test('Capabilities: no environment access at all', () => {
  const reads = shippedCode().flatMap(({ file, code }) =>
    [...code.matchAll(/process\.env\b(\.[A-Za-z_][A-Za-z0-9_]*)?/g)].map((m) => `${file}: ${m[0]}`),
  );
  assert.deepStrictEqual(reads, []);
});

test('Capabilities: no network, no child processes, no dynamic code', () => {
  const forbidden =
    /from 'node:(http|https|net|tls|dgram|dns|child_process|worker_threads|vm)'|\bfetch\(|\beval\(|new Function\(|\brequire\(/;
  const offenders = shippedCode()
    .filter(({ code }) => forbidden.test(code))
    .map(({ file }) => file);
  assert.deepStrictEqual(offenders, []);
});

test('Capabilities: the only URLs shipped are the declared links shown to people, never fetched', () => {
  const urls = new Set(
    shippedCode().flatMap(({ code }) =>
      [...code.matchAll(/https?:\/\/[^\s'"`)<>\\]+/g)].map((m) => m[0].replace(/[.,]$/, '')),
    ),
  );
  assert.deepStrictEqual([...urls].sort(), [
    'https://www.illicomedia.com/qa-skills/',
    'https://www.illicomedia.com/qa-skills/pricing',
    'https://www.illicomedia.com/qa-skills/skills',
    'https://www.illicomedia.com/schemas/qa-license-v1.schema.json',
  ]);
});

test('Capabilities: only the path guard touches the disk (one audited module)', () => {
  const importers = shippedCode()
    .filter(({ code }) => /from 'node:fs'|from "node:fs"|require\(['"]node:fs['"]\)/.test(code))
    .map(({ file }) => file);
  assert.deepStrictEqual(importers, [path.join('security', 'path-guard.js')]);
});
