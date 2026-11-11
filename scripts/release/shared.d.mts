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
export function approve(ctx: ReleaseContext, question: string, options: { yes: boolean }): Promise<boolean>;
