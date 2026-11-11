#!/usr/bin/env node

/**
 * Repository settings as code (decision D20). Compares the live GitHub settings with
 * .github/settings.json, and applies the differences on request.
 *
 * Usage: pnpm run github:check -- --help (the text lives in scripts/cli-help.mjs).
 *
 * The token is a fine-grained one, limited to this repository (Administration and Environments,
 * read and write), short-lived, in a file only its owner can read. It is never printed.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { SETTINGS_HELP, wantsHelp } from './cli-help.mjs';
import { applySettings, checkSettings, parseSettingsArgs } from './github-settings-flow.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COLOR = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
const say = (code, symbol) => (msg) =>
  console.error(`${COLOR ? `\x1b[${code}m[github]\x1b[0m` : '[github]'} ${symbol} ${msg}`);

function printTokenGuidance(reason, repo = 'illicomedia/skills-mcp-server') {
  const owner = repo.split('/')[0] || 'illicomedia';
  console.error(`\n${COLOR ? '\x1b[33m' : ''}[github] ! ${reason}${COLOR ? '\x1b[0m' : ''}`);
  console.error('To set up or renew your token quickly:\n');
  console.error(`  1. Generate a fine-grained token on GitHub (signed in as ${owner}):`);
  console.error('     https://github.com/settings/personal-access-tokens/new');
  console.error(`     - Resource owner : ${owner}`);
  console.error(`     - Repository     : Only select repositories → ${repo}`);
  console.error(
    '     - Permissions    : Administration (Read & write), Environments (Read & write)',
  );
  console.error('     - Expiration     : 1 day (or short-lived)\n');
  console.error('  2. Securely store it locally (chmod 600):');
  console.error('     mkdir -p ~/.config/gh-setup');
  console.error(
    "     (umask 077; read -rsp 'Token: ' T; echo; printf '%s' \"$T\" > ~/.config/gh-setup/token)\n",
  );
  console.error('  Or export in your shell:');
  console.error('     export GH_TOKEN="your_token_here"\n');
}

function readToken(file, repo) {
  if (existsSync(file)) {
    const { mode } = statSync(file);
    if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
      throw new Error(`${file} is readable by other users: chmod 600 it first.`);
    }
    const token = readFileSync(file, 'utf8').trim();
    if (!/^(github_pat_|ghp_)\w+$/.test(token)) {
      throw new Error(`${file} does not hold a GitHub token.`);
    }
    return token;
  }
  const envToken = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (envToken && /^(github_pat_|ghp_)\w+$/.test(envToken)) {
    return envToken;
  }
  printTokenGuidance(`No token found at ${file} or in GH_TOKEN / GITHUB_TOKEN.`, repo);
  throw new Error('Authentication token required.');
}

function apiWith(token) {
  return async (method, path, body) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'skills-mcp-server-settings',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^(y|yes|o|oui)$/i.test((await rl.question(`[github] ? ${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** The action of the command line; a wrong one ends here, pointing to --help. */
function readOptions(argv) {
  try {
    return parseSettingsArgs(argv);
  } catch (error) {
    say(31, '✖')(`${error.message} (run with --help for usage)`);
    return process.exit(1);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (wantsHelp(argv)) {
    process.stdout.write(SETTINGS_HELP);
    return;
  }
  const options = readOptions(argv);
  const declared = JSON.parse(readFileSync(join(ROOT, '.github', 'settings.json'), 'utf8'));
  const tokenFile = options.tokenFile ?? join(homedir(), '.config', 'gh-setup', 'token');
  const ctx = {
    api: apiWith(readToken(tokenFile, declared.repository)),
    interactive: Boolean(process.stdin.isTTY),
    confirm,
    color: COLOR,
    print: (line) => console.error(line),
    log: say(36, 'i'),
    ok: say(32, '✔'),
    warn: say(33, '!'),
  };
  const matches =
    options.action === 'check'
      ? await checkSettings(ctx, declared)
      : await applySettings(ctx, declared, options);
  process.exit(matches ? 0 : 1);
}

main().catch((error) => {
  say(31, '✖')(error.message);
  if (error.message.includes('401') || error.message.toLowerCase().includes('bad credentials')) {
    printTokenGuidance(
      'The GitHub token is expired, revoked, or invalid (HTTP 401 Bad credentials).',
    );
  }
  process.exit(1);
});
