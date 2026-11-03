#!/usr/bin/env node

/**
 * Repository settings as code (decision D20). Compares the live GitHub settings with
 * .github/settings.json, and applies the differences on request.
 *
 *  pnpm run github:check            read-only: lists every difference; exits 1 if any
 *  pnpm run github:apply [-- --yes] shows the changes, asks, applies them, reads them back
 *  ... --token-file <path>          default: ~/.config/gh-setup/token
 *
 * The token is a fine-grained one, limited to this repository (Administration and Environments,
 * read and write), short-lived, in a file only its owner can read. It is never printed.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { applySettings, checkSettings, parseSettingsArgs } from './github-settings-flow.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COLOR = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
const say = (code, symbol) => (msg) =>
  console.error(`${COLOR ? `\x1b[${code}m[github]\x1b[0m` : '[github]'} ${symbol} ${msg}`);

function readToken(file) {
  if (!existsSync(file)) {
    throw new Error(
      `No token at ${file}: create it as docs/operations/release-runbook.md ("Repository settings") shows.`,
    );
  }
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

async function main() {
  const options = parseSettingsArgs(process.argv.slice(2));
  const declared = JSON.parse(readFileSync(join(ROOT, '.github', 'settings.json'), 'utf8'));
  const tokenFile = options.tokenFile ?? join(homedir(), '.config', 'gh-setup', 'token');
  const ctx = {
    api: apiWith(readToken(tokenFile)),
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
  process.exit(1);
});
