import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import {
  applySettings,
  checkSettings,
  parseSettingsArgs,
  planSettings,
  readState,
} from '../scripts/github-settings-flow.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DECLARED = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'settings.json'), 'utf8'));
const REPO = '/repos/illicomedia/skills-mcp-server';
const ENV = `${REPO}/environments/npm-publish`;
const USER_ID = 4242;

interface Ruleset {
  id: number;
  name: string;
  target: string;
  enforcement: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
  rules?: { type: string }[];
  bypass_actors?: { actor_id: number; actor_type: string; bypass_mode: string }[];
}

/** A fake GitHub API holding a repository's settings; writes change what later reads return. */
function fakeGitHub(start: { configured?: boolean } = {}) {
  const gh = {
    rulesets: [] as Ruleset[],
    environment: null as null | Record<string, unknown>,
    policies: [] as { name: string; type: string }[],
    actions: { enabled: true, allowed_actions: 'all', sha_pinning_required: false },
    selected: {
      github_owned_allowed: false,
      verified_allowed: false,
      patterns_allowed: [] as string[],
    },
    workflow: { default_workflow_permissions: 'write', can_approve_pull_request_reviews: true },
    fork: 'first_time_contributors',
    pvr: false,
    alerts: false,
    fixes: null as null | boolean,
    analysis: {
      secret_scanning: { status: 'disabled' },
      secret_scanning_push_protection: { status: 'disabled' },
    },
    failOn: null as null | string,
    getStatus: {} as Record<string, number>,
    requests: [] as string[],
    nextId: 1,
  };
  const writes = (): string[] => gh.requests.filter((request) => !request.startsWith('GET'));

  const handlers: Record<string, (body: Record<string, unknown>, match: string[]) => unknown> = {
    [`GET ${REPO}/rulesets?includes_parents=false`]: () => gh.rulesets.map(({ id }) => ({ id })),
    [`GET ${REPO}/rulesets/(\\d+)`]: (_body, [id]) => gh.rulesets.find((r) => r.id === Number(id)),
    [`POST ${REPO}/rulesets`]: (body) => {
      gh.rulesets.push({ ...(body as unknown as Ruleset), id: gh.nextId++ });
      return {};
    },
    [`PUT ${REPO}/rulesets/(\\d+)`]: (body, [id]) => {
      gh.rulesets = gh.rulesets.map((r) =>
        r.id === Number(id) ? { ...(body as unknown as Ruleset), id: r.id } : r,
      );
      return {};
    },
    'GET /users/illicomedia': () => ({ id: USER_ID, login: 'illicomedia' }),
    [`GET ${ENV}`]: () => gh.environment,
    [`PUT ${ENV}`]: (body) => {
      const reviewers = (body.reviewers as { id: number }[]).map(({ id }) => ({
        type: 'User',
        reviewer: { id, login: id === USER_ID ? 'illicomedia' : 'someone' },
      }));
      gh.environment = {
        can_admins_bypass: body.can_admins_bypass,
        deployment_branch_policy: body.deployment_branch_policy,
        protection_rules: [
          { type: 'required_reviewers', prevent_self_review: body.prevent_self_review, reviewers },
          { type: 'branch_policy' },
        ],
      };
      return {};
    },
    [`GET ${ENV}/deployment-branch-policies`]: () => ({ branch_policies: gh.policies }),
    [`POST ${ENV}/deployment-branch-policies`]: (body) => {
      gh.policies.push(body as { name: string; type: string });
      return {};
    },
    [`GET ${REPO}/actions/permissions`]: () => gh.actions,
    [`PUT ${REPO}/actions/permissions`]: (body) => Object.assign(gh.actions, body),
    [`GET ${REPO}/actions/permissions/selected-actions`]: () => gh.selected,
    [`PUT ${REPO}/actions/permissions/selected-actions`]: (body) =>
      Object.assign(gh.selected, body),
    [`GET ${REPO}/actions/permissions/workflow`]: () => gh.workflow,
    [`PUT ${REPO}/actions/permissions/workflow`]: (body) => Object.assign(gh.workflow, body),
    [`GET ${REPO}/actions/permissions/fork-pr-contributor-approval`]: () => ({
      approval_policy: gh.fork,
    }),
    [`PUT ${REPO}/actions/permissions/fork-pr-contributor-approval`]: (body) => {
      gh.fork = body.approval_policy as string;
      return {};
    },
    [`GET ${REPO}/private-vulnerability-reporting`]: () => ({ enabled: gh.pvr }),
    [`PUT ${REPO}/private-vulnerability-reporting`]: () => {
      gh.pvr = true;
    },
    [`DELETE ${REPO}/private-vulnerability-reporting`]: () => {
      gh.pvr = false;
    },
    [`PUT ${REPO}/vulnerability-alerts`]: () => {
      gh.alerts = true;
    },
    [`PUT ${REPO}/automated-security-fixes`]: () => {
      gh.fixes = true;
    },
    [`GET ${REPO}`]: () => ({ security_and_analysis: gh.analysis }),
    [`PATCH ${REPO}`]: (body) => {
      gh.analysis = (body as { security_and_analysis: typeof gh.analysis }).security_and_analysis;
      return {};
    },
  };

  const specials: Record<string, () => { status: number; data: unknown }> = {
    [`GET ${REPO}/vulnerability-alerts`]: () => ({ status: gh.alerts ? 204 : 404, data: null }),
    [`GET ${REPO}/automated-security-fixes`]: () =>
      gh.fixes === null
        ? { status: 404, data: null }
        : { status: 200, data: { enabled: gh.fixes } },
  };

  /** null: not found; undefined: no content; anything else: the answer. */
  const respond = (method: string, data: unknown) => {
    if (data === null || data === undefined) {
      return { status: data === null ? 404 : 204, data: null };
    }
    return { status: method === 'POST' ? 201 : 200, data };
  };

  function route(request: string) {
    for (const [pattern, handler] of Object.entries(handlers)) {
      const match = new RegExp(`^${pattern.replace(/[?]/g, '\\?')}$`).exec(request);
      if (match) {
        return { handler, args: match.slice(1) };
      }
    }
    return null;
  }

  async function api(method: string, url: string, body?: Record<string, unknown>) {
    const request = `${method} ${url}`;
    gh.requests.push(request);
    if (gh.failOn === request) {
      return { status: 422, data: { message: 'Validation Failed' } };
    }
    if (gh.getStatus[url]) {
      return { status: gh.getStatus[url], data: { message: 'Forbidden' } };
    }
    const special = specials[request];
    if (special) {
      return special();
    }
    const found = route(request);
    return found
      ? respond(method, found.handler(body ?? {}, found.args))
      : { status: 404, data: { message: 'Not Found' } };
  }

  const logs: string[] = [];
  const questions: string[] = [];
  const ctx = {
    api,
    interactive: true,
    answer: true,
    async confirm(question: string) {
      questions.push(question);
      return ctx.answer;
    },
    log: (message: string) => logs.push(message),
    ok: (message: string) => logs.push(message),
    warn: (message: string) => logs.push(message),
  };
  if (start.configured) {
    return { gh, ctx, logs, questions, writes, ready: applySettings(ctx, DECLARED, { yes: true }) };
  }
  return { gh, ctx, logs, questions, writes, ready: Promise.resolve(true) };
}

test('Settings args: one action, --yes, an optional token file; anything else is refused', () => {
  assert.deepStrictEqual(parseSettingsArgs(['--check']), {
    action: 'check',
    yes: false,
    tokenFile: null,
  });
  assert.deepStrictEqual(parseSettingsArgs(['--', '--apply', '-y', '--token-file', '/t']), {
    action: 'apply',
    yes: true,
    tokenFile: '/t',
  });
  assert.strictEqual(parseSettingsArgs(['--apply', '--yes']).yes, true);
  assert.throws(() => parseSettingsArgs([]), /Choose one of --check or --apply/);
  assert.throws(() => parseSettingsArgs(['--check', '--apply']), /Choose one/);
  assert.throws(() => parseSettingsArgs(['--check', '--token-file']), /expects a path/);
  assert.throws(() => parseSettingsArgs(['--delete-everything']), /Unknown option/);
});

test('A bare repository is configured in a safe order, then read back as matching', async () => {
  const { gh, ctx, writes, questions } = fakeGitHub();
  assert.strictEqual(await checkSettings(ctx, DECLARED), false);
  assert.strictEqual(await applySettings(ctx, DECLARED), true);
  assert.deepStrictEqual(questions, ['Apply 13 change(s) to GitHub?']);
  const order = writes();
  const before = (a: string, b: string) =>
    assert.ok(order.indexOf(a) < order.indexOf(b), `${a} < ${b}`);
  before(`PUT ${REPO}/actions/permissions`, `PUT ${REPO}/actions/permissions/selected-actions`);
  before(`PUT ${REPO}/vulnerability-alerts`, `PUT ${REPO}/automated-security-fixes`);
  before(`PUT ${ENV}`, `POST ${ENV}/deployment-branch-policies`);
  assert.deepStrictEqual(
    gh.rulesets.map((r) => [r.name, r.bypass_actors?.length]),
    [
      ['main', 0],
      ['release tags: who creates', 1],
      ['release tags: immutable', 0],
    ],
  );
  assert.deepStrictEqual(gh.rulesets[1].bypass_actors, [
    { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
  ]);
  assert.strictEqual(gh.environment?.can_admins_bypass, false);
  assert.deepStrictEqual(gh.policies, [{ name: 'v*', type: 'tag' }]);
  assert.strictEqual(gh.actions.sha_pinning_required, true);
  assert.strictEqual(gh.workflow.default_workflow_permissions, 'read');
  assert.ok(!order.some((request) => request.startsWith('DELETE')), 'nothing deleted');
});

test('An already configured repository needs nothing; a changed ruleset is updated in place', async () => {
  const world = fakeGitHub({ configured: true });
  await world.ready;
  const writesBefore = world.writes().length;
  assert.strictEqual(await applySettings(world.ctx, DECLARED), true);
  assert.strictEqual(world.writes().length, writesBefore, 'no write when nothing differs');
  assert.ok(world.logs.includes('Nothing to change.'));

  world.gh.rulesets[0].rules = [{ type: 'deletion' }];
  assert.strictEqual(await checkSettings(world.ctx, DECLARED), false);
  assert.strictEqual(await applySettings(world.ctx, DECLARED, { yes: true }), true);
  assert.strictEqual(world.writes().at(-1), `PUT ${REPO}/rulesets/${world.gh.rulesets[0].id}`);
});

test('Undeclared rulesets and deployment policies are reported, never deleted', async () => {
  const world = fakeGitHub({ configured: true });
  await world.ready;
  world.gh.rulesets.push({ id: 99, name: 'legacy', target: 'branch', enforcement: 'active' });
  world.gh.policies.push({ name: 'v*', type: 'branch' });
  assert.strictEqual(await checkSettings(world.ctx, DECLARED), false);
  assert.strictEqual(await applySettings(world.ctx, DECLARED, { yes: true }), false);
  assert.ok(
    world.logs.some((line) => line.includes('ruleset "legacy" exists but is not declared')),
  );
  assert.ok(
    world.logs.some((line) => line.includes('deployment policy branch:v* on "npm-publish"')),
  );
  assert.ok(!world.gh.requests.some((request) => request.startsWith('DELETE')));
  assert.strictEqual(world.gh.rulesets.length, 4);
});

test('Applying waits for a yes, and fails closed without a terminal', async () => {
  const declined = fakeGitHub();
  declined.ctx.answer = false;
  assert.strictEqual(await applySettings(declined.ctx, DECLARED), false);
  assert.deepStrictEqual(declined.writes(), []);

  const unattended = fakeGitHub();
  unattended.ctx.interactive = false;
  await assert.rejects(applySettings(unattended.ctx, DECLARED), /pass --yes/);
  assert.deepStrictEqual(unattended.writes(), []);
});

test('GitHub errors stop the run with the endpoint and the reason', async () => {
  const failing = fakeGitHub();
  failing.gh.failOn = `POST ${REPO}/rulesets`;
  await assert.rejects(
    applySettings(failing.ctx, DECLARED, { yes: true }),
    /create ruleset "main" failed: 422 Validation Failed/,
  );
  const forbidden = fakeGitHub();
  forbidden.gh.getStatus[`${REPO}/actions/permissions`] = 403;
  await assert.rejects(
    readState(forbidden.ctx, DECLARED),
    /actions\/permissions answered 403: Forbidden/,
  );
  const broken = fakeGitHub();
  broken.gh.getStatus[ENV] = 500;
  await assert.rejects(readState(broken.ctx, DECLARED), /npm-publish answered 500/);
  const silent = fakeGitHub();
  silent.ctx.api = async () => ({ status: 401, data: null });
  await assert.rejects(readState(silent.ctx, DECLARED), /answered 401: no details/);
});

test('Settings can also be switched off: features are disabled, not left as they were', () => {
  const declared = {
    ...DECLARED,
    security: {
      privateVulnerabilityReporting: false,
      vulnerabilityAlerts: true,
      automatedSecurityFixes: true,
      secretScanning: false,
      pushProtection: false,
    },
  };
  const state = {
    rulesets: [],
    reviewerIds: { illicomedia: USER_ID },
    environment: null,
    actions: { enabled: true, allowed_actions: 'all', sha_pinning_required: false },
    selectedActions: null,
    workflow: {},
    forkApproval: 'x',
    security: {
      privateVulnerabilityReporting: true,
      vulnerabilityAlerts: true,
      automatedSecurityFixes: true,
      secretScanning: true,
      pushProtection: true,
    },
  };
  const { changes } = planSettings(declared, state);
  const pvr = changes.find((change) => change.path.endsWith('private-vulnerability-reporting'));
  assert.strictEqual(pvr?.method, 'DELETE');
  const patch = changes.find((change) => change.method === 'PATCH');
  assert.deepStrictEqual(patch?.body, {
    security_and_analysis: {
      secret_scanning: { status: 'disabled' },
      secret_scanning_push_protection: { status: 'disabled' },
    },
  });
});

test('.github/settings.json allows every action the workflows use', () => {
  const allowed = DECLARED.actions.patternsAllowed.map((pattern: string) => pattern.split('@')[0]);
  const dir = path.join(ROOT, '.github', 'workflows');
  for (const file of fs.readdirSync(dir)) {
    for (const [, ref] of fs
      .readFileSync(path.join(dir, file), 'utf8')
      .matchAll(/uses:\s*([^@\s]+)@/g)) {
      if (ref.startsWith('./')) {
        continue;
      }
      const owner = ref.split('/')[0];
      const githubOwned =
        DECLARED.actions.githubOwnedAllowed && ['actions', 'github'].includes(owner);
      const action = ref.split('/').slice(0, 2).join('/');
      assert.ok(githubOwned || allowed.includes(action), `${file}: ${ref} is not allowed`);
    }
  }
});

test('Sparse GitHub answers (missing fields) are read as "not configured", errors without details', async () => {
  const answers: Record<string, { status: number; data: unknown }> = {
    [`${REPO}/rulesets?includes_parents=false`]: { status: 200, data: [] },
    '/users/illicomedia': { status: 200, data: { id: USER_ID } },
    [ENV]: { status: 200, data: { protection_rules: [{ type: 'required_reviewers' }] } },
    [`${ENV}/deployment-branch-policies`]: { status: 200, data: {} },
    [`${REPO}/actions/permissions`]: { status: 200, data: { allowed_actions: 'selected' } },
    [`${REPO}/actions/permissions/selected-actions`]: { status: 200, data: {} },
    [`${REPO}/actions/permissions/workflow`]: { status: 200, data: {} },
    [`${REPO}/actions/permissions/fork-pr-contributor-approval`]: { status: 200, data: {} },
    [`${REPO}/private-vulnerability-reporting`]: { status: 200, data: { enabled: false } },
    [`${REPO}/vulnerability-alerts`]: { status: 404, data: null },
    [`${REPO}/automated-security-fixes`]: { status: 200, data: { enabled: false } },
    [REPO]: { status: 200, data: {} },
  };
  const ctx = {
    api: async (method: string, url: string) =>
      method === 'GET'
        ? (answers[url] ?? { status: 404, data: null })
        : { status: 500, data: null },
    interactive: false,
    confirm: async () => true,
    log: () => undefined,
    ok: () => undefined,
    warn: () => undefined,
  };
  const state = await readState(ctx, DECLARED);
  assert.deepStrictEqual(state.environment, {
    reviewers: [],
    preventSelfReview: false,
    adminsBypass: undefined,
    customPolicies: false,
    policies: [],
  });
  assert.strictEqual(state.security.secretScanning, false);
  assert.ok(
    planSettings(DECLARED, state).changes.some((c) => c.summary === 'list the allowed actions'),
  );
  await assert.rejects(applySettings(ctx, DECLARED, { yes: true }), /failed: 500$/);

  const reviewersWithoutLogin = {
    ...answers,
    [ENV]: {
      status: 200,
      data: { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }] },
    },
  };
  const odd = { ...ctx, api: async (_m: string, url: string) => reviewersWithoutLogin[url] };
  assert.deepStrictEqual((await readState(odd, DECLARED)).environment.reviewers, [undefined]);

  const bareEnvironment = { ...answers, [ENV]: { status: 200, data: {} } };
  const bare = { ...ctx, api: async (_m: string, url: string) => bareEnvironment[url] };
  assert.deepStrictEqual((await readState(bare, DECLARED)).environment.reviewers, []);

  const envError = {
    ...ctx,
    api: async (_m: string, url: string) =>
      url === ENV ? { status: 503, data: null } : answers[url],
  };
  await assert.rejects(readState(envError, DECLARED), /npm-publish answered 503: no details/);
});
