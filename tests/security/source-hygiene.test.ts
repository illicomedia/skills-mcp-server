import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

/**
 * Invisible and bidirectional characters make code read differently from how it runs
 * ("Trojan Source", CVE-2021-42574). Sources must spell them as escapes (backslash-u and the code point).
 */
const FORBIDDEN = new Map<number, string>([
  [0x0000, 'NUL'],
  [0x00a0, 'no-break space'],
  [0x200b, 'zero-width space'],
  [0x200c, 'zero-width non-joiner'],
  [0x200d, 'zero-width joiner'],
  [0x200e, 'left-to-right mark'],
  [0x200f, 'right-to-left mark'],
  [0x202a, 'left-to-right embedding'],
  [0x202b, 'right-to-left embedding'],
  [0x202c, 'pop directional formatting'],
  [0x202d, 'left-to-right override'],
  [0x202e, 'right-to-left override'],
  [0x2066, 'left-to-right isolate'],
  [0x2067, 'right-to-left isolate'],
  [0x2068, 'first strong isolate'],
  [0x2069, 'pop directional isolate'],
  [0xfeff, 'byte order mark'],
]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'fixtures' ? [] : sourceFiles(full);
    }
    return /\.(ts|mts|mjs|js|json)$/.test(entry.name) ? [full] : [];
  });
}

test('sources contain no invisible or bidirectional characters', () => {
  const files = ['src', 'tests', 'scripts'].flatMap(sourceFiles);
  assert.ok(files.length > 20);
  const found: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const char of line) {
        const name = FORBIDDEN.get(char.codePointAt(0) as number);
        if (name) {
          found.push(`${file}:${index + 1} ${name}`);
        }
      }
    });
  }
  assert.deepEqual(found, []);
});
