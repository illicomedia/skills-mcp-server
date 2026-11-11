// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
export function parseRegistryState(raw: string): { versions: string[]; distTags: Record<string, string> };
export function githubRepoSlug(repository: unknown): string | null;
export function ciProblem(checkRuns: unknown): string | null;
export const MIN_NPM_FOR_STAGING: string;
export function deprecationProblems(message: string, packageName: string): string[];
export function parseStageList(text: string): Record<string, string>[];
