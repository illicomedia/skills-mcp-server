// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

export type ReleaseArgs = Record<string, unknown>;

export const SMOKE_PROTOCOL_VERSION: string;
export function parseReleaseArgs(argv: string[]): ReleaseArgs;
export function bumpVersion(version: string, bump: string, preid?: string | null): string;
export function tagForVersion(version: string): string;
export function checkTagMatchesVersion(tag: string, version: string): string;
export function changelogHasVersion(changelog: string, version: string): boolean;
export function extractChangelogSection(changelog: string, version: string): string;
export function stampChangelog(changelog: string, version: string, date: string): string;
export function nextDistTagAfterPromotion(distTags: Record<string, string>, promotedVersion: string): boolean;
export function parseRegistryState(raw: string): { versions: string[]; distTags: Record<string, string> };
export function smokeTestServer(
  command: string,
  expectedVersion: string,
  timeoutMs?: number,
  args?: string[],
): Promise<{ tools: number }>;
export function githubRepoSlug(repository: unknown): string | null;
export function ciProblem(checkRuns: unknown): string | null;
export const MIN_NPM_FOR_STAGING: string;
export function versionAtLeast(version: string, minimum: string): boolean;
export function tarballFileName(name: string, version: string): string;
export function ciTagOutputs(tag: string, pkg: { name: string; version: string }): string;
export function expectServerRefusal(command: string, timeoutMs?: number, args?: string[]): Promise<string>;
