import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { smokeTestServer } from '../scripts/release-lib.mjs';

/**
 * The artifact users download: packs the built package exactly as CI does, checks what ships,
 * installs it into an empty project and runs a full MCP session against the installed bin.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SHELL = process.platform === 'win32';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-package-e2e-'));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

function pack(): { filename: string; files: string[] } {
  const raw = execFileSync('pnpm', ['pack', '--pack-destination', work, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: SHELL,
  });
  const result = JSON.parse(raw);
  return { filename: result.filename, files: result.files.map((f: { path: string }) => f.path) };
}

const packed = pack();

test('Package: ships the build, the docs and the license, and nothing else', () => {
  const tops = new Set(packed.files.map((file) => file.split('/')[0]));
  assert.deepStrictEqual(
    [...tops].sort(),
    ['CHANGELOG.md', 'LICENSE', 'README.md', 'dist', 'package.json'].sort(),
  );
  assert.ok(packed.files.includes('dist/index.js'));
  assert.ok(packed.files.includes('dist/index.d.ts'));
  assert.ok(!packed.files.some((file) => /\.test\.|^src\/|^tests\/|^scripts\//.test(file)));
});

test('Package: the manifest users install is complete and pnpm-free', () => {
  const dir = path.join(work, 'unpacked');
  fs.mkdirSync(dir);
  execFileSync('tar', ['-xzf', packed.filename, '-C', dir]);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package', 'package.json'), 'utf8'));
  for (const field of [
    'name',
    'version',
    'description',
    'license',
    'repository',
    'engines',
    'bin',
  ]) {
    assert.ok(manifest[field], `package.json lacks ${field}`);
  }
  assert.strictEqual(manifest.devEngines, undefined, 'devEngines broke npx before (1.4.3)');
  assert.deepStrictEqual(manifest.dependencies ?? {}, {}, 'zero runtime dependencies');
  const entry = fs.readFileSync(path.join(dir, 'package', 'dist', 'index.js'), 'utf8');
  assert.ok(entry.startsWith('#!/usr/bin/env node\n'), 'bin entry keeps its shebang');
});

test('Package: installs into an empty project and answers a full MCP session', async () => {
  const project = path.join(work, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), '{"private":true}\n');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', packed.filename], {
    cwd: project,
    stdio: 'pipe',
    shell: SHELL,
  });
  const installed = path.join(project, 'node_modules', ...PKG.name.split('/'));
  const entry = path.join(installed, PKG.bin['fredo-qa-mcp-server']);
  const { tools } = await smokeTestServer(process.execPath, PKG.version, 15_000, [entry]);
  assert.ok(tools > 0);
  if (!SHELL) {
    const shim = path.join(project, 'node_modules', '.bin', 'fredo-qa-mcp-server');
    assert.deepStrictEqual(await smokeTestServer(shim, PKG.version, 15_000), { tools });
  }
});
