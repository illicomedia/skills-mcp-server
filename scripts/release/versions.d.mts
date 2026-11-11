// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
export function bumpVersion(version: string, bump: string, preid?: string | null): string;
export function tagForVersion(version: string): string;
export function checkTagMatchesVersion(tag: string, version: string): string;
export function nextDistTagAfterPromotion(distTags: Record<string, string>, promotedVersion: string): boolean;
export function versionAtLeast(version: string, minimum: string): boolean;
export function tarballFileName(name: string, version: string): string;
export function ciTagOutputs(tag: string, pkg: { name: string; version: string }): string;
