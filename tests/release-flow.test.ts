import * as assert from 'node:assert';
import * as path from 'node:path';
import test from 'node:test';
import type { Pkg, ReleaseContext } from '../scripts/release-flow.mjs';
import {
  deprecate,
  expectRefusal,
  findTarball,
  githubRelease,
  prepare,
  promote,
  publishListing,
  REGISTRY_ATTEMPTS,
  registryState,
  rehearse,
  ship,
  smoke,
  stage,
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
  npmVersion: string;
  ghReleaseExists: boolean;
  refuses: boolean;
  publisher: string | null;
  listedVersions: string[] | null;
  npmMcpName: string;
  env: Record<string, string | undefined>;
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
    npmVersion: '11.6.0',
    ghReleaseExists: false,
    refuses: true,
    publisher: '2026/11/03 10:00:00 mcp-publisher v1.8.7 (commit: abc, built: x)',
    listedVersions: [],
    npmMcpName: 'io.github.illicomedia/skills-mcp-server',
    env: {},
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
  const summaries: string[] = [];
  /** Folder listings: what `pnpm pack` / `npm pack` wrote, or what a test put there. */
  const dirs = new Map<string, string[]>();
  let polls = 0;

  const packInto = (dir: string, packageJsonDir: string): string => {
    const raw = files.get(path.join(packageJsonDir, 'package.json')) as string;
    const version = (JSON.parse(raw) as { version?: string }).version ?? '1.4.0';
    dirs.set(dir, [...(dirs.get(dir) ?? []), `illicomedia-skills-mcp-server-${version}.tgz`]);
    return '';
  };

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

  const npmView = (args: string[]): string => {
    if (args.includes('dist-tags')) {
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
    if (args[2] === 'mcpName') {
      return world.npmMcpName;
    }
    return world.deprecated[args[1].split('@').at(-1) as string] ?? '';
  };

  const npmWhoami = (): string => {
    if (!world.loggedIn) {
      throw new Error('ENEEDAUTH');
    }
    return 'illicomedia';
  };

  const npmInstall = (): string => {
    if (world.installFailures > 0) {
      world.installFailures -= 1;
      throw new Error('ETARGET No matching version');
    }
    return '';
  };

  const npmHandlers: Record<string, (args: string[]) => string> = {
    view: npmView,
    whoami: npmWhoami,
    install: npmInstall,
    '--version': () => world.npmVersion,
  };
  const npm = (args: string[]): string => npmHandlers[args[0]]?.(args) ?? '';

  const pnpm = (args: string[]): string => {
    if (args[0] === 'run' && args[1] === world.failScript) {
      throw new Error(`${args[1]} failed`);
    }
    if (args[0] === 'pack') {
      return packInto(args[2], PKG_DIR);
    }
    return '';
  };

  const gh = (args: string[]): string => {
    if (args[1] === 'view' && !world.ghReleaseExists) {
      throw new Error('release not found');
    }
    return '';
  };

  const ctx: ReleaseContext = {
    pkgDir: PKG_DIR,
    async fetchJson(url) {
      calls.push(`fetch ${url}`);
      if (url.startsWith('https://registry.modelcontextprotocol.io/')) {
        if (world.listedVersions === null) {
          return {};
        }
        return {
          servers: world.listedVersions.map((version) => ({
            server: { name: 'io.github.illicomedia/skills-mcp-server', version },
          })),
        };
      }
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
      if (command === 'npm' && args[0] === 'pack') {
        return packInto(args[2], options.cwd as string);
      }
      if (command === 'npm') {
        return npm(args);
      }
      if (command === 'gh') {
        return gh(args);
      }
      if (command === 'mcp-publisher') {
        if (world.publisher === null) {
          throw new Error('mcp-publisher: command not found');
        }
        return args[0] === '--version' && options.withStderr ? world.publisher : '';
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
    async refusingServer() {
      if (!world.refuses) {
        throw new Error('Expected a refusal, got exit 0');
      }
      return '[FATAL] Node.js v20.20.2 is not supported';
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
    listDir: (dir) => dirs.get(dir) ?? [],
    copy: (from, to) => {
      calls.push(`copy ${from} ${to}`);
    },
    summary: (markdown) => {
      summaries.push(markdown);
    },
    env: world.env,
    makeTempDir: () => `/tmp/fqa-${calls.length}-${removed.length}-${dirs.size}`,
    removeDir: (dir) => {
      removed.push(dir);
    },
    today: () => '2026-11-03',
  };
  return { world, ctx, files, calls, logs, removed, questions, summaries, dirs };
}

const PKG: Pkg = {
  name: NAME,
  version: '1.4.0',
  files: ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE'],
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

test('smoke: packs once and cleans up, or tests the tarball folder it is given', async () => {
  const packed = fakeWorld();
  await smoke(packed.ctx, PKG);
  assert.ok(has(packed.calls, 'pnpm run build') && has(packed.calls, 'pnpm pack'));
  assert.strictEqual(packed.removed.length, 2, 'install folder and pack folder');

  const given = fakeWorld();
  given.dirs.set('/ci', ['illicomedia-skills-mcp-server-1.4.0.tgz']);
  await smoke(given.ctx, PKG, { tarballDir: '/ci' });
  assert.ok(!has(given.calls, 'pnpm'));
  assert.ok(
    given.calls.some((call) => call.includes('install') && call.includes('/ci/illicomedia-')),
  );
  assert.strictEqual(given.removed.length, 1, 'the given folder is kept');

  const broken = fakeWorld({ smokeFails: true });
  broken.dirs.set('/ci', ['illicomedia-skills-mcp-server-1.4.0.tgz']);
  await assert.rejects(smoke(broken.ctx, PKG, { tarballDir: '/ci' }), /server crashed/);
  assert.strictEqual(broken.removed.length, 1, 'cleans up after a failure too');
});

test('findTarball: exactly this package at this version, by absolute path', () => {
  const { ctx, dirs } = fakeWorld();
  dirs.set('/r', ['illicomedia-skills-mcp-server-1.4.0.tgz', 'NOTES.md']);
  assert.strictEqual(findTarball(ctx, PKG, '/r'), '/r/illicomedia-skills-mcp-server-1.4.0.tgz');
  dirs.set('/two', ['illicomedia-skills-mcp-server-1.4.0.tgz', 'other-1.0.0.tgz']);
  assert.throws(() => findTarball(ctx, PKG, '/two'), /found: illicomedia.*other/);
  dirs.set('/old', ['illicomedia-skills-mcp-server-1.3.0.tgz']);
  assert.throws(() => findTarball(ctx, PKG, '/old'), /Expected exactly .*1\.4\.0\.tgz/);
  assert.throws(() => findTarball(ctx, PKG, '/empty'), /found: none/);
});

test('stage: stages the tarball by absolute path under next, with provenance, then explains', () => {
  const { ctx, calls, summaries, dirs } = fakeWorld({ versions: ['1.3.0'] });
  dirs.set('release', ['illicomedia-skills-mcp-server-1.4.0.tgz']);
  stage(ctx, PKG, { tarballDir: 'release' });
  assert.ok(
    calls.includes(
      'npm stage publish release/illicomedia-skills-mcp-server-1.4.0.tgz --tag next --access public --provenance',
    ),
  );
  assert.ok(!has(calls, 'npm publish'), 'never publishes directly');
  assert.match(
    summaries[0],
    /staged, not public yet[\s\S]*npm stage approve[\s\S]*--promote 1\.4\.0/,
  );
});

test('stage: a version already on npm is skipped, an old npm is refused', () => {
  const done = fakeWorld();
  stage(done.ctx, PKG, { tarballDir: 'release' });
  assert.ok(!has(done.calls, 'npm stage'));
  assert.ok(done.logs.some((line) => line.includes('already published')));

  const old = fakeWorld({ npmVersion: '10.9.2', versions: ['1.3.0'] });
  assert.throws(() => stage(old.ctx, PKG, { tarballDir: 'release' }), /npm 10\.9\.2 cannot stage/);
  assert.ok(!has(old.calls, 'npm stage'));
});

test('rehearse: dry-runs the exact staging command on a copy with a version npm can never have', () => {
  const { ctx, calls, files, dirs, removed } = fakeWorld({
    env: { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2' },
  });
  files.set('/repo/CHANGELOG.md', '## 1.4.0 - 2026-10-26\n\n- Notes.\n');
  dirs.set('packed', ['illicomedia-skills-mcp-server-1.4.0.tgz']);
  rehearse(ctx, PKG, { tarballDir: 'packed' });
  for (const file of PKG.files as string[]) {
    assert.ok(
      calls.some((call) => call.startsWith(`copy /repo/${file} `)),
      file,
    );
  }
  const copied = [...files.entries()].find(
    ([file]) => file.endsWith('/package.json') && file !== '/repo/package.json',
  );
  assert.strictEqual(JSON.parse(copied?.[1] as string).version, '1.4.0-ci.42.2');
  assert.ok(
    calls.some((call) =>
      /^npm stage publish \/tmp\/.*\/illicomedia-skills-mcp-server-1\.4\.0-ci\.42\.2\.tgz --tag next --access public --dry-run$/.test(
        call,
      ),
    ),
    calls.join('\n'),
  );
  assert.strictEqual(removed.length, 2, 'copy and pack folders removed');
});

test('rehearse: refuses missing notes, an old npm or a wrong tarball; local runs are labelled', () => {
  const noNotes = fakeWorld();
  noNotes.files.set('/repo/CHANGELOG.md', '## Unreleased\n');
  assert.throws(() => rehearse(noNotes.ctx, PKG, { tarballDir: 'packed' }), /no release notes/);

  const withNotes = (overrides: Partial<World> = {}) => {
    const world = fakeWorld(overrides);
    world.files.set('/repo/CHANGELOG.md', '## 1.4.0 - 2026-10-26\n\n- Notes.\n');
    return world;
  };
  const oldNpm = withNotes({ npmVersion: '11.5.0' });
  assert.throws(() => rehearse(oldNpm.ctx, PKG, { tarballDir: 'packed' }), /cannot stage/);
  const noTarball = withNotes();
  assert.throws(() => rehearse(noTarball.ctx, PKG, { tarballDir: 'packed' }), /found: none/);

  const local = withNotes();
  local.dirs.set('packed', ['illicomedia-skills-mcp-server-1.4.0.tgz']);
  rehearse(local.ctx, PKG, { tarballDir: 'packed' });
  assert.ok(local.calls.some((call) => call.includes('1.4.0-ci.local.0.tgz')));
});

test('githubRelease: creates the release with notes and tarball; pre-releases are marked', () => {
  const { ctx, calls, files, dirs } = fakeWorld();
  files.set('/repo/CHANGELOG.md', '## 1.4.0 - 2026-10-26\n\n- Notes.\n');
  dirs.set('release', ['illicomedia-skills-mcp-server-1.4.0.tgz']);
  githubRelease(ctx, PKG, { tag: 'v1.4.0', tarballDir: 'release' });
  const create = calls.find((call) => call.startsWith('gh release create')) as string;
  assert.match(
    create,
    /^gh release create v1\.4\.0 release\/illicomedia-skills-mcp-server-1\.4\.0\.tgz --verify-tag --title v1\.4\.0 --notes-file \S+NOTES\.md$/,
  );
  const notes = [...files.entries()].find(([file]) => file.endsWith('NOTES.md'));
  assert.strictEqual(notes?.[1], '- Notes.\n');

  const rc = fakeWorld();
  const rcPkg = { ...PKG, version: '2.0.0-rc.1' };
  rc.files.set('/repo/CHANGELOG.md', '## 2.0.0-rc.1 - 2026-11-03\n\n- RC.\n');
  rc.dirs.set('release', ['illicomedia-skills-mcp-server-2.0.0-rc.1.tgz']);
  githubRelease(rc.ctx, rcPkg, { tag: 'v2.0.0-rc.1', tarballDir: 'release' });
  assert.ok(
    rc.calls.some((call) => call.startsWith('gh release create') && call.endsWith('--prerelease')),
  );
});

test('githubRelease: an existing release is left alone, so re-runs are harmless', () => {
  const { ctx, calls } = fakeWorld({ ghReleaseExists: true });
  githubRelease(ctx, PKG, { tag: 'v1.4.0', tarballDir: 'release' });
  assert.ok(!has(calls, 'gh release create'));
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

test('expectRefusal: installs the tarball as a user would and requires a [FATAL] refusal', async () => {
  const ok = fakeWorld();
  ok.dirs.set('packed', ['illicomedia-skills-mcp-server-1.4.0.tgz']);
  await expectRefusal(ok.ctx, PKG, { tarballDir: 'packed' });
  assert.ok(
    ok.calls.some(
      (call) =>
        call.startsWith('npm install') &&
        call.includes('packed/illicomedia-skills-mcp-server-1.4.0.tgz'),
    ),
  );
  assert.ok(ok.logs.some((line) => line.includes('refuses this Node.js, as intended')));
  assert.strictEqual(ok.removed.length, 1);

  const starts = fakeWorld({ refuses: false });
  starts.dirs.set('packed', ['illicomedia-skills-mcp-server-1.4.0.tgz']);
  await assert.rejects(expectRefusal(starts.ctx, PKG, { tarballDir: 'packed' }), /got exit 0/);
  assert.strictEqual(starts.removed.length, 1, 'cleans up after a failure too');
});

test('prepare: a release candidate keeps the notes under Unreleased and is tagged as such', async () => {
  const { ctx, files, calls } = fakeWorld();
  const result = await prepare(ctx, PKG, { bump: 'major', preid: 'rc', yes: true });
  assert.deepStrictEqual(result, { version: '2.0.0-rc.0', pushed: true });
  const changelog = files.get('/repo/CHANGELOG.md') as string;
  assert.match(changelog, /## Unreleased\n\n- Fix\.\n\n## 2\.0\.0-rc\.0 - 2026-11-03\n\n- Fix\./);
  assert.ok(calls.includes('git push --atomic origin main refs/tags/v2.0.0-rc.0'));
});

const LISTED_PKG: Pkg = { ...PKG, mcpName: 'io.github.illicomedia/skills-mcp-server' };

function listingFor(version: string): string {
  return JSON.stringify({
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: 'io.github.illicomedia/skills-mcp-server',
    description: 'QA skills for AI coding agents.',
    version,
    packages: [{ registryType: 'npm', identifier: NAME, version, transport: { type: 'stdio' } }],
  });
}

function withListing(version: string, overrides: Partial<World> = {}) {
  const world = fakeWorld(overrides);
  world.dirs.set('/repo', ['server.json']);
  world.files.set('/repo/server.json', listingFor(version));
  return world;
}

test('prepare: the MCP Registry listing follows the new version and is committed with it', async () => {
  const { ctx, files, calls } = withListing('1.4.0');
  await prepare(ctx, LISTED_PKG, { bump: 'minor', yes: true });
  const listing = JSON.parse(files.get('/repo/server.json') as string);
  assert.strictEqual(listing.version, '1.5.0');
  assert.strictEqual(listing.packages[0].version, '1.5.0');
  assert.ok(calls.includes('git add package.json CHANGELOG.md server.json'));
});

test('prepare: a broken listing stops the release and restores it', async () => {
  const { ctx, calls } = withListing('1.4.0');
  await assert.rejects(
    prepare(ctx, PKG, { bump: 'minor', yes: true }),
    /server\.json is not ready/,
  );
  assert.ok(calls.includes('git checkout -- package.json CHANGELOG.md server.json'));
  assert.ok(!has(calls, 'git commit'));
});

const PUBLIC_150 = { versions: ['1.4.0', '1.5.0'], distTags: { latest: '1.4.0', next: '1.5.0' } };

test('promote: lists the version in the MCP Registry right after moving latest', async () => {
  const { ctx, calls, questions } = withListing('1.5.0', PUBLIC_150);
  await promote(ctx, LISTED_PKG, { version: '1.5.0', withListing: true });
  const latest = calls.indexOf(`npm dist-tag add ${NAME}@1.5.0 latest`);
  const publish = calls.indexOf('mcp-publisher publish');
  assert.ok(latest >= 0 && publish > latest, 'listed only once latest moved');
  assert.ok(calls.indexOf('mcp-publisher validate') < publish);
  assert.ok(
    questions.includes(
      'Publish io.github.illicomedia/skills-mcp-server 1.5.0 to the MCP Registry?',
    ),
  );
});

test('promote: a rollback leaves the listing alone', async () => {
  const { ctx, calls, logs } = withListing('1.5.0', {
    versions: ['1.4.0', '1.5.0'],
    distTags: { latest: '1.5.0' },
  });
  await promote(ctx, LISTED_PKG, { version: '1.4.0', yes: true, withListing: true });
  assert.ok(!has(calls, 'mcp-publisher'));
  assert.ok(logs.some((line) => line.includes('listing not touched')));
});

test('publishListing: skips a listed version; refuses an unpublished one or a broken listing', async () => {
  const listed = withListing('1.5.0', { ...PUBLIC_150, listedVersions: ['1.5.0'] });
  await publishListing(listed.ctx, LISTED_PKG, { version: '1.5.0' });
  assert.ok(!has(listed.calls, 'mcp-publisher'));
  assert.ok(listed.logs.some((line) => line.includes('already listed')));

  const staged = withListing('1.5.0');
  await assert.rejects(
    publishListing(staged.ctx, LISTED_PKG, { version: '1.5.0' }),
    /not public on npm/,
  );

  const stale = withListing('1.4.0', PUBLIC_150);
  await assert.rejects(publishListing(stale.ctx, LISTED_PKG, { version: '1.5.0' }), /not ready/);
});

test('publishListing: requires exactly the pinned mcp-publisher', async () => {
  const missing = withListing('1.5.0', { ...PUBLIC_150, publisher: null });
  await assert.rejects(
    publishListing(missing.ctx, LISTED_PKG, { version: '1.5.0' }),
    /mcp-publisher 1\.8\.7 is required \(found: none\)/,
  );
  const newer = withListing('1.5.0', { ...PUBLIC_150, publisher: 'mcp-publisher v1.8.70 (x' });
  await assert.rejects(
    publishListing(newer.ctx, LISTED_PKG, { version: '1.5.0' }),
    /is required \(found: mcp-publisher v1\.8\.70/,
  );
  assert.ok(!has(newer.calls, 'mcp-publisher publish'));
});

test('publishListing: a dry run, a no, and a package without a listing publish nothing', async () => {
  const dry = withListing('1.5.0', PUBLIC_150);
  await publishListing(dry.ctx, LISTED_PKG, { version: '1.5.0', dryRun: true });
  assert.ok(!has(dry.calls, 'mcp-publisher'));

  const no = withListing('1.5.0', { ...PUBLIC_150, answer: false });
  await publishListing(no.ctx, LISTED_PKG, { version: '1.5.0' });
  assert.ok(!has(no.calls, 'mcp-publisher publish'));
  assert.ok(no.logs.some((line) => line.includes('--publish-listing')));

  const none = fakeWorld(PUBLIC_150);
  await publishListing(none.ctx, PKG, { version: '1.5.0' });
  assert.ok(none.logs.some((line) => line.includes('No server.json')));
});

test('publishListing: an empty registry answer means not listed yet', async () => {
  const { ctx, calls } = withListing('1.5.0', { ...PUBLIC_150, listedVersions: null });
  await publishListing(ctx, LISTED_PKG, { version: '1.5.0', yes: true });
  assert.ok(calls.includes('mcp-publisher publish'));
});

test('publishListing: a version published without mcpName cannot be listed', async () => {
  const { ctx, calls } = withListing('1.5.0', { ...PUBLIC_150, npmMcpName: '' });
  await assert.rejects(
    publishListing(ctx, LISTED_PKG, { version: '1.5.0', yes: true }),
    /published with mcpName "", not "io\.github\.illicomedia\/skills-mcp-server"/,
  );
  assert.ok(!has(calls, 'mcp-publisher'));
});

test('promote: the MCP Registry listing is opt-in; a plain promote never touches it', async () => {
  const { ctx, calls, logs } = withListing('1.5.0', PUBLIC_150);
  await promote(ctx, LISTED_PKG, { version: '1.5.0', yes: true });
  assert.ok(calls.includes(`npm dist-tag add ${NAME}@1.5.0 latest`));
  assert.ok(!has(calls, 'mcp-publisher'));
  assert.ok(!calls.some((call) => call.includes('modelcontextprotocol')));
  assert.ok(logs.some((line) => line.includes('listing skipped (opt-in: --with-listing')));
});
