import { spawn } from 'node:child_process';

/**
 * Runs ES module code in a child Node.js process and kills it after `ms`. A blocked read (a named
 * pipe, an endless device) cannot be interrupted from inside the test runner, so tests that probe
 * one run it here: `done` is false when the child had to be killed.
 */
export async function runModuleInChild(
  body: string,
  ms = 30_000,
): Promise<{ done: boolean; out: string; err: string }> {
  const child = spawn(process.execPath, ['--input-type=module', '-e', body], {
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
  const done = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, ms);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  return { done, out, err };
}
