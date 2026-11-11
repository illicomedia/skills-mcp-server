// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

import type { Pkg, ReleaseContext } from './shared.mjs';
export function listingProblems(listing: Record<string, unknown>, pkg: Record<string, unknown>, version: string): string[];
export function listingAtVersion(listing: Record<string, unknown>, version: string): Record<string, unknown>;
export function publishListing(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { version: string; dryRun?: boolean; yes?: boolean },
): Promise<void>;
