// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
export function changelogHasVersion(changelog: string, version: string): boolean;
export function unreleasedSummary(changelog: string): { headings: string[]; entries: number; bump: string | null };
export function extractChangelogSection(changelog: string, version: string): string;
export function stampChangelog(changelog: string, version: string, date: string): string;
export function stampReleaseDate(source: string, date: string): string;
