import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test, { describe } from 'node:test';
import { parse } from 'yaml';

describe('release › workflows', () => {
  /**
   * Policy tests: the CI decisions of the maintainers' decision record (D-numbers), checked on the workflow files.
   * A change that breaks one fails CI here, instead of being noticed during a release.
   */

  const ROOT = path.resolve(import.meta.dirname, '..', '..');
  const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

  interface Step {
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    [key: string]: unknown;
  }
  interface Job {
    uses?: string;
    needs?: string | string[];
    steps?: Step[];
    permissions?: Record<string, string>;
    environment?: string;
    strategy?: { matrix?: Record<string, unknown> };
    [key: string]: unknown;
  }
  interface Workflow {
    on: Record<string, unknown>;
    permissions?: unknown;
    jobs: Record<string, Job>;
  }

  const FILES = {
    ci: '.github/workflows/ci.yml',
    release: '.github/workflows/release.yml',
    scorecard: '.github/workflows/scorecard.yml',
  };
  /** Every workflow file, so a new one is checked by the general rules without being listed. */
  const WORKFLOW_FILES = fs
    .readdirSync(path.join(ROOT, '.github', 'workflows'))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => `.github/workflows/${name}`)
    .sort();
  const ci = parse(read(FILES.ci)) as Workflow;
  const release = parse(read(FILES.release)) as Workflow;
  const workflows: [string, Workflow][] = WORKFLOW_FILES.map((file) => [
    file,
    parse(read(file)) as Workflow,
  ]);

  function allJobs(): [string, string, Job][] {
    return workflows.flatMap(([file, wf]) =>
      Object.entries(wf.jobs).map(([name, job]): [string, string, Job] => [file, name, job]),
    );
  }

  function allSteps(): [string, string, Step][] {
    return allJobs().flatMap(([file, name, job]) =>
      (job.steps ?? []).map((step): [string, string, Step] => [file, name, step]),
    );
  }

  const needs = (job: Job): string[] => [job.needs ?? []].flat();

  /** The major lines of package.json "engines", e.g. ^22.0.0 || ^24.0.0 || >=26.0.0 -> 22, 24, 26. */
  function engineLines(): number[] {
    const range = JSON.parse(read('package.json')).engines.node as string;
    return range.split('||').map((part) => Number(/(\d+)\./.exec(part)?.[1]));
  }

  test('D9: every third-party action is pinned to a full commit SHA, with its version noted', () => {
    for (const file of WORKFLOW_FILES) {
      for (const [, ref, rest] of read(file).matchAll(/uses:\s*(\S+)(.*)$/gm)) {
        if (ref.startsWith('./')) {
          continue;
        }
        assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}: ${ref}`);
        assert.match(rest, /#\s*v\d+\.\d+\.\d+/, `${file}: ${ref} needs a "# vX.Y.Z" comment`);
      }
    }
  });

  test('D9: every CI tool image is pinned by digest, and Dependabot updates it', () => {
    const dependabot = parse(read('.github/dependabot.yml')) as {
      updates: Array<{ 'package-ecosystem': string; directory: string }>;
    };
    const dockerDirs = dependabot.updates
      .filter((update) => update['package-ecosystem'] === 'docker')
      .map((update) => update.directory);
    const images = fs
      .readdirSync(path.join(ROOT, '.github'), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(ROOT, '.github', entry.name, 'Dockerfile')),
      )
      .map((entry) => entry.name);
    assert.deepStrictEqual(images.sort(), ['actionlint', 'zizmor']);
    for (const image of images) {
      const from = read(`.github/${image}/Dockerfile`).match(/^FROM\s+(\S+)/m)?.[1] ?? '';
      assert.match(from, /:[\w.-]+@sha256:[0-9a-f]{64}$/, `${image}: ${from}`);
      assert.ok(dockerDirs.includes(`/.github/${image}`), `Dependabot does not watch ${image}`);
    }
    const ecosystems = dependabot.updates.map((update) => update['package-ecosystem']);
    assert.ok(ecosystems.includes('github-actions') && ecosystems.includes('npm'));
  });

  test('D11: least privilege: read-only defaults, write only where a job needs it', () => {
    assert.deepStrictEqual(ci.permissions, { contents: 'read' });
    for (const [file, wf] of workflows.filter(([file]) => file !== FILES.ci)) {
      assert.deepStrictEqual(wf.permissions, {}, `${file}: no workflow-level permissions`);
    }
    assert.deepStrictEqual(
      WORKFLOW_FILES,
      Object.values(FILES).sort(),
      'a new workflow needs review',
    );
    const grants = allJobs().flatMap(([file, name, job]) =>
      Object.entries(job.permissions ?? {})
        .filter(([, level]) => level === 'write')
        .map(([scope]) => `${file}:${name}:${scope}`),
    );
    assert.deepStrictEqual(grants.sort(), [
      `${FILES.release}:github-release:contents`,
      `${FILES.release}:publish:id-token`,
      `${FILES.scorecard}:analysis:id-token`,
      `${FILES.scorecard}:analysis:security-events`,
    ]);
  });

  test('D11: no saved Git credentials, no package caches, no ${{ }} inside shell', () => {
    for (const [file, job, step] of allSteps()) {
      const where = `${file}:${job}: ${step.uses ?? step.run}`;
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.strictEqual(step.with?.['persist-credentials'], false, where);
      }
      if (step.uses?.startsWith('actions/setup-node@')) {
        assert.strictEqual(step.with?.['package-manager-cache'], false, where);
        assert.strictEqual(step.with?.cache, undefined, where);
      }
      if (step.run) {
        assert.ok(!step.run.includes('${{'), `${where}: pass values through env, not \${{ }}`);
      }
    }
  });

  test('D18: workflows stay thin: every run calls a tested command or a pinned tool', () => {
    const allowed = [
      /^node scripts\/release\.mjs --[a-z-]+( |$)/,
      /^pnpm (install --frozen-lockfile|run [a-z:]+|pack --pack-destination \w+)$/,
      /^docker (build --quiet --tag [a-z-]+ \.github\/[a-z]+|run --rm )/,
    ];
    for (const [file, job, step] of allSteps()) {
      if (step.run) {
        const command = step.run.trim();
        assert.ok(
          allowed.some((pattern) => pattern.test(command)),
          `${file}:${job} runs logic in shell; move it to scripts/release.mjs: ${command}`,
        );
      }
    }
  });

  test('D10: third-party tools run sealed', () => {
    const dockerRuns = allSteps()
      .map(([, , step]) => step.run ?? '')
      .filter((run) => run.startsWith('docker run'));
    assert.strictEqual(dockerRuns.length, 2, 'actionlint and zizmor');
    for (const run of dockerRuns) {
      for (const flag of [
        '--network none',
        '--read-only',
        '--cap-drop ALL',
        '--security-opt no-new-privileges',
        '--user "$(id -u):$(id -g)"',
        ':/repo:ro',
      ]) {
        assert.ok(run.includes(flag), `${run}\nmissing ${flag}`);
      }
    }
    assert.ok(dockerRuns.some((run) => /zizmor-pinned --offline/.test(run)));
  });

  test('D1, D2, D4: npm only through staging, after the full CI of the tag', () => {
    for (const [file, job, step] of allSteps()) {
      assert.ok(
        !/\bnpm publish\b/.test(step.run ?? ''),
        `${file}:${job} must not publish directly`,
      );
    }
    const jobs = release.jobs;
    assert.strictEqual(jobs.ci.uses, './.github/workflows/ci.yml');
    assert.ok('workflow_call' in ci.on, 'ci.yml must be callable by release.yml');
    assert.ok(needs(jobs.build).includes('ci') && needs(jobs.build).includes('tag'));
    assert.ok(needs(jobs.publish).includes('build'));
    assert.ok(needs(jobs['github-release']).includes('publish'));
    assert.strictEqual(jobs.publish.environment, 'npm-publish');
    assert.ok(
      (jobs.publish.steps ?? []).some((step) => step.run?.includes('--stage --tarball-dir')),
    );
    const triggers = (release.on.push as { tags: string[] }).tags;
    assert.deepStrictEqual(triggers, ['v[0-9]+.[0-9]+.[0-9]+', 'v[0-9]+.[0-9]+.[0-9]+-*']);
  });

  test('D5: CI rehearses the release on every push', () => {
    const runs = (ci.jobs.package.steps ?? []).map((step) => step.run ?? '');
    assert.ok(runs.includes('node scripts/release.mjs --rehearse --tarball-dir packed'));
    assert.ok(runs.some((run) => run.startsWith('pnpm pack --pack-destination packed')));
  });

  test('D7: Node.js matrices follow package.json "engines"; 18 and 20 must be refused', () => {
    const lines = engineLines();
    assert.deepStrictEqual(lines, [22, 24, 26]);
    assert.deepStrictEqual(
      ci.jobs.quality.strategy?.matrix?.['node-version'],
      lines.map((line) => `${line}.x`),
    );
    assert.deepStrictEqual(
      ci.jobs.runtime.strategy?.matrix?.['node-version'],
      lines.flatMap((line) => [`${line}.0.0`, `${line}.x`]),
    );
    assert.deepStrictEqual(ci.jobs.refused.strategy?.matrix?.['node-version'], ['18.x', '20.x']);
    assert.ok(
      (ci.jobs.refused.steps ?? []).some((step) =>
        step.run?.startsWith('node scripts/release.mjs --expect-refusal'),
      ),
    );
  });

  test('D16: every platform is required, and every job has a time limit', () => {
    const include = ci.jobs.runtime.strategy?.matrix?.include as Array<{ os: string }>;
    assert.deepStrictEqual(include.map((entry) => entry.os).sort(), [
      'macos-latest',
      'windows-latest',
    ]);
    for (const [file, name, job] of allJobs()) {
      assert.ok(!('continue-on-error' in job), `${file}:${name}`);
      for (const step of job.steps ?? []) {
        assert.ok(!('continue-on-error' in step), `${file}:${name}`);
      }
      if (!job.uses) {
        const limit = job['timeout-minutes'];
        assert.ok(typeof limit === 'number' && limit > 0 && limit <= 30, `${file}:${name}`);
      }
    }
  });

  test('D8: pnpm is pinned by version and hash (Corepack verifies the download)', () => {
    const { packageManager } = JSON.parse(read('package.json')) as { packageManager: string };
    assert.match(packageManager, /^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
  });

  test('D18: CI runs every quality gate: lint, test types, dead code, duplicates, coverage, package metadata', () => {
    const runs = (ci.jobs.quality.steps ?? []).map((step) => step.run);
    for (const gate of [
      'lint',
      'lint:types',
      'lint:dead',
      'lint:duplicates',
      'test:coverage',
      'lint:package',
    ]) {
      assert.ok(runs.includes(`pnpm run ${gate}`), `quality job must run pnpm run ${gate}`);
    }
  });

  test('D21 / License Retention: SERVER_RELEASE_DATE matches current version date in CHANGELOG.md', async () => {
    const { version } = JSON.parse(read('package.json')) as { version: string };
    const changelog = read('CHANGELOG.md');
    const match = new RegExp(
      `^## \\[?${version.replace(/\\./g, '\\.')}\\]?\\s*-\\s*(\\d{4}-\\d{2}-\\d{2})`,
      'm',
    ).exec(changelog);
    assert.ok(
      match,
      `CHANGELOG.md must contain a section for version ${version} with its release date`,
    );
    const changelogDate = match[1];
    const { SERVER_RELEASE_DATE } = await import('../../dist/license/keys.js');
    assert.strictEqual(
      SERVER_RELEASE_DATE,
      `${changelogDate}T00:00:00Z`,
      `SERVER_RELEASE_DATE (${SERVER_RELEASE_DATE}) must equal CHANGELOG release date (${changelogDate}T00:00:00Z)`,
    );
  });
});
