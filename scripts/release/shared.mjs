// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** What every release step uses: git and npm through ctx, the npm state, confirmations. */

import { parseRegistryState } from './checks.mjs';
export const RELEASE_BRANCH = 'main';

export const REGISTRY_ATTEMPTS = 30;

export const REGISTRY_WAIT_MS = 10_000;

export function git(ctx, ...args) {
  return ctx.sh('git', args);
}

export function npm(ctx, ...args) {
  return ctx.sh('npm', args);
}

export function registryState(ctx, packageName) {
  try {
    return parseRegistryState(npm(ctx, 'view', packageName, 'versions', 'dist-tags', '--json'));
  } catch (error) {
    if (/E404/.test(error.message)) {
      return { versions: [], distTags: {} };
    }
    throw error;
  }
}

export function deprecationOf(ctx, packageName, version) {
  return npm(ctx, 'view', `${packageName}@${version}`, 'deprecated');
}

export function requireLogin(ctx) {
  try {
    ctx.ok(`Logged into npm as: ${npm(ctx, 'whoami')}`);
  } catch {
    throw new Error('Not logged in to npm. Run `npm login` first.');
  }
}

/** A step that changes shared state: refused unless someone said yes (or passed --yes). */
export async function approve(ctx, question, { yes }) {
  if (yes) {
    return true;
  }
  if (!ctx.interactive) {
    throw new Error(`${question} Needs confirmation: run in a terminal or pass --yes.`);
  }
  return ctx.confirm(question);
}
