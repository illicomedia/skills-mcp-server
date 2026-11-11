// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

import type { Pkg, ReleaseContext } from './shared.mjs';
export function prepare(
  ctx: ReleaseContext,
  pkg: Pkg,
  options?: { bump?: string | null; preid?: string | null; dryRun?: boolean; yes?: boolean },
): Promise<{ version: string; pushed: boolean }>;
