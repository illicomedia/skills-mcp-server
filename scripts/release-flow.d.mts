// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

export interface ReleaseContext {
  pkgDir: string;
  interactive: boolean;
  fetchJson(url: string): Promise<any>;
  downloadSha1(url: string): Promise<string | null>;
  sh(
    command: string,
    args: string[],
    options?: { cwd?: string; interactive?: boolean; withStderr?: boolean },
  ): string;
  confirm(question: string): Promise<boolean>;
  smokeServer(installDir: string, version: string): Promise<{ tools: number }>;
  refusingServer(installDir: string): Promise<string>;
  sleep(ms: number): Promise<unknown>;
  log(message: string): void;
  ok(message: string): void;
  warn(message: string): void;
  join(...parts: string[]): string;
  resolve(path: string): string;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  listDir(path: string): string[];
  copy(from: string, to: string): void;
  summary(markdown: string): void;
  env: Record<string, string | undefined>;
  makeTempDir(): string;
  removeDir(path: string): void;
  today(): string;
}

export interface Pkg {
  name: string;
  version: string;
  files?: string[];
  [key: string]: unknown;
}

export const REGISTRY_ATTEMPTS: number;
export function registryState(
  ctx: ReleaseContext,
  packageName: string,
): { versions: string[]; distTags: Record<string, string> };
export function findTarball(ctx: ReleaseContext, pkg: Pkg, dir: string): string;
export function smoke(ctx: ReleaseContext, pkg: Pkg, options?: { tarballDir?: string | null }): Promise<void>;
export function expectRefusal(ctx: ReleaseContext, pkg: Pkg, options: { tarballDir: string }): Promise<void>;
export function stage(ctx: ReleaseContext, pkg: Pkg, options: { tarballDir: string }): void;
export function rehearse(ctx: ReleaseContext, pkg: Pkg, options: { tarballDir: string }): void;
export function githubRelease(ctx: ReleaseContext, pkg: Pkg, options: { tag: string; tarballDir: string }): void;
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
export function prepare(
  ctx: ReleaseContext,
  pkg: Pkg,
  options?: { bump?: string | null; preid?: string | null; dryRun?: boolean; yes?: boolean },
): Promise<{ version: string; pushed: boolean }>;
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
export function ship(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { bump?: string | null; dryRun?: boolean; yes?: boolean; withListing?: boolean },
): Promise<void>;
export function publishListing(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { version: string; dryRun?: boolean; yes?: boolean },
): Promise<void>;
export function approve(ctx: ReleaseContext, question: string, options: { yes: boolean }): Promise<boolean>;
