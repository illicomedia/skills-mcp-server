import * as assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';

describe('license › license-read-race', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-race-'));
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  /**
   * A file swapped for a named pipe between the type check and the open must not block the
   * server. A blocked open() cannot be interrupted from inside the process, so the reads run in
   * a child process that the test kills if it hangs; a worker thread keeps swapping the target.
   */
  test('readTextBounded: a regular file swapped for a named pipe never blocks the read', {
    skip: process.platform === 'win32',
    timeout: 60_000,
  }, async () => {
    const regular = path.join(root, 'regular.json');
    fs.writeFileSync(regular, '{}');
    const fifo = path.join(root, 'pipe');
    execFileSync('mkfifo', [fifo]);
    const link = path.join(root, 'license.json');
    fs.symlinkSync(regular, link);

    // The worker flips the link between the regular file and the pipe as fast as it can.
    const swapper = path.join(root, 'swapper.cjs');
    fs.writeFileSync(
      swapper,
      `const fs = require('node:fs');
const [link, regular, fifo] = ${JSON.stringify([link, regular, fifo])};
const tmp = link + '.tmp';
for (let i = 0; ; i += 1) {
  try { fs.unlinkSync(tmp); } catch {}
  fs.symlinkSync(i % 2 ? fifo : regular, tmp);
  fs.renameSync(tmp, link);
}
`,
    );
    const guard = path.resolve('dist/security/path-guard.js');
    const script = `
      import { Worker } from 'node:worker_threads';
      import { readTextBounded } from ${JSON.stringify(guard)};
      const worker = new Worker(${JSON.stringify(swapper)});
      let refused = 0;
      for (let i = 0; i < 20000; i += 1) {
        try { readTextBounded(${JSON.stringify(link)}, 1024); } catch { refused += 1; }
      }
      await worker.terminate();
      console.log('done', refused);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    const finished = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(false);
      }, 30_000);
      child.on('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    assert.equal(finished, true, 'the read blocked on a named pipe');
    assert.match(out, /^done \d+/, err);
    // The swap really happened: some reads found the pipe (and were refused), others the file.
    const refused = Number(/^done (\d+)/.exec(out)?.[1]);
    assert.ok(refused > 0 && refused < 20000, `refused ${refused} of 20000 reads`);
  });
});
