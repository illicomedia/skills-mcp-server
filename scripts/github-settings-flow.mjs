/**
 * Repository settings as code (.github/settings.json, decision D20): reads the live GitHub
 * settings, lists every difference from the declared ones, and applies them on request.
 *
 * All GitHub access goes through `ctx.api(method, path, body)` -> { status, data }, so tests drive
 * it with a fake API. Nothing is ever deleted: a ruleset or deployment policy that is not declared
 * is reported as drift, for a person to remove on purpose.
 */

import { approve } from './release-flow.mjs';

/** GitHub's built-in "Repository admin" role, as a ruleset bypass actor. */
const ADMIN_ROLE_ID = 5;
const ADMIN_BYPASS = {
  actor_id: ADMIN_ROLE_ID,
  actor_type: 'RepositoryRole',
  bypass_mode: 'always',
};

const sorted = (values) => [...values].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Turns the command line into one action; anything unknown throws. */
export function parseSettingsArgs(argv) {
  const options = { action: null, yes: false, tokenFile: null };
  const items = argv.filter((item) => item !== '--');
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === '--check' || item === '--apply') {
      if (options.action) {
        throw new Error('Choose one of --check or --apply');
      }
      options.action = item.slice(2);
    } else if (item === '--yes' || item === '-y') {
      options.yes = true;
    } else if (item === '--token-file') {
      index += 1;
      options.tokenFile = items[index] ?? '';
      if (!options.tokenFile) {
        throw new Error('--token-file expects a path');
      }
    } else {
      throw new Error(`Unknown option: ${item}`);
    }
  }
  if (!options.action) {
    throw new Error('Choose one of --check or --apply');
  }
  return options;
}

async function get(ctx, path) {
  const { status, data } = await ctx.api('GET', path);
  if (status !== 200) {
    throw new Error(`GET ${path} answered ${status}: ${data?.message ?? 'no details'}`);
  }
  return data;
}

function normalizeRuleset(ruleset) {
  return {
    id: ruleset.id,
    name: ruleset.name,
    shape: {
      target: ruleset.target,
      enforcement: ruleset.enforcement,
      include: sorted(ruleset.conditions?.ref_name?.include ?? []),
      exclude: sorted(ruleset.conditions?.ref_name?.exclude ?? []),
      rules: sorted(new Set((ruleset.rules ?? []).map((rule) => rule.type))),
      bypass: sorted(
        (ruleset.bypass_actors ?? []).map(
          (actor) => `${actor.actor_type}:${actor.actor_id}:${actor.bypass_mode}`,
        ),
      ),
    },
  };
}

function desiredRulesetShape(declared) {
  return {
    target: declared.target,
    enforcement: 'active',
    include: sorted(declared.include),
    exclude: [],
    rules: sorted(declared.rules),
    bypass: declared.bypassAdmins ? ['RepositoryRole:5:always'] : [],
  };
}

function rulesetBody(declared) {
  return {
    name: declared.name,
    target: declared.target,
    enforcement: 'active',
    conditions: { ref_name: { include: declared.include, exclude: [] } },
    rules: declared.rules.map((type) => ({ type })),
    bypass_actors: declared.bypassAdmins ? [ADMIN_BYPASS] : [],
  };
}

async function readEnvironment(ctx, repo, declared) {
  const path = `${repo}/environments/${encodeURIComponent(declared.name)}`;
  const { status, data } = await ctx.api('GET', path);
  if (status === 404) {
    return null;
  }
  if (status !== 200) {
    throw new Error(`GET ${path} answered ${status}: ${data?.message ?? 'no details'}`);
  }
  const reviewers = (data.protection_rules ?? []).find(
    (rule) => rule.type === 'required_reviewers',
  );
  const policies = await get(ctx, `${path}/deployment-branch-policies`);
  return {
    reviewers: sorted((reviewers?.reviewers ?? []).map((entry) => entry.reviewer?.login)),
    preventSelfReview: reviewers?.prevent_self_review ?? false,
    adminsBypass: data.can_admins_bypass,
    customPolicies: data.deployment_branch_policy?.custom_branch_policies === true,
    policies: sorted((policies.branch_policies ?? []).map((p) => `${p.type}:${p.name}`)),
  };
}

async function readSecurity(ctx, repo) {
  const alerts = await ctx.api('GET', `${repo}/vulnerability-alerts`);
  const fixes = await ctx.api('GET', `${repo}/automated-security-fixes`);
  const analysis = (await get(ctx, repo)).security_and_analysis ?? {};
  return {
    privateVulnerabilityReporting: (await get(ctx, `${repo}/private-vulnerability-reporting`))
      .enabled,
    vulnerabilityAlerts: alerts.status === 204,
    automatedSecurityFixes: fixes.status === 200 && fixes.data.enabled === true,
    secretScanning: analysis.secret_scanning?.status === 'enabled',
    pushProtection: analysis.secret_scanning_push_protection?.status === 'enabled',
  };
}

/** The live settings, in the same normalized shape the declaration is compared with. */
export async function readState(ctx, declared) {
  const repo = `/repos/${declared.repository}`;
  const rulesets = [];
  for (const { id } of await get(ctx, `${repo}/rulesets?includes_parents=false`)) {
    rulesets.push(normalizeRuleset(await get(ctx, `${repo}/rulesets/${id}`)));
  }
  const reviewerIds = {};
  for (const login of declared.environment.reviewers) {
    reviewerIds[login] = (await get(ctx, `/users/${encodeURIComponent(login)}`)).id;
  }
  const actions = await get(ctx, `${repo}/actions/permissions`);
  return {
    rulesets,
    reviewerIds,
    environment: await readEnvironment(ctx, repo, declared.environment),
    actions: {
      enabled: actions.enabled,
      allowed_actions: actions.allowed_actions,
      sha_pinning_required: actions.sha_pinning_required === true,
    },
    selectedActions:
      actions.allowed_actions === 'selected'
        ? await get(ctx, `${repo}/actions/permissions/selected-actions`)
        : null,
    workflow: await get(ctx, `${repo}/actions/permissions/workflow`),
    forkApproval: (await get(ctx, `${repo}/actions/permissions/fork-pr-contributor-approval`))
      .approval_policy,
    security: await readSecurity(ctx, repo),
  };
}

const RULE_WORDS = {
  creation: 'create',
  update: 'move',
  deletion: 'delete',
  non_fast_forward: 'force-push',
};
const yesNo = (value) => (value ? 'yes' : 'no');
const onOff = (value) => (value ? 'on' : 'off');

function refWords(ref) {
  if (ref === '~DEFAULT_BRANCH') {
    return 'the default branch';
  }
  return ref.replace(/^refs\/(tags|heads)\//, '');
}

function bypassWords(bypass) {
  if (bypass.length === 0) {
    return 'nobody';
  }
  return bypass.map((actor) => (actor === 'RepositoryRole:5:always' ? 'admin' : actor)).join(', ');
}

/** A ruleset in plain words: what it covers, what it blocks, who can bypass it. */
function rulesetWords(shape) {
  const refs = shape.include.map(refWords).join(', ') || '(none)';
  const blocks = shape.rules.map((rule) => RULE_WORDS[rule] ?? rule).join(', ') || 'nothing';
  return `${shape.target === 'tag' ? 'tags' : 'branch'} ${refs}; blocks ${blocks}; bypass ${bypassWords(shape.bypass)}`;
}

/** A row per field that differs: the setting's path, its actual value, the required one. */
function differences(prefix, fields) {
  return fields
    .filter(([, actual, required]) => actual !== required)
    .map(([label, actual, required]) => ({
      path: `${prefix} › ${label}`,
      actual: actual ?? '(unset)',
      required,
    }));
}

function planRulesets(declared, state, repo, changes, drift) {
  for (const ruleset of declared.rulesets) {
    const actual = state.rulesets.find((entry) => entry.name === ruleset.name);
    const wanted = desiredRulesetShape(ruleset);
    if (!actual) {
      changes.push({
        summary: `create ruleset "${ruleset.name}"`,
        rows: [
          {
            path: `rulesets › ${ruleset.name}`,
            actual: '(missing)',
            required: rulesetWords(wanted),
          },
        ],
        method: 'POST',
        path: `${repo}/rulesets`,
        body: rulesetBody(ruleset),
      });
    } else if (!same(actual.shape, wanted)) {
      changes.push({
        summary: `update ruleset "${ruleset.name}"`,
        rows: [
          {
            path: `rulesets › ${ruleset.name}`,
            actual: rulesetWords(actual.shape),
            required: rulesetWords(wanted),
          },
        ],
        method: 'PUT',
        path: `${repo}/rulesets/${actual.id}`,
        body: rulesetBody(ruleset),
      });
    }
  }
  const names = declared.rulesets.map((ruleset) => ruleset.name);
  for (const actual of state.rulesets.filter((entry) => !names.includes(entry.name))) {
    drift.push({
      path: `rulesets › ${actual.name}`,
      actual: rulesetWords(actual.shape),
      required: '(not declared: remove by hand if unwanted)',
    });
  }
}

function planEnvironment(declared, state, repo, changes, drift) {
  const env = declared.environment;
  const path = `${repo}/environments/${encodeURIComponent(env.name)}`;
  const prefix = `environments › ${env.name}`;
  const actual = state.environment;
  const rows = actual
    ? differences(prefix, [
        [
          'required reviewers',
          actual.reviewers.join(', ') || 'none',
          sorted(env.reviewers).join(', '),
        ],
        [
          'reviewers may approve their own runs',
          yesNo(!actual.preventSelfReview),
          yesNo(!env.preventSelfReview),
        ],
        ['administrators can bypass', yesNo(actual.adminsBypass), yesNo(env.adminsBypass)],
        ['only listed tags may deploy', yesNo(actual.customPolicies), 'yes'],
      ])
    : [{ path: prefix, actual: '(missing)', required: `reviewers ${env.reviewers.join(', ')}` }];
  if (rows.length > 0) {
    changes.push({
      summary: `configure environment "${env.name}"`,
      rows,
      method: 'PUT',
      path,
      body: {
        wait_timer: 0,
        prevent_self_review: env.preventSelfReview,
        reviewers: env.reviewers.map((login) => ({ type: 'User', id: state.reviewerIds[login] })),
        can_admins_bypass: env.adminsBypass,
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      },
    });
  }
  const policies = actual?.policies ?? [];
  for (const name of env.tagPolicies.filter((tag) => !policies.includes(`tag:${tag}`))) {
    changes.push({
      summary: `allow tags ${name} to deploy to "${env.name}"`,
      rows: [{ path: `${prefix} › tags allowed to deploy`, actual: '(missing)', required: name }],
      method: 'POST',
      path: `${path}/deployment-branch-policies`,
      body: { name, type: 'tag' },
    });
  }
  const declaredPolicies = env.tagPolicies.map((tag) => `tag:${tag}`);
  for (const policy of policies.filter((entry) => !declaredPolicies.includes(entry))) {
    const [type, name] = policy.split(/:(.*)/);
    drift.push({
      path: `${prefix} › ${type === 'tag' ? 'tags' : 'branches'} allowed to deploy`,
      actual: name,
      required: '(not declared: only the declared tags may publish)',
    });
  }
}

function allowedWords(selected) {
  if (!selected) {
    return 'none listed';
  }
  const parts = [];
  if (selected.github_owned_allowed) {
    parts.push('GitHub-owned');
  }
  if (selected.verified_allowed) {
    parts.push('verified creators');
  }
  parts.push(
    ...sorted(selected.patterns_allowed ?? []).map((pattern) => pattern.replace(/@\*$/, '')),
  );
  return parts.join(', ') || 'none';
}

const FORK_WORDS = {
  first_time_contributors_new_to_github: 'first-time contributors new to GitHub',
  first_time_contributors: 'first-time contributors',
  all_external_contributors: 'all outside contributors',
};

function planActions(declared, state, repo, changes) {
  const actions = declared.actions;
  const base = `${repo}/actions/permissions`;
  const selectedBody = {
    github_owned_allowed: actions.githubOwnedAllowed,
    verified_allowed: actions.verifiedAllowed,
    patterns_allowed: sorted(actions.patternsAllowed),
  };
  const groups = [
    {
      summary: 'restrict and pin actions',
      path: base,
      body: {
        enabled: true,
        allowed_actions: 'selected',
        sha_pinning_required: actions.shaPinningRequired,
      },
      rows: differences('actions', [
        ['Actions enabled', yesNo(state.actions.enabled), 'yes'],
        [
          'allowed actions',
          state.actions.allowed_actions === 'selected'
            ? 'a selected list'
            : state.actions.allowed_actions,
          'a selected list',
        ],
        [
          'full commit SHA required',
          yesNo(state.actions.sha_pinning_required),
          yesNo(actions.shaPinningRequired),
        ],
      ]),
    },
    {
      summary: 'list the allowed actions',
      path: `${base}/selected-actions`,
      body: selectedBody,
      rows: differences('actions', [
        ['selected list', allowedWords(state.selectedActions), allowedWords(selectedBody)],
      ]),
    },
    {
      summary: 'restrict the workflow token',
      path: `${base}/workflow`,
      body: {
        default_workflow_permissions: actions.defaultWorkflowPermissions,
        can_approve_pull_request_reviews: actions.canApprovePullRequestReviews,
      },
      rows: differences('actions', [
        [
          'default token',
          state.workflow.default_workflow_permissions,
          actions.defaultWorkflowPermissions,
        ],
        [
          'Actions can approve pull requests',
          yesNo(state.workflow.can_approve_pull_request_reviews),
          yesNo(actions.canApprovePullRequestReviews),
        ],
      ]),
    },
    {
      summary: 'require approval for fork pull requests',
      path: `${base}/fork-pr-contributor-approval`,
      body: { approval_policy: actions.forkPrApproval },
      rows: differences('actions', [
        [
          'fork pull requests need approval for',
          FORK_WORDS[state.forkApproval] ?? `${state.forkApproval}`,
          FORK_WORDS[actions.forkPrApproval] ?? actions.forkPrApproval,
        ],
      ]),
    },
  ];
  for (const { summary, path, body, rows } of groups) {
    if (rows.length > 0) {
      changes.push({ summary, rows, method: 'PUT', path, body });
    }
  }
}

function planSecurity(declared, state, repo, changes) {
  const security = declared.security;
  const toggles = [
    [
      'privateVulnerabilityReporting',
      'private vulnerability reporting',
      'private-vulnerability-reporting',
    ],
    ['vulnerabilityAlerts', 'Dependabot alerts', 'vulnerability-alerts'],
    ['automatedSecurityFixes', 'Dependabot security updates', 'automated-security-fixes'],
  ];
  for (const [key, label, endpoint] of toggles) {
    if (state.security[key] !== security[key]) {
      changes.push({
        summary: `turn ${onOff(security[key])} ${label}`,
        rows: [
          {
            path: `security › ${label}`,
            actual: onOff(state.security[key]),
            required: onOff(security[key]),
          },
        ],
        method: security[key] ? 'PUT' : 'DELETE',
        path: `${repo}/${endpoint}`,
      });
    }
  }
  const rows = differences('security', [
    ['secret scanning', onOff(state.security.secretScanning), onOff(security.secretScanning)],
    ['push protection', onOff(state.security.pushProtection), onOff(security.pushProtection)],
  ]);
  if (rows.length > 0) {
    const status = (on) => ({ status: on ? 'enabled' : 'disabled' });
    changes.push({
      summary: 'secret scanning and push protection',
      rows,
      method: 'PATCH',
      path: repo,
      body: {
        security_and_analysis: {
          secret_scanning: status(security.secretScanning),
          secret_scanning_push_protection: status(security.pushProtection),
        },
      },
    });
  }
}

/** The changes that make the live settings match the declaration, in a safe order, and the drift. */
export function planSettings(declared, state) {
  const repo = `/repos/${declared.repository}`;
  const changes = [];
  const drift = [];
  planRulesets(declared, state, repo, changes, drift);
  planEnvironment(declared, state, repo, changes, drift);
  planActions(declared, state, repo, changes);
  planSecurity(declared, state, repo, changes);
  return { changes, drift };
}

const COLORS = { header: '1', actual: '31', required: '32', review: '33' };

/**
 * The plan as a table: PATH, ACTUAL, REQUIRED. With `color`, actual values are red, required
 * ones green, and rows that need a person (undeclared settings) yellow.
 */
export function formatPlan({ changes, drift }, { color = false } = {}) {
  const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const rows = [
    ...changes.flatMap((change) => change.rows.map((row) => ({ ...row, review: false }))),
    ...drift.map((row) => ({ ...row, review: true })),
  ];
  const header = { path: 'PATH', actual: 'ACTUAL', required: 'REQUIRED' };
  const width = (key) => Math.max(...[header, ...rows].map((row) => row[key].length));
  const [pathWidth, actualWidth] = [width('path'), width('actual')];
  const line = (row, codes) =>
    [
      paint(codes[0], row.path.padEnd(pathWidth)),
      paint(codes[1], row.actual.padEnd(actualWidth)),
      paint(codes[2], row.required),
    ].join('  ');
  return [
    line(header, [COLORS.header, COLORS.header, COLORS.header]),
    ...rows.map((row) =>
      row.review
        ? line(row, [COLORS.review, COLORS.review, COLORS.review])
        : line(row, ['0', COLORS.actual, COLORS.required]),
    ),
  ];
}

function report(ctx, plan) {
  for (const row of formatPlan(plan, { color: ctx.color })) {
    ctx.print(row);
  }
}

function countWords({ changes, drift }) {
  const parts = [`${changes.length} change${changes.length === 1 ? '' : 's'}`];
  if (drift.length > 0) {
    parts.push(`${drift.length} item${drift.length === 1 ? '' : 's'} to review by hand`);
  }
  return parts.join(', ');
}

/** Read-only: true when the live settings match the declaration and nothing undeclared exists. */
export async function checkSettings(ctx, declared) {
  const plan = planSettings(declared, await readState(ctx, declared));
  if (plan.changes.length === 0 && plan.drift.length === 0) {
    ctx.ok(`GitHub settings of ${declared.repository} match .github/settings.json.`);
    return true;
  }
  ctx.warn(`${declared.repository} differs from .github/settings.json: ${countWords(plan)}.`);
  report(ctx, plan);
  if (plan.changes.length > 0) {
    ctx.log('Nothing was changed. To apply: pnpm run github:apply');
  }
  return false;
}

/** Applies the differences after a confirmation, then reads everything back to verify. */
export async function applySettings(ctx, declared, { yes = false } = {}) {
  const plan = planSettings(declared, await readState(ctx, declared));
  if (plan.changes.length === 0) {
    ctx.ok('Nothing to change.');
    report(ctx, plan);
    return plan.drift.length === 0;
  }
  ctx.log(`${declared.repository}: ${countWords(plan)}.`);
  report(ctx, plan);
  if (!(await approve(ctx, `Apply ${plan.changes.length} change(s) to GitHub?`, { yes }))) {
    ctx.log('Nothing applied.');
    return false;
  }
  for (const change of plan.changes) {
    const { status, data } = await ctx.api(change.method, change.path, change.body);
    if (status >= 300) {
      throw new Error(`${change.summary} failed: ${status} ${data?.message ?? ''}`.trim());
    }
    ctx.ok(change.summary);
  }
  return checkSettings(ctx, declared);
}
