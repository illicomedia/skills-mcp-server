// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

import type { Pkg, ReleaseContext } from './shared.mjs';
export function approveStaged(ctx: ReleaseContext, pkg: Pkg, options: { version: string; yes?: boolean }): Promise<void>;
export function verifyFromRegistry(ctx: ReleaseContext, pkg: Pkg, version: string): Promise<void>;
export function promote(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { version: string; dryRun?: boolean; yes?: boolean; withListing?: boolean },
): Promise<void>;
export function deprecate(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { version: string; message: string; dryRun?: boolean; yes?: boolean },
): Promise<void>;
export function undeprecate(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { version: string; dryRun?: boolean; yes?: boolean },
): Promise<void>;
export function ship(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { bump?: string | null; dryRun?: boolean; yes?: boolean; withListing?: boolean },
): Promise<void>;
