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

function planRulesets(declared, state, repo, changes, drift) {
  for (const ruleset of declared.rulesets) {
    const actual = state.rulesets.find((entry) => entry.name === ruleset.name);
    if (!actual) {
      changes.push({
        summary: `create ruleset "${ruleset.name}"`,
        method: 'POST',
        path: `${repo}/rulesets`,
        body: rulesetBody(ruleset),
      });
    } else if (!same(actual.shape, desiredRulesetShape(ruleset))) {
      changes.push({
        summary: `update ruleset "${ruleset.name}"`,
        method: 'PUT',
        path: `${repo}/rulesets/${actual.id}`,
        body: rulesetBody(ruleset),
      });
    }
  }
  const names = declared.rulesets.map((ruleset) => ruleset.name);
  for (const actual of state.rulesets.filter((entry) => !names.includes(entry.name))) {
    drift.push(
      `ruleset "${actual.name}" exists but is not declared (remove it by hand if unwanted)`,
    );
  }
}

function planEnvironment(declared, state, repo, changes, drift) {
  const env = declared.environment;
  const path = `${repo}/environments/${encodeURIComponent(env.name)}`;
  const want = {
    reviewers: sorted(env.reviewers),
    preventSelfReview: env.preventSelfReview,
    adminsBypass: env.adminsBypass,
    customPolicies: true,
  };
  const actual = state.environment;
  const have = actual && {
    reviewers: actual.reviewers,
    preventSelfReview: actual.preventSelfReview,
    adminsBypass: actual.adminsBypass,
    customPolicies: actual.customPolicies,
  };
  if (!same(have, want)) {
    changes.push({
      summary: `configure environment "${env.name}" (reviewers, admin bypass, custom policies)`,
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
      summary: `allow tag ${name} to deploy to "${env.name}"`,
      method: 'POST',
      path: `${path}/deployment-branch-policies`,
      body: { name, type: 'tag' },
    });
  }
  const declaredPolicies = env.tagPolicies.map((tag) => `tag:${tag}`);
  for (const policy of policies.filter((entry) => !declaredPolicies.includes(entry))) {
    drift.push(`deployment policy ${policy} on "${env.name}" is not declared (remove it by hand)`);
  }
}

function planActions(declared, state, repo, changes) {
  const actions = declared.actions;
  const base = `${repo}/actions/permissions`;
  const want = [
    {
      summary: 'allow only selected actions, pinned to a full commit SHA',
      path: base,
      body: {
        enabled: true,
        allowed_actions: 'selected',
        sha_pinning_required: actions.shaPinningRequired,
      },
      have: state.actions,
    },
    {
      summary: 'list the allowed actions',
      path: `${base}/selected-actions`,
      body: {
        github_owned_allowed: actions.githubOwnedAllowed,
        verified_allowed: actions.verifiedAllowed,
        patterns_allowed: sorted(actions.patternsAllowed),
      },
      have: state.selectedActions && {
        github_owned_allowed: state.selectedActions.github_owned_allowed,
        verified_allowed: state.selectedActions.verified_allowed,
        patterns_allowed: sorted(state.selectedActions.patterns_allowed ?? []),
      },
    },
    {
      summary: 'read-only default token; Actions cannot approve pull requests',
      path: `${base}/workflow`,
      body: {
        default_workflow_permissions: actions.defaultWorkflowPermissions,
        can_approve_pull_request_reviews: actions.canApprovePullRequestReviews,
      },
      have: {
        default_workflow_permissions: state.workflow.default_workflow_permissions,
        can_approve_pull_request_reviews: state.workflow.can_approve_pull_request_reviews,
      },
    },
    {
      summary: `fork pull request workflows need approval (${actions.forkPrApproval})`,
      path: `${base}/fork-pr-contributor-approval`,
      body: { approval_policy: actions.forkPrApproval },
      have: { approval_policy: state.forkApproval },
    },
  ];
  for (const { summary, path, body, have } of want) {
    if (!same(have, body)) {
      changes.push({ summary, method: 'PUT', path, body });
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
        summary: `${security[key] ? 'enable' : 'disable'} ${label}`,
        method: security[key] ? 'PUT' : 'DELETE',
        path: `${repo}/${endpoint}`,
      });
    }
  }
  if (
    state.security.secretScanning !== security.secretScanning ||
    state.security.pushProtection !== security.pushProtection
  ) {
    const status = (on) => ({ status: on ? 'enabled' : 'disabled' });
    changes.push({
      summary: 'secret scanning and push protection',
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

function report(ctx, { changes, drift }) {
  for (const change of changes) {
    ctx.log(`  - ${change.summary}  (${change.method} ${change.path})`);
  }
  for (const line of drift) {
    ctx.warn(`  ! ${line}`);
  }
}

/** Read-only: true when the live settings match the declaration and nothing undeclared exists. */
export async function checkSettings(ctx, declared) {
  const plan = planSettings(declared, await readState(ctx, declared));
  if (plan.changes.length === 0 && plan.drift.length === 0) {
    ctx.ok(`GitHub settings of ${declared.repository} match .github/settings.json.`);
    return true;
  }
  ctx.warn(`GitHub settings of ${declared.repository} differ from .github/settings.json:`);
  report(ctx, plan);
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
  ctx.log(`Changes to apply to ${declared.repository}:`);
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
