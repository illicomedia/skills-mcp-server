import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import {
  CHECK_CLEAN_HELP,
  COVERAGE_HELP,
  RELEASE_HELP,
  SETTINGS_HELP,
  wantsHelp,
} from '../../scripts/cli-help.mjs';
import { REPO_ROOT } from '../helpers/paths.ts';

describe('release › cli-help', () => {
  const script = (name: string): string => path.join(REPO_ROOT, 'scripts', name);

  /** Runs a script from an empty folder with no token and no network use expected. */
  function run(command: string, args: string[]) {
    const started = Date.now();
    const result = spawnSync(command, args, {
      cwd: '/',
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: '/nonexistent-home', NO_COLOR: '1' },
      timeout: 20_000,
    });
    return { ...result, ms: Date.now() - started };
  }

  test('wantsHelp: --help or -h anywhere on the command line, nothing else', () => {
    for (const argv of [
      ['--help'],
      ['-h'],
      ['--promote', '3.2.0', '--help'],
      ['-h', '--yes'],
      ['--', '-h'],
    ]) {
      assert.equal(wantsHelp(argv), true, argv.join(' '));
    }
    for (const argv of [
      [],
      ['--helpx'],
      ['help'],
      ['-help'],
      ['--message', 'see --help'],
      ['-H'],
      ['--h'],
    ]) {
      assert.equal(wantsHelp(argv), false, argv.join(' '));
    }
  });

  test('release help: every action and option, the process in order, and what needs 2FA', () => {
    for (const flag of [
      '--bump',
      '--preid',
      '--ship',
      '--approve',
      '--promote',
      '--with-listing',
      '--publish-listing',
      '--deprecate',
      '--undeprecate',
      '--message',
      '--smoke-only',
      '--tarball-dir',
      '--rehearse',
      '--expect-refusal',
      '--check-tag',
      '--stage',
      '--github-release',
      '--release-notes',
      '--dry-run',
      '--yes',
      '--help',
    ]) {
      assert.ok(RELEASE_HELP.includes(flag), flag);
    }
    assert.match(RELEASE_HELP, /^Usage: pnpm release/);
    assert.match(RELEASE_HELP, /patch\|minor\|major/);
    assert.match(RELEASE_HELP, /2FA/);
    assert.match(RELEASE_HELP, /never publishes/);
    assert.match(RELEASE_HELP, /docs\/operations\/release-runbook\.md/);
    assert.match(RELEASE_HELP, /Emergency rollback/);
    const order = ['1.', '2.', '3.', '4.', '5.'].map((step) => RELEASE_HELP.indexOf(`\n  ${step}`));
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
    );
    assert.ok(order.every((at) => at > 0));
  });

  test('settings help: both actions, the token file and its permissions', () => {
    for (const text of [
      '--check',
      '--apply',
      '--yes',
      '--token-file',
      '~/.config/gh-setup/token',
      '--help',
    ]) {
      assert.ok(SETTINGS_HELP.includes(text), text);
    }
    assert.match(SETTINGS_HELP, /^Usage: pnpm run github:check/);
  });

  test('every help text fits a terminal and holds no secret-looking value', () => {
    for (const help of [RELEASE_HELP, SETTINGS_HELP, CHECK_CLEAN_HELP, COVERAGE_HELP]) {
      assert.ok(help.endsWith('\n'));
      for (const line of help.split('\n')) {
        assert.ok(line.length <= 100, `${line.length}: ${line}`);
      }
      assert.doesNotMatch(help, /gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}/);
    }
  });

  for (const [name, args, usage] of [
    ['release.mjs', ['--help'], /^Usage: pnpm release/],
    ['release.mjs', ['-h'], /^Usage: pnpm release/],
    ['release.mjs', ['--promote', '9.9.9', '--yes', '--help'], /^Usage: pnpm release/],
    ['release.mjs', ['--deprecate', '1.0.0', '--message', 'x', '-h'], /^Usage: pnpm release/],
    ['release.mjs', ['--no-such-flag', '--help'], /^Usage: pnpm release/],
    ['github-settings.mjs', ['--help'], /^Usage: pnpm run github:check/],
    ['github-settings.mjs', ['--apply', '--yes', '-h'], /^Usage: pnpm run github:check/],
    ['check-clean.mjs', ['--help'], /^Usage: pnpm run check:clean/],
    ['check-clean.mjs', ['-h'], /^Usage: pnpm run check:clean/],
    ['run-coverage.mjs', ['--help'], /^Usage: pnpm run test:coverage/],
    ['run-coverage.mjs', ['-h'], /^Usage: pnpm run test:coverage/],
  ] as const) {
    test(`${name} ${args.join(' ')}: prints its help, exits 0, does nothing else`, () => {
      const result = run(process.execPath, [script(name), ...args]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, usage);
      assert.equal(result.stderr, '');
      assert.ok(result.ms < 5000, `${result.ms} ms: help must not start any work`);
    });
  }

  test('github-audit.sh --help and -h: usage on stdout, exit 0, no gh call, no token needed', {
    skip: process.platform === 'win32',
  }, () => {
    for (const flag of ['--help', '-h']) {
      const result = run('bash', [script('github-audit.sh'), flag]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^Usage: .*github-audit\.sh \[owner\/repo\]/);
      assert.match(result.stdout, /~\/\.config\/gh-setup\/token/);
      assert.equal(result.stderr, '');
    }
  });

  test('a wrong option says how to get help, and exits 1', () => {
    for (const name of ['release.mjs', 'github-settings.mjs']) {
      const result = run(process.execPath, [script(name), '--no-such-flag']);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--help/);
      assert.equal(result.stdout, '');
    }
  });
});
