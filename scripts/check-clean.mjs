#!/usr/bin/env node

/**
 * Runs `pnpm run check` on the committed state (HEAD) in an empty folder, the way CI sees it:
 * no dist/, no node_modules, no uncommitted file. Run it before every push. A check that passes
 * only in a working copy (where earlier builds left files behind) fails here instead of in CI.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fqa-check-clean-'));
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
try {
  // Through a file, not a buffer: execFileSync caps output at 1 MiB, and the archive is larger.
  const archive = join(dir, 'HEAD.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD']);
  execFileSync('tar', ['-x', '-f', archive, '-C', dir]);
  rmSync(archive);
  const env = { ...process.env, CI: 'true' };
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, env });
  run('pnpm', ['run', 'check'], { cwd: dir, env });
  console.error(`check:clean passed on ${execFileSync('git', ['rev-parse', '--short', 'HEAD'])}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
