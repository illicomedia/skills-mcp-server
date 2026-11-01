// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

export type ReleaseArgs = Record<string, unknown>;

export function parseReleaseArgs(argv: string[]): ReleaseArgs;
export function changelogHasVersion(changelog: string, version: string): boolean;
export function bumpVersion(version: string, bump: string): string;
export function nextDistTagAfterPromotion(distTags: Record<string, string>, promotedVersion: string): boolean;
export function smokeTestServer(binPath: string, expectedVersion: string, timeoutMs?: number): Promise<{ tools: number }>;
