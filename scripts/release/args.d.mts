// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
export type ReleaseArgs = Record<string, unknown>;
export function parseReleaseArgs(argv: string[]): ReleaseArgs;
