import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { validateLicense } from '../../dist/license/license.js';
import { readTextBounded } from '../../dist/security/path-guard.js';
import { signedLicense, TEST_LICENSE_OPTIONS } from '../helpers/license-fixture.ts';
import { withTempDir as withTemp } from '../helpers/mcp-fixture.ts';

const posix = process.platform !== 'win32';

test('readTextBounded: a file of exactly the cap is read, one byte more is refused', () => {
  withTemp('fredo-qa-read-', (dir) => {
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'é'.repeat(4));
    assert.equal(readTextBounded(file, 8), 'éééé');
    assert.throws(() => readTextBounded(file, 7), /exceeds 7 bytes/);
  });
});

test('readTextBounded: a directory is not a regular file', () => {
  withTemp('fredo-qa-read-', (dir) => {
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
  withTemp('fredo-qa-read-', (dir) => {
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

const CAP = 64 * 1024;

function padded(totalBytes: number): string {
  const license = signedLicense();
  return license + ' '.repeat(totalBytes - Buffer.byteLength(license));
}

test('license file: a valid license padded to exactly 64 KB is accepted, one byte more is not', () => {
  withTemp('fredo-qa-read-', (dir) => {
    const file = path.join(dir, 'license.json');
    fs.writeFileSync(file, padded(CAP));
    assert.equal(validateLicense(file, TEST_LICENSE_OPTIONS).valid, true);
    fs.writeFileSync(file, padded(CAP + 1));
    const res = validateLicense(file, TEST_LICENSE_OPTIONS);
    assert.equal(res.valid, false);
    assert.match(res.message, /exceeds 65536 bytes/);
  });
});

test('license inline: the same cap applies to JSON passed as text', () => {
  assert.equal(validateLicense(padded(CAP), TEST_LICENSE_OPTIONS).valid, true);
  const res = validateLicense(padded(CAP + 1), TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, false);
  assert.match(res.message, /exceeds 65536 bytes/);
});

test('license inline: a megabyte of text is refused quickly, not parsed', () => {
  const started = Date.now();
  const res = validateLicense(`{"a":"${'x'.repeat(1024 * 1024)}"}`, TEST_LICENSE_OPTIONS);
  assert.equal(res.valid, false);
  assert.match(res.message, /exceeds 65536 bytes/);
  assert.ok(Date.now() - started < 1000);
});

test('license file: zero bytes, whitespace, a doubled or misplaced BOM and NUL bytes are free tier', () => {
  withTemp('fredo-qa-read-', (dir) => {
    for (const [name, content] of Object.entries({
      empty: '',
      blank: ' \n\t ',
      'two byte order marks': `\uFEFF\uFEFF${signedLicense()}`,
      'byte order mark inside': `${signedLicense().slice(0, 1)}\uFEFF${signedLicense().slice(1)}`,
      nul: `${signedLicense()}\u0000`,
      truncated: signedLicense().slice(0, 60),
      doubled: signedLicense() + signedLicense(),
    })) {
      const file = path.join(dir, `${name}.json`);
      fs.writeFileSync(file, content);
      const res = validateLicense(file, TEST_LICENSE_OPTIONS);
      assert.equal(res.valid, false, name);
      assert.equal(res.tier, 'free', name);
    }
  });
});

test('license file: a symlink to a regular license works, a dangling or device link does not', () => {
  withTemp('fredo-qa-read-', (dir) => {
    const real = path.join(dir, 'real.json');
    fs.writeFileSync(real, signedLicense());
    const link = path.join(dir, 'link.json');
    fs.symlinkSync(real, link);
    assert.equal(validateLicense(link, TEST_LICENSE_OPTIONS).valid, true);

    const dangling = path.join(dir, 'dangling.json');
    fs.symlinkSync(path.join(dir, 'missing.json'), dangling);
    assert.equal(validateLicense(dangling, TEST_LICENSE_OPTIONS).valid, false);

    if (posix) {
      const device = path.join(dir, 'device.json');
      fs.symlinkSync('/dev/zero', device);
      assert.match(validateLicense(device, TEST_LICENSE_OPTIONS).message, /not a regular file/);
    }
  });
});

test('license file: /dev/null, /dev/random and /dev/stdin-like devices are refused', {
  skip: !posix,
}, () => {
  for (const device of ['/dev/null', '/dev/random', '/dev/urandom', '/dev/full']) {
    if (fs.existsSync(device)) {
      const res = validateLicense(device, TEST_LICENSE_OPTIONS);
      assert.equal(res.valid, false, device);
      assert.match(res.message, /not a regular file/, device);
    }
  }
});

test('license file: an unreadable file is free tier with a read error, not a crash', {
  skip: !posix || process.getuid?.() === 0,
}, () => {
  withTemp('fredo-qa-read-', (dir) => {
    const file = path.join(dir, 'license.json');
    fs.writeFileSync(file, signedLicense(), { mode: 0o000 });
    const res = validateLicense(file, TEST_LICENSE_OPTIONS);
    assert.equal(res.valid, false);
    assert.match(res.message, /could not be read/);
  });
});

test('license file: a path with spaces, accents and trailing whitespace in the argument', () => {
  withTemp('fredo-qa-read-', (dir) => {
    const file = path.join(dir, 'ma licence é.json');
    fs.writeFileSync(file, signedLicense());
    assert.equal(validateLicense(file, TEST_LICENSE_OPTIONS).valid, true);
    assert.equal(validateLicense(`  ${file}\n`, TEST_LICENSE_OPTIONS).valid, true);
  });
});

test('license discovery: an existing but invalid user file wins over a valid project file', () => {
  withTemp('fredo-qa-read-', (home) => {
    withTemp('fredo-qa-read-', (project) => {
      fs.mkdirSync(path.join(home, '.config', 'fredo-qa'), { recursive: true });
      fs.writeFileSync(path.join(home, '.config', 'fredo-qa', 'license.json'), '');
      fs.writeFileSync(path.join(project, '.qa-license.json'), signedLicense());
      const res = validateLicense(undefined, {
        ...TEST_LICENSE_OPTIONS,
        homeDir: home,
        projectRoot: project,
      });
      assert.equal(res.valid, false);
      assert.match(res.message, /not valid JSON/);
    });
  });
});

test('license discovery: a device or FIFO at the discovery location cannot hang or crash it', {
  skip: !posix,
}, () => {
  withTemp('fredo-qa-read-', (home) => {
    withTemp('fredo-qa-read-', (project) => {
      execFileSync('mkfifo', [path.join(project, '.qa-license.json')]);
      const res = validateLicense(undefined, {
        ...TEST_LICENSE_OPTIONS,
        homeDir: home,
        projectRoot: project,
      });
      assert.equal(res.valid, false);
      assert.match(res.message, /not a regular file/);
    });
  });
});

test('readTextBounded: a zero cap accepts an empty file only', () => {
  withTemp('fredo-qa-read-', (dir) => {
    const file = path.join(dir, 'a');
    fs.writeFileSync(file, '');
    assert.equal(readTextBounded(file, 0), '');
    fs.writeFileSync(file, 'x');
    assert.throws(() => readTextBounded(file, 0), /exceeds 0 bytes/);
  });
});

test('readTextBounded: a file larger than the read buffer is read in several passes', () => {
  withTemp('fredo-qa-read-', (dir) => {
    const file = path.join(dir, 'big');
    const content = 'é'.repeat(3 * 1024 * 1024);
    fs.writeFileSync(file, content);
    assert.equal(readTextBounded(file, 8 * 1024 * 1024), content);
  });
});

test('license file: one leading UTF-8 byte order mark (Windows editors) is accepted', () => {
  withTemp('fredo-qa-read-', (dir) => {
    const file = path.join(dir, 'license.json');
    fs.writeFileSync(file, `\uFEFF${signedLicense()}`);
    assert.equal(validateLicense(file, TEST_LICENSE_OPTIONS).valid, true);
    fs.writeFileSync(
      file,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(signedLicense())]),
    );
    assert.equal(validateLicense(file, TEST_LICENSE_OPTIONS).valid, true);
    fs.writeFileSync(file, `\uFEFF${signedLicense()}\r\n`);
    assert.equal(validateLicense(file, TEST_LICENSE_OPTIONS).valid, true);
  });
});

test('license inline: a leading byte order mark is accepted as well', () => {
  assert.equal(validateLicense(`\uFEFF${signedLicense()}`, TEST_LICENSE_OPTIONS).valid, true);
});

test('license file: a BOM does not let a tampered license through', () => {
  withTemp('fredo-qa-read-', (dir) => {
    const doc = JSON.parse(signedLicense());
    doc.tier = 'enterprise';
    const file = path.join(dir, 'license.json');
    fs.writeFileSync(file, `\uFEFF${JSON.stringify(doc)}`);
    const res = validateLicense(file, TEST_LICENSE_OPTIONS);
    assert.equal(res.valid, false);
    assert.match(res.message, /signature does not match/);
  });
});
