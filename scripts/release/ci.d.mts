// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

import type { Pkg, ReleaseContext } from './shared.mjs';
export function findTarball(ctx: ReleaseContext, pkg: Pkg, dir: string): string;
export function smoke(ctx: ReleaseContext, pkg: Pkg, options?: { tarballDir?: string | null }): Promise<void>;
export function expectRefusal(ctx: ReleaseContext, pkg: Pkg, options: { tarballDir: string }): Promise<void>;
export function stage(ctx: ReleaseContext, pkg: Pkg, options: { tarballDir: string }): void;
export function rehearse(ctx: ReleaseContext, pkg: Pkg, options: { tarballDir: string }): void;
export function githubRelease(ctx: ReleaseContext, pkg: Pkg, options: { tag: string; tarballDir: string }): void;
