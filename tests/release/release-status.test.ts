import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { type ReleaseContext, status } from '../../scripts/release-flow.mjs';
import { parseReleaseArgs, unreleasedSummary } from '../../scripts/release-lib.mjs';

describe('release › release-status', () => {
  const PKG = { name: '@illicomedia/skills-mcp-server', version: '3.2.0' };
  const READ_ONLY =
    /^(git (rev-parse|status --porcelain|tag --list|rev-list --count|log)( |$)|npm view )/;

  interface World {
    changelog: string;
    tags: string[];
    npm: string | Error;
    dirty: string;
    branch: string;
    sinceTag: string[];
    unpushed: number;
  }

  function world(overrides: Partial<World> = {}) {
    const w: World = {
      changelog: '# Changelog\n\n## Unreleased\n\n## 3.2.0 - 2026-11-11\n\n- Done.\n',
      tags: ['v3.2.0'],
      npm: JSON.stringify({ versions: ['3.1.0', '3.2.0'], 'dist-tags': { latest: '3.2.0' } }),
      dirty: '',
      branch: 'main',
      sinceTag: [],
      unpushed: 0,
      ...overrides,
    };
    const calls: string[] = [];
    const logs: string[] = [];
    const writes: string[] = [];
    const say = (message: string) => logs.push(message);
    const npmAnswer = (): string => {
      if (w.npm instanceof Error) {
        throw w.npm;
      }
      return w.npm;
    };
    const ctx = {
      pkgDir: '/pkg',
      join: path.posix.join,
      readFile: () => w.changelog,
      writeFile: (file: string) => writes.push(file),
      confirm: async () => {
        throw new Error('status must never ask');
      },
      log: say,
      ok: say,
      warn: say,
      sh(command: string, args: string[]) {
        const line = `${command} ${args.join(' ')}`;
        calls.push(line);
        if (command === 'npm') {
          return npmAnswer();
        }
        const answers: Record<string, string> = {
          'rev-parse': w.branch,
          status: w.dirty,
          tag: w.tags.includes(args[2]) ? args[2] : '',
          'rev-list': String(w.unpushed),
          log: w.sinceTag.join('\n'),
        };
        return answers[args[0]];
      },
    } as unknown as ReleaseContext;
    return { ctx, calls, logs, writes, text: () => logs.join('\n') };
  }

  test('args: nothing, or only --dry-run / --yes, is the read-only status; a release needs --bump', () => {
    for (const argv of [[], ['--'], ['--dry-run'], ['-y'], ['--yes', '--dry-run']]) {
      assert.equal(parseReleaseArgs(argv).action, 'status', argv.join(' '));
    }
    assert.equal(parseReleaseArgs(['--bump', 'patch']).action, 'prepare');
    assert.equal(parseReleaseArgs(['--bump', 'minor', '--dry-run']).action, 'prepare');
    assert.throws(() => parseReleaseArgs(['--preid', 'rc']), /--preid only applies with --bump/);
  });

  test('unreleasedSummary: headings, entries and the bump they call for', () => {
    const notes = (body: string) =>
      unreleasedSummary(`# Changelog\n\n## Unreleased\n${body}\n## 1.0.0 - 2026-01-01\n\n- Old.\n`);
    assert.deepEqual(notes('\n'), { headings: [], entries: 0, bump: null });
    assert.deepEqual(notes('\n### Fixed\n\n- a\n- b\n'), {
      headings: ['Fixed'],
      entries: 2,
      bump: 'patch',
    });
    assert.deepEqual(notes('\n- loose note\n'), { headings: [], entries: 1, bump: 'patch' });
    assert.deepEqual(notes('\n### Changed\n\n- a\n'), {
      headings: ['Changed'],
      entries: 1,
      bump: 'minor',
    });
    assert.deepEqual(notes('\n### Added\n\n- a\n\n### Fixed\n\n- b\n'), {
      headings: ['Added', 'Fixed'],
      entries: 2,
      bump: 'minor',
    });
    assert.deepEqual(notes('\n### Fixed\n\n- a\n\n### Breaking\n\n- b\n  continued\n'), {
      headings: ['Fixed', 'Breaking'],
      entries: 2,
      bump: 'major',
    });
    assert.deepEqual(unreleasedSummary('# Changelog\n\n## 1.0.0 - 2026-01-01\n\n- Old.\n'), {
      headings: [],
      entries: 0,
      bump: null,
    });
    assert.deepEqual(unreleasedSummary(''), { headings: [], entries: 0, bump: null });
  });

  test('status: everything released and pushed: says so, suggests nothing', async () => {
    const { ctx, text } = world();
    const result = await status(ctx, PKG);
    assert.deepEqual(result, {
      version: '3.2.0',
      latest: '3.2.0',
      next: null,
      tagged: true,
      commitsSinceTag: 0,
      unpushed: 0,
      dirty: 0,
      bump: null,
    });
    assert.match(text(), /npm latest: v3\.2\.0/);
    assert.match(text(), /Nothing to release/);
    assert.doesNotMatch(text(), /pnpm release --/);
  });

  test('status: pending commits and changelog notes: lists them and the next command', async () => {
    const { ctx, text } = world({
      changelog:
        '# Changelog\n\n## Unreleased\n\n### Added\n\n- help\n\n### Fixed\n\n- colour\n\n## 3.2.0 - 2026-11-11\n',
      sinceTag: Array.from({ length: 14 }, (_, i) => `fix: change ${i + 1}`),
      unpushed: 4,
      dirty: ' M package.json\n?? notes.txt\n',
    });
    const result = await status(ctx, PKG);
    assert.equal(result.commitsSinceTag, 14);
    assert.equal(result.unpushed, 4);
    assert.equal(result.dirty, 2);
    assert.equal(result.bump, 'minor');
    const out = text();
    assert.match(out, /14 commits since v3\.2\.0/);
    assert.match(out, /fix: change 1\b/);
    assert.match(out, /fix: change 10\b/);
    assert.doesNotMatch(out, /fix: change 11\b/);
    assert.match(out, /and 4 more/);
    assert.match(out, /4 commits not pushed/);
    assert.match(out, /2 uncommitted files/);
    assert.match(out, /Unreleased notes: 2 \(Added, Fixed\)/);
    assert.match(out, /pnpm release --bump minor --dry-run/);
  });

  test('status: commits without changelog notes: asks for notes, suggests no bump', async () => {
    const { ctx, text } = world({ sinceTag: ['docs: typo'] });
    const result = await status(ctx, PKG);
    assert.equal(result.bump, null);
    assert.match(text(), /1 commit since v3\.2\.0/);
    assert.match(text(), /no notes under "## Unreleased"/);
  });

  test('status: a version waiting under "next" points to --promote', async () => {
    const { ctx, text } = world({
      npm: JSON.stringify({
        versions: ['3.1.0', '3.2.0'],
        'dist-tags': { latest: '3.1.0', next: '3.2.0' },
      }),
    });
    const result = await status(ctx, PKG);
    assert.equal(result.next, '3.2.0');
    assert.match(text(), /npm next: +v3\.2\.0/);
    assert.match(text(), /pnpm release --promote 3\.2\.0/);
  });

  test('status: version of package.json not tagged or not on npm yet', async () => {
    const { ctx, text } = world({
      tags: [],
      npm: JSON.stringify({ versions: ['3.1.0'], 'dist-tags': { latest: '3.1.0' } }),
    });
    const result = await status(ctx, PKG);
    assert.equal(result.tagged, false);
    assert.equal(result.commitsSinceTag, null);
    assert.match(text(), /v3\.2\.0 is not tagged/);
    assert.match(text(), /not on npm/);
  });

  test('status: npm unreachable or package unknown: reported, never thrown', async () => {
    const offline = world({ npm: new Error('ENOTFOUND registry.npmjs.org') });
    assert.equal((await status(offline.ctx, PKG)).latest, null);
    assert.match(offline.text(), /npm registry not reachable/);

    const unknown = world({ npm: new Error('npm error code E404') });
    assert.equal((await status(unknown.ctx, PKG)).latest, null);
    assert.match(unknown.text(), /never published/);
  });

  test('status: notes without any heading still count, as a patch', async () => {
    const { ctx, text } = world({
      changelog: '# Changelog\n\n## Unreleased\n\n- loose\n\n## 3.2.0 - x\n',
    });
    assert.equal((await status(ctx, PKG)).bump, 'patch');
    assert.match(text(), /Unreleased notes: 1 in CHANGELOG\.md/);
    assert.match(text(), /pnpm release --bump patch --dry-run/);
  });

  test('status: published versions without a "latest" tag show none', async () => {
    const { ctx, text } = world({ npm: JSON.stringify({ versions: ['3.2.0'], 'dist-tags': {} }) });
    const result = await status(ctx, PKG);
    assert.equal(result.latest, null);
    assert.equal(result.next, null);
    assert.match(text(), /npm latest: none/);
  });

  test('status: another branch is named', async () => {
    const { ctx, text } = world({ branch: 'feature/x' });
    await status(ctx, PKG);
    assert.match(text(), /On branch feature\/x \(releases are cut from main\)/);
  });

  test('status: runs read-only commands only, writes nothing, asks nothing', async () => {
    for (const overrides of [{}, { sinceTag: ['a'], unpushed: 1, dirty: ' M x\n' }, { tags: [] }]) {
      const { ctx, calls, writes } = world(overrides);
      await status(ctx, PKG);
      assert.deepEqual(writes, []);
      assert.ok(calls.length > 0);
      for (const call of calls) {
        assert.match(call, READ_ONLY, call);
      }
    }
  });
});
