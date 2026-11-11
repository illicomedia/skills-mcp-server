import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test, { describe } from 'node:test';
import {
  bumpVersion,
  changelogHasVersion,
  checkTagMatchesVersion,
  ciProblem,
  ciTagOutputs,
  deprecationProblems,
  expectServerRefusal,
  extractChangelogSection,
  githubRepoSlug,
  listingAtVersion,
  listingProblems,
  nextDistTagAfterPromotion,
  parseRegistryState,
  parseReleaseArgs,
  parseStageList,
  SMOKE_PROTOCOL_VERSION,
  smokeTestServer,
  stampChangelog,
  stampReleaseDate,
  tagForVersion,
  tarballFileName,
  versionAtLeast,
} from '../../scripts/release-lib.mjs';

describe('release › release', () => {
  test('Release args: prepare needs nothing but accepts a bump, and the npm "--" separator is ignored', () => {
    assert.deepStrictEqual(parseReleaseArgs([]), {
      action: 'prepare',
      dryRun: false,
      yes: false,
      bump: null,
    });
    assert.deepStrictEqual(parseReleaseArgs(['--', '--dry-run', '--bump', 'minor', '--yes']), {
      action: 'prepare',
      dryRun: true,
      yes: true,
      bump: 'minor',
    });
    assert.deepStrictEqual(parseReleaseArgs(['-y']), {
      action: 'prepare',
      dryRun: false,
      yes: true,
      bump: null,
    });
  });

  test('Release args: promote and deprecate target one exact version', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--promote', '1.5.0']), {
      action: 'promote',
      dryRun: false,
      yes: false,
      version: '1.5.0',
    });
    assert.deepStrictEqual(
      parseReleaseArgs(['--deprecate', '1.5.0', '--message', 'Broken. Use 1.5.1.']),
      {
        action: 'deprecate',
        dryRun: false,
        yes: false,
        version: '1.5.0',
        message: 'Broken. Use 1.5.1.',
      },
    );
  });

  test('Release args: ship is one action, with or without a bump', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--ship']), {
      action: 'ship',
      dryRun: false,
      yes: false,
      bump: null,
    });
    assert.deepStrictEqual(parseReleaseArgs(['--ship', '--bump', 'minor', '--dry-run']), {
      action: 'ship',
      dryRun: true,
      yes: false,
      bump: 'minor',
    });
    assert.throws(() => parseReleaseArgs(['--ship', '--promote', '1.5.0']), /Choose one action/);
    assert.throws(() => parseReleaseArgs(['--ship', '--bump', 'huge']), /--bump expects/);
  });

  test('Release args: smoke-only runs without the registry, optionally on a tarball folder', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--smoke-only']), {
      action: 'smoke',
      dryRun: false,
      yes: false,
      tarballDir: null,
    });
    assert.deepStrictEqual(parseReleaseArgs(['--smoke-only', '--tarball-dir', 'packed']), {
      action: 'smoke',
      dryRun: false,
      yes: false,
      tarballDir: 'packed',
    });
    assert.throws(
      () => parseReleaseArgs(['--tarball-dir', 'packed']),
      /--tarball-dir only applies/,
    );
    assert.throws(() => parseReleaseArgs(['--tarball', 'x.tgz']), /Unknown option: --tarball/);
  });

  test('Release args: CI commands stage, rehearse and publish the GitHub Release from a folder', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--stage', '--tarball-dir', 'release']), {
      action: 'stage',
      dryRun: false,
      yes: false,
      tarballDir: 'release',
    });
    assert.deepStrictEqual(parseReleaseArgs(['--rehearse', '--tarball-dir', 'packed']), {
      action: 'rehearse',
      dryRun: false,
      yes: false,
      tarballDir: 'packed',
    });
    assert.deepStrictEqual(
      parseReleaseArgs(['--github-release', 'v1.5.0', '--tarball-dir', 'release']),
      { action: 'github-release', dryRun: false, yes: false, tag: 'v1.5.0', tarballDir: 'release' },
    );
    assert.deepStrictEqual(parseReleaseArgs(['--expect-refusal', '--tarball-dir', 'packed']), {
      action: 'expect-refusal',
      dryRun: false,
      yes: false,
      tarballDir: 'packed',
    });
    assert.throws(() => parseReleaseArgs(['--expect-refusal']), /--tarball-dir expects a folder/);
    assert.throws(() => parseReleaseArgs(['--stage']), /--tarball-dir expects a folder/);
    assert.throws(
      () => parseReleaseArgs(['--github-release', '', '--tarball-dir', 'r']),
      /expects a tag/,
    );
    assert.throws(() => parseReleaseArgs(['--stage', '--rehearse']), /Choose one action/);
  });

  test('versionAtLeast: compares x.y.z, ignoring a pre-release suffix', () => {
    assert.strictEqual(versionAtLeast('11.5.1', '11.5.1'), true);
    assert.strictEqual(versionAtLeast('11.6.0', '11.5.1'), true);
    assert.strictEqual(versionAtLeast('12.0.0', '11.5.1'), true);
    assert.strictEqual(versionAtLeast('11.5.0', '11.5.1'), false);
    assert.strictEqual(versionAtLeast('10.9.9', '11.5.1'), false);
    assert.strictEqual(versionAtLeast('11.5.1-pre.1', '11.5.1'), true);
  });

  test('tarballFileName and ciTagOutputs: names and step outputs CI relies on', () => {
    assert.strictEqual(
      tarballFileName('@illicomedia/skills-mcp-server', '2.0.2'),
      'illicomedia-skills-mcp-server-2.0.2.tgz',
    );
    assert.strictEqual(tarballFileName('plain', '1.0.0'), 'plain-1.0.0.tgz');
    const pkg = { name: '@illicomedia/skills-mcp-server', version: '2.0.2' };
    assert.strictEqual(
      ciTagOutputs('v2.0.2', pkg),
      'ref=refs/tags/v2.0.2\nname=@illicomedia/skills-mcp-server\nversion=2.0.2\n',
    );
    assert.throws(() => ciTagOutputs('v2.0.3', pkg), /does not match/);
  });

  test('Release args: CI helpers check the tag and print release notes', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--check-tag', 'v1.5.0']), {
      action: 'check-tag',
      dryRun: false,
      yes: false,
      tag: 'v1.5.0',
    });
    assert.deepStrictEqual(parseReleaseArgs(['--release-notes', '1.5.0']), {
      action: 'release-notes',
      dryRun: false,
      yes: false,
      version: '1.5.0',
    });
    assert.throws(() => parseReleaseArgs(['--check-tag']), /--check-tag expects a tag/);
    assert.strictEqual(parseReleaseArgs(['--release-notes', '2.0.0-rc.1']).version, '2.0.0-rc.1');
    assert.throws(() => parseReleaseArgs(['--release-notes', 'v1.5.0']), /expects a version/);
  });

  test('Release args: rejects removed lifecycle flags instead of ignoring them', () => {
    assert.throws(
      () => parseReleaseArgs(['--unpublish-older']),
      /Unknown option: --unpublish-older/,
    );
    assert.throws(() => parseReleaseArgs(['--deprecate-only']), /Unknown option: --deprecate-only/);
  });

  test('Release args: rejects bad values and ambiguous actions', () => {
    assert.throws(() => parseReleaseArgs(['--bump', 'huge']), /--bump expects/);
    assert.throws(() => parseReleaseArgs(['--promote']), /--promote expects an exact version/);
    assert.throws(
      () => parseReleaseArgs(['--promote', '<1.5.0']),
      /--promote expects an exact version/,
    );
    assert.throws(
      () => parseReleaseArgs(['--deprecate', '<1.5.0', '--message', 'x']),
      /--deprecate expects an exact version/,
    );
    assert.throws(() => parseReleaseArgs(['--deprecate', '1.5.0']), /--message expects/);
    assert.throws(
      () => parseReleaseArgs(['--message', 'x']),
      /--message only applies to --deprecate/,
    );
    assert.throws(() => parseReleaseArgs(['--promote', '1.5.0', '--smoke-only']), /one action/);
    assert.throws(
      () => parseReleaseArgs(['--promote', '1.5.0', '--bump', 'patch']),
      /--bump only applies/,
    );
  });

  test('A release needs its changelog section, in either heading style', () => {
    assert.equal(changelogHasVersion('# Changelog\n\n## 1.5.0 - 2026-11-02\n', '1.5.0'), true);
    assert.equal(changelogHasVersion('## [1.5.0] - 2026-11-02\n', '1.5.0'), true);
    assert.equal(changelogHasVersion('## 1.5.0 - 2026-11-02\n', '1.5.1'), false);
    assert.equal(changelogHasVersion('## 1.5.01 - 2026-11-02\n', '1.5.0'), false);
  });

  test('extractChangelogSection: extracts the section body for a given version', () => {
    const changelog =
      '# Changelog\n\n## 1.5.0 - 2026-11-02\n\n### Added\n- New feature.\n\n## 1.4.0 - 2026-10-26\n\n- Older feature.\n';
    assert.strictEqual(extractChangelogSection(changelog, '1.5.0'), '### Added\n- New feature.');
    assert.strictEqual(extractChangelogSection(changelog, '1.4.0'), '- Older feature.');
    assert.strictEqual(extractChangelogSection(changelog, '9.9.9'), '');
  });

  test('stampChangelog: unreleased notes become the version section under a fresh Unreleased', () => {
    const changelog = '# Changelog\n\n## Unreleased\n\n- Fix.\n\n## 1.4.0 - 2026-10-26\n';
    assert.strictEqual(
      stampChangelog(changelog, '1.5.0', '2026-11-03'),
      '# Changelog\n\n## Unreleased\n\n## 1.5.0 - 2026-11-03\n\n- Fix.\n\n## 1.4.0 - 2026-10-26\n',
    );
    const done = '## 1.5.0 - 2026-11-02\n';
    assert.strictEqual(stampChangelog(done, '1.5.0', '2026-11-03'), done);
    assert.throws(
      () => stampChangelog('## Unreleased\n\n## 1.4.0 - x\n', '1.5.0', 'd'),
      /no notes/,
    );
    assert.throws(() => stampChangelog('# Changelog\n', '1.5.0', 'd'), /no notes/);
  });

  test('stampReleaseDate: replaces SERVER_RELEASE_DATE with the target ISO date', () => {
    const source = `export const SERVER_RELEASE_DATE = '2026-10-23T00:00:00Z';`;
    assert.strictEqual(
      stampReleaseDate(source, '2026-11-04'),
      `export const SERVER_RELEASE_DATE = '2026-11-04T00:00:00Z';`,
    );
  });

  test('Tags: CI publishes only when the tag is exactly v<package version>', () => {
    assert.strictEqual(tagForVersion('1.5.0'), 'v1.5.0');
    assert.strictEqual(checkTagMatchesVersion('v1.5.0', '1.5.0'), 'v1.5.0');
    assert.strictEqual(checkTagMatchesVersion('refs/tags/v1.5.0', '1.5.0'), 'v1.5.0');
    assert.throws(() => checkTagMatchesVersion('v1.5.1', '1.5.0'), /does not match/);
    assert.throws(() => checkTagMatchesVersion('main', '1.5.0'), /does not match/);
  });

  test('parseRegistryState: reads npm 11 objects and npm 12 arrays', () => {
    const state = { versions: ['1.0.0', '1.1.0'], 'dist-tags': { latest: '1.1.0' } };
    const expected = { versions: ['1.0.0', '1.1.0'], distTags: { latest: '1.1.0' } };
    assert.deepStrictEqual(parseRegistryState(JSON.stringify(state)), expected);
    assert.deepStrictEqual(parseRegistryState(JSON.stringify([state])), expected);
    assert.deepStrictEqual(parseRegistryState('{"versions":"1.0.0"}'), {
      versions: ['1.0.0'],
      distTags: {},
    });
  });

  test('bumpVersion: follows semantic versioning', () => {
    assert.strictEqual(bumpVersion('1.4.1', 'patch'), '1.4.2');
    assert.strictEqual(bumpVersion('1.4.1', 'minor'), '1.5.0');
    assert.strictEqual(bumpVersion('1.4.1', 'major'), '2.0.0');
    assert.throws(() => bumpVersion('1.4', 'patch'), /Cannot parse/);
  });

  test('nextDistTagAfterPromotion: next is dropped only when it points at the promoted version', () => {
    assert.strictEqual(
      nextDistTagAfterPromotion({ latest: '1.4.1', next: '1.5.0' }, '1.5.0'),
      true,
    );
    assert.strictEqual(
      nextDistTagAfterPromotion({ latest: '1.5.0', next: '1.6.0' }, '1.4.1'),
      false,
    );
    assert.strictEqual(nextDistTagAfterPromotion({ latest: '1.5.0' }, '1.4.1'), false);
  });

  const SMOKE_DIRS: string[] = [];

  test.after(() => {
    for (const dir of SMOKE_DIRS) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function fakeServer(body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-smoke-'));
    SMOKE_DIRS.push(dir);
    const file = path.join(dir, 'server.mjs');
    fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
    return file;
  }

  /** A scripted MCP server: answers by method, never answers notifications. */
  const RESPONDER = (answers: Record<string, string>) => `
import * as readline from 'node:readline';
const answers = { ${Object.entries(answers)
    .map(([method, result]) => `'${method}': ${result}`)
    .join(', ')} };
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line);
  if (id === undefined) return;
  console.log('not json');
  console.log(JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} }));
  console.log(JSON.stringify({ jsonrpc: '2.0', id, result: answers[method] }));
});`;

  const INIT = (version: string) =>
    `{ protocolVersion: '${SMOKE_PROTOCOL_VERSION}', serverInfo: { name: 'fake', version: '${version}' } }`;
  const TOOLS = '{ tools: [{ name: "get_version" }] }';
  const GET_VERSION = (version: string) =>
    `{ content: [{ type: 'text', text: JSON.stringify({ version: '${version}' }, null, 2) }] }`;
  const HEALTHY = {
    initialize: INIT('1.5.0'),
    'tools/list': TOOLS,
    'tools/call': GET_VERSION('1.5.0'),
  };

  test('smokeTestServer: accepts a server that completes a full MCP session', async () => {
    const bin = fakeServer(RESPONDER(HEALTHY));
    assert.deepStrictEqual(await smokeTestServer(bin, '1.5.0'), { tools: 1 });
    assert.deepStrictEqual(await smokeTestServer(process.execPath, '1.5.0', 10_000, [bin]), {
      tools: 1,
    });
  });

  test('smokeTestServer: rejects an initialize answer without a protocol version', async () => {
    const bin = fakeServer(RESPONDER({ ...HEALTHY, initialize: '{}' }));
    await assert.rejects(smokeTestServer(bin, '1.5.0'), /without a protocolVersion/);
  });

  test('smokeTestServer: rejects a version mismatch', async () => {
    const bin = fakeServer(RESPONDER({ ...HEALTHY, initialize: INIT('1.4.1') }));
    await assert.rejects(
      smokeTestServer(bin, '1.5.0'),
      /reports version 1\.4\.1, expected 1\.5\.0/,
    );
  });

  test('smokeTestServer: rejects a server without tools', async () => {
    const bin = fakeServer(RESPONDER({ ...HEALTHY, 'tools/list': '{}' }));
    await assert.rejects(smokeTestServer(bin, '1.5.0'), /exposes no tools/);
  });

  test('smokeTestServer: rejects a failing or wrong get_version call', async () => {
    const failing = fakeServer(RESPONDER({ ...HEALTHY, 'tools/call': '{ isError: true }' }));
    await assert.rejects(smokeTestServer(failing, '1.5.0'), /get_version failed/);
    const stale = fakeServer(RESPONDER({ ...HEALTHY, 'tools/call': GET_VERSION('1.4.1') }));
    await assert.rejects(smokeTestServer(stale, '1.5.0'), /get_version failed/);
  });

  test('smokeTestServer: rejects a server that crashes on start', async () => {
    const bin = fakeServer("throw new Error('missing dist file');");
    await assert.rejects(smokeTestServer(bin, '1.5.0'), /exited/);
  });

  test('smokeTestServer: rejects a server that never answers', async () => {
    const bin = fakeServer('setInterval(() => {}, 1000);');
    await assert.rejects(smokeTestServer(bin, '1.5.0', 200), /no answer/);
  });

  test('smokeTestServer: rejects a command that cannot start', async () => {
    await assert.rejects(smokeTestServer('/nonexistent/fqa-server', '1.5.0'), /ENOENT/);
  });

  test('githubRepoSlug: reads owner/repo from the usual repository forms', () => {
    const slug = 'illicomedia/skills-mcp-server';
    assert.strictEqual(githubRepoSlug({ url: `git+https://github.com/${slug}.git` }), slug);
    assert.strictEqual(githubRepoSlug(`https://github.com/${slug}`), slug);
    assert.strictEqual(githubRepoSlug(`git@github.com:${slug}.git`), slug);
    assert.strictEqual(githubRepoSlug({ url: 'https://gitlab.com/a/b.git' }), null);
    assert.strictEqual(githubRepoSlug({}), null);
    assert.strictEqual(githubRepoSlug(undefined), null);
  });

  test('ciProblem: a release needs at least one check, all finished, all green', () => {
    const run = (name: string, status: string, conclusion: string | null) => ({
      name,
      status,
      conclusion,
    });
    assert.strictEqual(
      ciProblem({
        check_runs: [
          run('quality', 'completed', 'success'),
          run('docs', 'completed', 'skipped'),
          run('info', 'completed', 'neutral'),
        ],
      }),
      null,
    );
    assert.match(String(ciProblem({ check_runs: [] })), /no CI checks/);
    assert.match(String(ciProblem(undefined)), /no CI checks/);
    assert.match(
      String(ciProblem({ check_runs: [run('runtime', 'in_progress', null)] })),
      /still running: runtime/,
    );
    assert.match(
      String(
        ciProblem({
          check_runs: [run('quality', 'completed', 'failure'), run('w', 'completed', 'cancelled')],
        }),
      ),
      /not green: quality \(failure\), w \(cancelled\)/,
    );
  });

  test('expectServerRefusal: accepts only a [FATAL] "not supported" exit with code 1', async () => {
    const refuses = fakeServer(
      "process.stderr.write('[FATAL] Node.js v20.20.2 is not supported: upgrade\\n'); process.exit(1);",
    );
    assert.match(
      await expectServerRefusal(refuses),
      /^\[FATAL\] Node\.js v20\.20\.2 is not supported/,
    );
    assert.match(await expectServerRefusal(process.execPath, 10_000, [refuses]), /not supported/);

    const starts = fakeServer(RESPONDER(HEALTHY));
    await assert.rejects(expectServerRefusal(starts), /Expected a refusal, got exit 0/);
    const otherFatal = fakeServer(
      "process.stderr.write('[FATAL] License Pre-Flight Security Lock failed\\n'); process.exit(1);",
    );
    await assert.rejects(expectServerRefusal(otherFatal), /got exit 1: \[FATAL\] License/);
    const talks = fakeServer(
      "console.log('{}'); process.stderr.write('[FATAL] x is not supported\\n'); process.exit(1);",
    );
    await assert.rejects(expectServerRefusal(talks), /Expected a refusal/);
    const silent = fakeServer('process.exit(2);');
    await assert.rejects(expectServerRefusal(silent), /got exit 2/);
    const hangs = fakeServer('setInterval(() => {}, 1000);');
    await assert.rejects(expectServerRefusal(hangs, 200), /did not exit within 200 ms/);
    await assert.rejects(expectServerRefusal('/nonexistent/fqa-server'), /ENOENT/);
  });

  test('bumpVersion: release candidates, the next candidate, then the final version', () => {
    assert.strictEqual(bumpVersion('2.0.2', 'major', 'rc'), '3.0.0-rc.0');
    assert.strictEqual(bumpVersion('2.0.2', 'minor', 'rc'), '2.1.0-rc.0');
    assert.strictEqual(bumpVersion('2.0.2', 'patch', 'beta'), '2.0.3-beta.0');
    assert.strictEqual(bumpVersion('3.0.0-rc.0', 'prerelease'), '3.0.0-rc.1');
    assert.strictEqual(bumpVersion('3.0.0-rc.9', 'prerelease'), '3.0.0-rc.10');
    assert.strictEqual(bumpVersion('3.0.0-rc.1', 'release'), '3.0.0');
    assert.throws(() => bumpVersion('3.0.0-rc.1', 'major'), /is a release candidate/);
    assert.throws(() => bumpVersion('2.0.2', 'prerelease'), /not a release candidate/);
    assert.throws(() => bumpVersion('2.0.2', 'release'), /not a release candidate/);
    assert.throws(() => bumpVersion('3.0.0-weird', 'release'), /Cannot parse/);
  });

  test('Release args: --preid only with a patch, minor or major bump, in lowercase letters', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--bump', 'major', '--preid', 'rc']), {
      action: 'prepare',
      dryRun: false,
      yes: false,
      bump: 'major',
      preid: 'rc',
    });
    assert.deepStrictEqual(parseReleaseArgs(['--ship', '--bump', 'major', '--preid', 'rc']), {
      action: 'ship',
      dryRun: false,
      yes: false,
      bump: 'major',
      preid: 'rc',
    });
    assert.strictEqual(parseReleaseArgs(['--bump', 'prerelease']).bump, 'prerelease');
    assert.strictEqual(parseReleaseArgs(['--bump', 'release']).bump, 'release');
    assert.throws(() => parseReleaseArgs(['--preid', 'rc']), /--preid only applies/);
    assert.throws(() => parseReleaseArgs(['--bump', 'release', '--preid', 'rc']), /--preid only/);
    assert.throws(() => parseReleaseArgs(['--bump', 'major', '--preid', 'RC1']), /lowercase/);
  });

  test('stampChangelog: a release candidate copies the notes and leaves them for the final version', () => {
    const changelog = '# Changelog\n\n## Unreleased\n\n- Big change.\n\n## 2.0.2 - 2026-11-03\n';
    const rc = stampChangelog(changelog, '3.0.0-rc.0', '2026-11-10');
    assert.strictEqual(
      rc,
      '# Changelog\n\n## Unreleased\n\n- Big change.\n\n## 3.0.0-rc.0 - 2026-11-10\n\n- Big change.\n\n## 2.0.2 - 2026-11-03\n',
    );
    assert.strictEqual(extractChangelogSection(rc, '3.0.0-rc.0'), '- Big change.');
    const final = stampChangelog(rc, '3.0.0', '2026-11-20');
    assert.strictEqual(extractChangelogSection(final, '3.0.0'), '- Big change.');
    assert.match(
      final,
      /## Unreleased\n\n## 3\.0\.0 - 2026-11-20\n\n- Big change\.\n\n## 3\.0\.0-rc\.0/,
    );
    const last = stampChangelog('## Unreleased\n\n- Only.', '1.0.0-rc.0', 'd');
    assert.strictEqual(extractChangelogSection(last, '1.0.0-rc.0'), '- Only.');
  });

  test('listingProblems: the MCP Registry listing must point at exactly this package and version', () => {
    const pkg = {
      name: '@illicomedia/skills-mcp-server',
      mcpName: 'io.github.illicomedia/skills-mcp-server',
    };
    const good = {
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
      name: 'io.github.illicomedia/skills-mcp-server',
      description: 'QA skills.',
      version: '3.0.0',
      packages: [
        {
          registryType: 'npm',
          identifier: pkg.name,
          version: '3.0.0',
          transport: { type: 'stdio' },
        },
      ],
    };
    assert.deepStrictEqual(listingProblems(good, pkg, '3.0.0'), []);
    const problems = (change: Record<string, unknown>) =>
      listingProblems({ ...good, ...change }, pkg, '3.0.0').join(' | ');
    assert.match(problems({ $schema: 'x' }), /\$schema must be/);
    assert.match(problems({ name: 'io.github.someone-else/x' }), /name must be/);
    assert.match(problems({ name: 'com.example/x' }), /name must be/);
    assert.match(problems({ description: 'x'.repeat(101) }), /1 to 100 characters \(has 101\)/);
    assert.match(problems({ description: '' }), /has 0/);
    assert.match(
      problems({ version: '2.0.2' }),
      /version and packages\[0\]\.version must be 3\.0\.0/,
    );
    assert.match(problems({ packages: [] }), /exactly one npm package/);
    assert.match(
      problems({ packages: [{ ...good.packages[0], transport: { type: 'sse' } }] }),
      /over stdio/,
    );
    assert.match(
      listingProblems({}, pkg, '3.0.0').join(' | '),
      /name must be.*description.*version.*packages/,
    );
    assert.deepStrictEqual(listingAtVersion({ packages: undefined }, '3.0.0'), {
      packages: [],
      version: '3.0.0',
    });
  });

  test('Release args: --publish-listing retries the MCP Registry listing alone', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--publish-listing', '--dry-run']), {
      action: 'publish-listing',
      dryRun: true,
      yes: false,
    });
  });

  test('server.json in the repository matches package.json (name, version, npm package)', () => {
    const root = path.resolve(import.meta.dirname, '..', '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const listing = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
    assert.deepStrictEqual(listingProblems(listing, pkg, pkg.version), []);
  });

  test('Release args: --with-listing opts in to the MCP Registry, only for --promote or --ship', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--promote', '3.0.0', '--with-listing']), {
      action: 'promote',
      dryRun: false,
      yes: false,
      version: '3.0.0',
      withListing: true,
    });
    assert.strictEqual(parseReleaseArgs(['--ship', '--with-listing']).withListing, true);
    assert.strictEqual(parseReleaseArgs(['--promote', '3.0.0']).withListing, undefined);
    assert.throws(
      () => parseReleaseArgs(['--with-listing']),
      /only applies to --promote or --ship/,
    );
    assert.throws(
      () => parseReleaseArgs(['--deprecate', '1.0.0', '--message', 'x', '--with-listing']),
      /only applies to --promote or --ship/,
    );
  });

  test('Release args: --approve takes a version (candidates included)', () => {
    assert.deepStrictEqual(parseReleaseArgs(['--approve', '3.0.0']), {
      action: 'approve',
      dryRun: false,
      yes: false,
      version: '3.0.0',
    });
    assert.strictEqual(parseReleaseArgs(['--approve', '3.0.0-rc.1']).version, '3.0.0-rc.1');
    assert.throws(() => parseReleaseArgs(['--approve', 'latest']), /--approve expects a version/);
  });

  test('parseStageList: reads npm stage list blocks; "no staged versions" is empty', () => {
    const text =
      'id: s1\npackage name: @x/y\nversion: 1.0.0\nstatus: validating\nshasum: aa\n\nid: s2\nversion: 1.0.1\nstatus: staged';
    assert.deepStrictEqual(parseStageList(text), [
      { id: 's1', packageName: '@x/y', version: '1.0.0', status: 'validating', shasum: 'aa' },
      { id: 's2', version: '1.0.1', status: 'staged' },
    ]);
    assert.deepStrictEqual(parseStageList('No staged versions of package name "@x/y".'), []);
    assert.deepStrictEqual(parseStageList('status: orphan\nid: s3'), [{ id: 's3' }]);
  });

  test('Deprecation messages follow D21: cause, range to use, prerequisites; short; no command', () => {
    const name = '@illicomedia/skills-mcp-server';
    const valid = `End of life: 1.x no longer receives fixes. Upgrade to ${name}@^3.0.0 (requires Node.js 22+).`;
    assert.deepEqual(deprecationProblems(valid, name), []);
    assert.deepEqual(deprecationProblems(`Broken. Upgrade to ${name}@1.5.1 (none).`, name), []);
    assert.match(deprecationProblems('Broken. Use 1.5.1.', name).join(), /<Cause>\. Upgrade to/);
    assert.match(
      deprecationProblems(`Broken. Upgrade to other-pkg@^3.0.0 (none).`, name).join(),
      /<Cause>/,
    );
    assert.match(
      deprecationProblems(`Broken. Upgrade to ${name}@^3.0.0.`, name).join(),
      /<prerequisites>/,
    );
    const long = `${'Long cause '.repeat(22)}. Upgrade to ${name}@^3.0.0 (none).`;
    assert.match(deprecationProblems(long, name).join(), /256 at most/);
    const command = `Broken. Upgrade to ${name}@^3.0.0 (run npm install -g ${name}).`;
    assert.match(deprecationProblems(command, name).join(), /shell command/);
    assert.match(
      deprecationProblems(`Broken. Upgrade to ${name}@^3.0.0 (curl it).`, name).join(),
      /shell/,
    );
  });
});
