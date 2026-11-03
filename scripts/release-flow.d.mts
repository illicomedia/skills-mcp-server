// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

export interface ReleaseContext {
  pkgDir: string;
  interactive: boolean;
  fetchJson(url: string): Promise<unknown>;
  sh(command: string, args: string[], options?: { cwd?: string; interactive?: boolean }): string;
  confirm(question: string): Promise<boolean>;
  smokeServer(installDir: string, version: string): Promise<{ tools: number }>;
  sleep(ms: number): Promise<unknown>;
  log(message: string): void;
  ok(message: string): void;
  warn(message: string): void;
  join(...parts: string[]): string;
  resolve(path: string): string;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  makeTempDir(): string;
  removeDir(path: string): void;
  today(): string;
}

export interface Pkg {
  name: string;
  version: string;
  [key: string]: unknown;
}

export const RELEASE_BRANCH: string;
export const REGISTRY_ATTEMPTS: number;
export const REGISTRY_WAIT_MS: number;
export function registryState(
  ctx: ReleaseContext,
  packageName: string,
): { versions: string[]; distTags: Record<string, string> };
export function smoke(ctx: ReleaseContext, pkg: Pkg, options?: { tarball?: string | null }): Promise<void>;
export function prepare(
  ctx: ReleaseContext,
  pkg: Pkg,
  options?: { bump?: string | null; dryRun?: boolean; yes?: boolean },
): Promise<{ version: string; pushed: boolean }>;
export function waitForPublish(ctx: ReleaseContext, pkg: Pkg, version: string): Promise<void>;
export function verifyFromRegistry(ctx: ReleaseContext, pkg: Pkg, version: string): Promise<void>;
export function promote(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { version: string; dryRun?: boolean; yes?: boolean },
): Promise<void>;
export function deprecate(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { version: string; message: string; dryRun?: boolean; yes?: boolean },
): Promise<void>;
export function ship(
  ctx: ReleaseContext,
  pkg: Pkg,
  options: { bump?: string | null; dryRun?: boolean; yes?: boolean },
): Promise<void>;
