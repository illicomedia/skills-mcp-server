import * as assert from 'node:assert';
import * as path from 'node:path';
import test from 'node:test';
import type { Pkg, ReleaseContext } from '../scripts/release-flow.mjs';
import {
  deprecate,
  prepare,
  promote,
  REGISTRY_ATTEMPTS,
  registryState,
  ship,
  smoke,
  verifyFromRegistry,
  waitForPublish,
} from '../scripts/release-flow.mjs';

const NAME = '@illicomedia/skills-mcp-server';
const PKG_DIR = '/repo';
const CHANGELOG = '# Changelog\n\n## Unreleased\n\n- Fix.\n\n## 1.4.0 - 2026-10-26\n';

interface World {
  branch: string;
  status: string;
  head: string;
  originHead: string;
  tags: string[];
  versions: string[];
  distTags: Record<string, string>;
  deprecated: Record<string, string>;
  registryMissing: boolean;
  registryBroken: boolean;
  loggedIn: boolean;
  failScript: string | null;
  installFailures: number;
  publishAfterPolls: number;
  smokeFails: boolean;
  interactive: boolean;
  answer: boolean;
  ci: 'green' | 'red' | 'unreachable';
}

/** A fake git + npm + pnpm + file system that records every command it is asked to run. */
function fakeWorld(overrides: Partial<World> = {}) {
  const world: World = {
    branch: 'main',
    status: '',
    head: 'abc',
    originHead: 'abc',
    tags: [],
    versions: ['1.4.0'],
    distTags: { latest: '1.4.0' },
    deprecated: {},
    registryMissing: false,
    registryBroken: false,
    loggedIn: true,
    failScript: null,
    installFailures: 0,
    publishAfterPolls: 0,
    smokeFails: false,
    interactive: true,
    answer: true,
    ci: 'green',
    ...overrides,
  };
  const files = new Map<string, string>([
    [path.join(PKG_DIR, 'CHANGELOG.md'), CHANGELOG],
    [path.join(PKG_DIR, 'package.json'), '{}'],
  ]);
  const calls: string[] = [];
  const logs: string[] = [];
  const removed: string[] = [];
  const questions: string[] = [];
  let polls = 0;

  const git = (args: string[]): string => {
    const line = args.join(' ');
    if (line === 'rev-parse --abbrev-ref HEAD') {
      return world.branch;
    }
    if (line === 'status --porcelain') {
      return world.status;
    }
    if (line === 'rev-parse HEAD') {
      return world.head;
    }
    if (line === 'rev-parse origin/main') {
      return world.originHead;
    }
    if (args[0] === 'tag' && args[1] === '--list') {
      return world.tags.includes(args[2]) ? args[2] : '';
    }
    return '';
  };

  const npm = (args: string[]): string => {
    if (args[0] === 'view' && args.includes('dist-tags')) {
      if (world.registryBroken) {
        throw new Error('npm view failed: ETIMEDOUT');
      }
      if (world.registryMissing) {
        throw new Error('npm view failed: E404 Not Found');
      }
      polls += 1;
      const versions =
        polls > world.publishAfterPolls ? world.versions : world.versions.slice(0, -1);
      return JSON.stringify([{ versions, 'dist-tags': world.distTags }]);
    }
    if (args[0] === 'view') {
      return world.deprecated[args[1].split('@').at(-1) as string] ?? '';
    }
    if (args[0] === 'whoami') {
      if (!world.loggedIn) {
        throw new Error('ENEEDAUTH');
      }
      return 'illicomedia';
    }
    if (args[0] === 'install' && world.installFailures > 0) {
      world.installFailures -= 1;
      throw new Error('ETARGET No matching version');
    }
    return '';
  };

  const pnpm = (args: string[]): string => {
    if (args[0] === 'run' && args[1] === world.failScript) {
      throw new Error(`${args[1]} failed`);
    }
    if (args[0] === 'pack') {
      return JSON.stringify({ filename: `${args[2]}/pkg.tgz` });
    }
    return '';
  };

  const ctx: ReleaseContext = {
    pkgDir: PKG_DIR,
    async fetchJson(url) {
      calls.push(`fetch ${url}`);
      if (world.ci === 'unreachable') {
        throw new Error('403 rate limit exceeded');
      }
      const conclusion = world.ci === 'green' ? 'success' : 'failure';
      return { check_runs: [{ name: 'quality', status: 'completed', conclusion }] };
    },
    interactive: world.interactive,
    sh(command, args, options = {}) {
      calls.push(`${command} ${args.join(' ')}${options.cwd ? ` @${options.cwd}` : ''}`);
      if (command === 'git') {
        return git(args);
      }
      if (command === 'npm') {
        return npm(args);
      }
      return pnpm(args);
    },
    async confirm(question) {
      questions.push(question);
      return world.answer;
    },
    async smokeServer() {
      if (world.smokeFails) {
        throw new Error('server crashed');
      }
      return { tools: 9 };
    },
    sleep: async () => undefined,
    log: (message) => logs.push(message),
    ok: (message) => logs.push(message),
    warn: (message) => logs.push(message),
    join: path.join,
    resolve: (file) => file,
    readFile: (file) => files.get(file) as string,
    writeFile: (file, text) => {
      files.set(file, text);
    },
    makeTempDir: () => `/tmp/fqa-${calls.length}`,
    removeDir: (dir) => {
      removed.push(dir);
    },
    today: () => '2026-11-03',
  };
  return { world, ctx, files, calls, logs, removed, questions };
}

const PKG: Pkg = {
  name: NAME,
  version: '1.4.0',
  repository: { type: 'git', url: 'git+https://github.com/illicomedia/skills-mcp-server.git' },
};
const has = (calls: string[], prefix: string) => calls.some((call) => call.startsWith(prefix));

test('registryState: an unknown package has no versions; other registry errors surface', () => {
  assert.deepStrictEqual(registryState(fakeWorld({ registryMissing: true }).ctx, NAME), {
    versions: [],
    distTags: {},
  });
  assert.throws(() => registryState(fakeWorld({ registryBroken: true }).ctx, NAME), /ETIMEDOUT/);
});

test('prepare: gates, stamps the changelog, commits, tags and pushes atomically', async () => {
  const { ctx, files, calls } = fakeWorld();
  const result = await prepare(ctx, PKG, { bump: 'minor' });
  assert.deepStrictEqual(result, { version: '1.5.0', pushed: true });
  assert.strictEqual(
    JSON.parse(files.get('/repo/package.json') as string).version,
    '1.5.0',
    'package.json carries the new version',
  );
  assert.match(
    files.get('/repo/CHANGELOG.md') as string,
    /## Unreleased\n\n## 1\.5\.0 - 2026-11-03/,
  );
  const order = [
    'pnpm run lint',
    'pnpm run build',
    'pnpm run test:coverage',
    'pnpm pack',
    'npm install',
    'git add package.json CHANGELOG.md',
    'git commit',
    'git tag -a v1.5.0',
    'git push --atomic origin main refs/tags/v1.5.0',
  ].map((prefix) => calls.findIndex((call) => call.startsWith(prefix)));
  assert.ok(
    order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])),
    `${order}`,
  );
  assert.ok(!has(calls, 'npm publish'), 'CI publishes, never the laptop');
});

test('prepare: without a bump it releases the version already in package.json', async () => {
  const { ctx } = fakeWorld({ versions: ['1.3.0'], distTags: { latest: '1.3.0' } });
  assert.deepStrictEqual(await prepare(ctx, PKG, { yes: true }), {
    version: '1.4.0',
    pushed: true,
  });
});

test('prepare: refuses an unsafe repository and lists every reason', async () => {
  const { ctx, calls } = fakeWorld({
    branch: 'feature',
    status: ' M src/index.ts',
    originHead: 'def',
    tags: ['v1.4.1'],
    versions: ['1.4.0', '1.4.1'],
    ci: 'red',
  });
  await assert.rejects(prepare(ctx, PKG, { bump: 'patch' }), (error: Error) => {
    for (const reason of [
      'not feature',
      'src/index.ts',
      'not origin/main',
      'v1.4.1 already',
      'already on npm',
      'CI is not green: quality (failure)',
    ]) {
      assert.ok(error.message.includes(reason), `missing: ${reason}`);
    }
    return true;
  });
  assert.ok(!has(calls, 'git commit'));
});

test('prepare: dry-run reports preflight problems and changes nothing', async () => {
  const { ctx, calls, files, logs } = fakeWorld({ branch: 'feature' });
  assert.deepStrictEqual(await prepare(ctx, PKG, { bump: 'patch', dryRun: true }), {
    version: '1.4.1',
    pushed: false,
  });
  assert.ok(logs.some((line) => line.includes('Preflight would fail')));
  assert.strictEqual(files.get('/repo/CHANGELOG.md'), CHANGELOG);
  assert.ok(!(has(calls, 'pnpm') || has(calls, 'git commit')));
});

test('prepare: a clean dry-run only prints the plan', async () => {
  const { ctx, logs } = fakeWorld();
  await prepare(ctx, PKG, { bump: 'patch', dryRun: true });
  assert.ok(!logs.some((line) => line.includes('Preflight would fail')));
});

test('prepare: needs changelog notes before anything else', async () => {
  const { ctx, files, calls } = fakeWorld();
  files.set('/repo/CHANGELOG.md', '# Changelog\n');
  await assert.rejects(prepare(ctx, PKG, { bump: 'patch' }), /no notes under "## Unreleased"/);
  assert.strictEqual(calls.length, 0);
});

test('prepare: a failing gate restores package.json and CHANGELOG.md', async () => {
  const { ctx, calls } = fakeWorld({ failScript: 'test:coverage' });
  await assert.rejects(prepare(ctx, PKG, { bump: 'patch' }), /test:coverage failed/);
  assert.ok(has(calls, 'git checkout -- package.json CHANGELOG.md'));
  assert.ok(!has(calls, 'git commit'));
});

test('prepare: pushing waits for a yes, and fails closed without a terminal', async () => {
  const declined = fakeWorld({ answer: false });
  assert.deepStrictEqual(await prepare(declined.ctx, PKG, { bump: 'patch' }), {
    version: '1.4.1',
    pushed: false,
  });
  assert.ok(!has(declined.calls, 'git push'));
  assert.ok(declined.logs.some((line) => line.includes('git push --atomic origin main v1.4.1')));

  const unattended = fakeWorld({ interactive: false });
  await assert.rejects(prepare(unattended.ctx, PKG, { bump: 'patch' }), /pass --yes/);
  assert.ok(!has(unattended.calls, 'git push'));

  const yes = fakeWorld({ interactive: false });
  assert.strictEqual((await prepare(yes.ctx, PKG, { bump: 'patch', yes: true })).pushed, true);
  assert.strictEqual(yes.questions.length, 0);
});

test('smoke: packs once and cleans up, or tests the tarball it is given', async () => {
  const packed = fakeWorld();
  await smoke(packed.ctx, PKG);
  assert.ok(has(packed.calls, 'pnpm run build') && has(packed.calls, 'pnpm pack'));
  assert.strictEqual(packed.removed.length, 2, 'install folder and pack folder');

  const given = fakeWorld();
  await smoke(given.ctx, PKG, { tarball: '/ci/pkg.tgz' });
  assert.ok(!has(given.calls, 'pnpm'));
  assert.ok(given.calls.some((call) => call.includes('install') && call.includes('/ci/pkg.tgz')));
  assert.strictEqual(given.removed.length, 1);

  const broken = fakeWorld({ smokeFails: true });
  await assert.rejects(smoke(broken.ctx, PKG, { tarball: '/ci/pkg.tgz' }), /server crashed/);
  assert.strictEqual(broken.removed.length, 1, 'cleans up after a failure too');
});

test('waitForPublish: explains the 2FA approval, polls until public, then gives up with a pointer', async () => {
  const late = fakeWorld({ versions: ['1.4.0', '1.5.0'], publishAfterPolls: 2 });
  await waitForPublish(late.ctx, PKG, '1.5.0');
  assert.ok(late.logs.includes(`  npm stage list ${NAME}`));
  assert.ok(late.logs.includes('  npm stage approve <stage-id>'));
  assert.ok(late.logs.some((line) => line.includes('(1/')));
  assert.ok(!late.logs.some((line) => line.includes('(2/')), 'progress is logged once a minute');
  assert.ok(late.logs.includes(`${NAME}@1.5.0 is public on npm.`));

  const never = fakeWorld();
  await assert.rejects(
    waitForPublish(never.ctx, PKG, '1.5.0'),
    /npm stage approve.*--promote 1\.5\.0/,
  );
});

test('verifyFromRegistry: retries while the registry catches up, then fails loudly', async () => {
  const slow = fakeWorld({ installFailures: 2 });
  await verifyFromRegistry(slow.ctx, PKG, '1.4.0');
  assert.strictEqual(slow.calls.filter((call) => call.startsWith('npm install')).length, 3);

  const missing = fakeWorld({ installFailures: REGISTRY_ATTEMPTS });
  await assert.rejects(verifyFromRegistry(missing.ctx, PKG, '1.4.0'), /failed verification/);
});

const STAGED = { versions: ['1.4.0', '1.5.0'], distTags: { latest: '1.4.0', next: '1.5.0' } };

test('promote: verifies from the registry, asks, then moves latest and clears next', async () => {
  const { ctx, calls, questions } = fakeWorld(STAGED);
  await promote(ctx, PKG, { version: '1.5.0' });
  assert.deepStrictEqual(questions, ['Move `latest` from v1.4.0 to v1.5.0?']);
  const install = calls.findIndex((call) => call.startsWith('npm install'));
  const add = calls.indexOf(`npm dist-tag add ${NAME}@1.5.0 latest`);
  assert.ok(install >= 0 && add > install, 'verified before promoted');
  assert.ok(calls.includes(`npm dist-tag rm ${NAME} next`));
});

test('promote: rolls back to an older version without touching next', async () => {
  const { ctx, calls } = fakeWorld({
    versions: ['1.4.0', '1.5.0'],
    distTags: { latest: '1.5.0', next: '1.6.0' },
  });
  await promote(ctx, PKG, { version: '1.4.0', yes: true });
  assert.ok(calls.includes(`npm dist-tag add ${NAME}@1.4.0 latest`));
  assert.ok(!has(calls, 'npm dist-tag rm'));
});

test('promote: a first latest, a dry-run, a no, and nothing to do', async () => {
  const first = fakeWorld({ versions: ['1.4.0'], distTags: {} });
  await promote(first.ctx, PKG, { version: '1.4.0', yes: true });
  assert.ok(first.logs.some((line) => line.includes('(was vnone)')));

  const dry = fakeWorld(STAGED);
  await promote(dry.ctx, PKG, { version: '1.5.0', dryRun: true });
  assert.strictEqual(dry.logs.filter((line) => line.startsWith('[dry-run]')).length, 2);
  assert.ok(!(has(dry.calls, 'npm dist-tag') || has(dry.calls, 'npm install')));

  const no = fakeWorld({ ...STAGED, answer: false });
  await promote(no.ctx, PKG, { version: '1.5.0' });
  assert.ok(!has(no.calls, 'npm dist-tag'));

  const already = fakeWorld();
  await promote(already.ctx, PKG, { version: '1.4.0' });
  assert.ok(!has(already.calls, 'npm dist-tag'));
});

test('promote: refuses unpublished, deprecated or unauthenticated promotions', async () => {
  await assert.rejects(promote(fakeWorld().ctx, PKG, { version: '9.9.9' }), /not published/);
  const deprecated = fakeWorld({ ...STAGED, deprecated: { '1.5.0': 'Broken. Use 1.5.1.' } });
  await assert.rejects(promote(deprecated.ctx, PKG, { version: '1.5.0' }), /is deprecated/);
  const loggedOut = fakeWorld({ ...STAGED, loggedIn: false });
  await assert.rejects(promote(loggedOut.ctx, PKG, { version: '1.5.0' }), /npm login/);
});

test('deprecate: one version, never latest, after a yes', async () => {
  const live = fakeWorld(STAGED);
  await deprecate(live.ctx, PKG, { version: '1.5.0', message: 'Broken. Use 1.5.1.' });
  assert.ok(live.calls.includes(`npm deprecate ${NAME}@1.5.0 Broken. Use 1.5.1.`));

  const no = fakeWorld({ ...STAGED, answer: false });
  await deprecate(no.ctx, PKG, { version: '1.5.0', message: 'x' });
  assert.ok(!has(no.calls, 'npm deprecate'));

  const dry = fakeWorld(STAGED);
  await deprecate(dry.ctx, PKG, { version: '1.5.0', message: 'x', dryRun: true });
  assert.ok(!has(dry.calls, 'npm deprecate'));

  await assert.rejects(
    deprecate(fakeWorld().ctx, PKG, { version: '1.4.0', message: 'x' }),
    /is `latest`/,
  );
  await assert.rejects(
    deprecate(fakeWorld().ctx, PKG, { version: '9.9.9', message: 'x' }),
    /not published/,
  );
});

test('ship: prepare, wait for CI, verify, promote; never deprecates anything', async () => {
  const { ctx, calls } = fakeWorld({
    versions: ['1.4.0', '1.4.1'],
    distTags: { latest: '1.4.0', next: '1.4.1' },
    publishAfterPolls: 1,
  });
  await ship(ctx, PKG, { bump: 'patch', yes: true });
  assert.ok(calls.includes(`npm dist-tag add ${NAME}@1.4.1 latest`));
  assert.ok(!has(calls, 'npm deprecate'));
});

test('ship: stops after a dry-run or when nothing was pushed', async () => {
  const dry = fakeWorld();
  await ship(dry.ctx, PKG, { bump: 'patch', dryRun: true });
  assert.ok(!(has(dry.calls, 'git push') || has(dry.calls, 'npm dist-tag')));

  const unpushed = fakeWorld({ answer: false });
  await ship(unpushed.ctx, PKG, { bump: 'patch' });
  assert.ok(unpushed.logs.some((line) => line.includes('nothing was pushed')));
  assert.ok(!has(unpushed.calls, 'npm dist-tag'));
});

test('prepare: asks GitHub about the CI of the exact commit being released', async () => {
  const { ctx, calls } = fakeWorld();
  await prepare(ctx, PKG, { bump: 'patch' });
  assert.ok(
    calls.includes(
      'fetch https://api.github.com/repos/illicomedia/skills-mcp-server/commits/abc/check-runs?per_page=100',
    ),
  );
});

test('prepare: refuses when CI status cannot be read or the repository is not on GitHub', async () => {
  await assert.rejects(
    prepare(fakeWorld({ ci: 'unreachable' }).ctx, PKG, { bump: 'patch' }),
    /Could not read CI status from GitHub: 403 rate limit exceeded/,
  );
  await assert.rejects(
    prepare(fakeWorld().ctx, { name: NAME, version: '1.4.0' }, { bump: 'patch' }),
    /not a GitHub URL/,
  );
});
