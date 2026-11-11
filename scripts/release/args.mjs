// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** The command line of `pnpm release`: one action, its value and the options it takes. */

import { parseArgs } from 'node:util';
import { BUMPS, EXACT_VERSION, PREID, SEMVER } from './versions.mjs';

/** What each value option expects, for the error when it is missing or wrong. */
const VALUE_OPTIONS = {
  bump: `one of ${BUMPS.join(', ')}`,
  approve: 'a version such as 3.0.0 or 3.0.0-rc.1',
  preid: 'lowercase letters, such as rc',
  promote: 'an exact version such as 1.5.0',
  deprecate: 'an exact version such as 1.5.0',
  undeprecate: 'an exact version such as 1.5.0',
  message: '"<cause>. Upgrade to <package>@<range> (<prerequisites>)."',
  'tarball-dir': 'a folder holding one .tgz',
  'check-tag': 'a tag such as v1.5.0',
  'release-notes': 'a version such as 1.5.0 or 2.0.0-rc.1',
  'github-release': 'a tag such as v1.5.0',
};

const SWITCHES = ['dry-run', 'with-listing', 'publish-listing', 'smoke-only', 'expect-refusal'];

const OPTIONS = {
  ...Object.fromEntries(Object.keys(VALUE_OPTIONS).map((name) => [name, { type: 'string' }])),
  ...Object.fromEntries(
    [...SWITCHES, 'ship', 'stage', 'rehearse'].map((name) => [name, { type: 'boolean' }]),
  ),
  yes: { type: 'boolean', short: 'y' },
};

/**
 * The actions, one per command line: the name they run as, what their own value must be
 * (exact version, any version, a tag), and whether they need a tarball folder.
 */
const ACTIONS = {
  ship: { as: 'ship' },
  approve: { as: 'approve', value: SEMVER },
  promote: { as: 'promote', value: EXACT_VERSION },
  deprecate: { as: 'deprecate', value: EXACT_VERSION },
  undeprecate: { as: 'undeprecate', value: EXACT_VERSION },
  'publish-listing': { as: 'publish-listing' },
  'smoke-only': { as: 'smoke', tarball: 'optional' },
  'expect-refusal': { as: 'expect-refusal', tarball: 'required' },
  stage: { as: 'stage', tarball: 'required' },
  rehearse: { as: 'rehearse', tarball: 'required' },
  'github-release': { as: 'github-release', value: /./, key: 'tag', tarball: 'required' },
  'check-tag': { as: 'check-tag', value: /./, key: 'tag' },
  'release-notes': { as: 'release-notes', value: SEMVER },
};

const TARBALL_ACTIONS = Object.keys(ACTIONS).filter((name) => ACTIONS[name].tarball);

/** Options that only some actions take: who takes them, as said in the error. */
const ONLY = {
  bump: [['prepare', 'ship'], 'a prepare or --ship'],
  'with-listing': [['promote', 'ship'], '--promote or --ship'],
  message: [['deprecate'], '--deprecate'],
  'tarball-dir': [TARBALL_ACTIONS, TARBALL_ACTIONS.map((name) => `--${name}`).join(', ')],
};

const expects = (name) => new Error(`--${name} expects ${VALUE_OPTIONS[name]}`);

/** node:util parseArgs, with this tool's error messages. */
function readOptions(argv) {
  let parsed;
  try {
    const args = argv.filter((item) => item !== '--');
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    // parseArgs quotes what it rejects: '--name', '-y, --yes' or '--name <value>'.
    const quoted = error.message.split("'")[1].split(/[ ,]+/);
    const flag = quoted.find((part) => part.startsWith('--')) ?? quoted[0];
    if (error.code !== 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      throw new Error(`Unknown option: ${flag}`);
    }
    const name = flag.slice(2);
    throw name in VALUE_OPTIONS ? expects(name) : new Error(`${flag} takes no value`);
  }
  if (parsed.positionals.length > 0) {
    throw new Error(`Unknown option: ${parsed.positionals[0]}`);
  }
  return parsed.values;
}

function checkCombinations(values, action) {
  for (const [name, [actions, where]] of Object.entries(ONLY)) {
    if (values[name] !== undefined && !actions.includes(action)) {
      throw new Error(`--${name} only applies to ${where}`);
    }
  }
  if (values.preid !== undefined) {
    if (!['patch', 'minor', 'major'].includes(values.bump)) {
      throw new Error('--preid only applies with --bump patch, minor or major');
    }
    if (!PREID.test(values.preid)) {
      throw expects('preid');
    }
  }
  if (values.bump !== undefined && !BUMPS.includes(values.bump)) {
    throw expects('bump');
  }
}

/** Turns the command line into one release action; anything unknown or ambiguous throws. */
export function parseReleaseArgs(argv) {
  const values = readOptions(argv);
  const given = Object.keys(ACTIONS).filter((name) => values[name] !== undefined);
  if (given.length > 1) {
    throw new Error(`Choose one action, got: ${given.map((name) => `--${name}`).join(', ')}`);
  }
  // No action: a release with --bump, else the read-only status (cutting is always explicit).
  const name = given[0] ?? (values.bump === undefined ? 'status' : 'prepare');
  checkCombinations(values, name);
  const spec = ACTIONS[name] ?? { as: name };
  const result = { action: spec.as, dryRun: Boolean(values['dry-run']), yes: Boolean(values.yes) };
  if (spec.value) {
    if (!spec.value.test(values[name])) {
      throw expects(name);
    }
    result[spec.key ?? 'version'] = values[name];
  }
  if (name === 'prepare' || name === 'ship') {
    result.bump = values.bump ?? null;
    Object.assign(result, values.preid === undefined ? {} : { preid: values.preid });
  }
  if (name === 'deprecate') {
    if (!values.message) {
      throw expects('message');
    }
    result.message = values.message;
  }
  if (spec.tarball === 'required' && !values['tarball-dir']) {
    throw expects('tarball-dir');
  }
  if (spec.tarball) {
    result.tarballDir = values['tarball-dir'] ?? null;
  }
  return values['with-listing'] ? { ...result, withListing: true } : result;
}
