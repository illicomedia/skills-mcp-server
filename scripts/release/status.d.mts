// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

import type { Pkg, ReleaseContext } from './shared.mjs';
export interface ReleaseStatus {
  version: string;
  latest: string | null;
  next: string | null;
  tagged: boolean;
  commitsSinceTag: number | null;
  unpushed: number;
  dirty: number;
  bump: string | null;
}
export function status(ctx: ReleaseContext, pkg: Pkg): Promise<ReleaseStatus>;
