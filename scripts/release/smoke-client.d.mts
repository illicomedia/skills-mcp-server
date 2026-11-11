// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
export const SMOKE_PROTOCOL_VERSION: string;
export function smokeTestServer(
  command: string,
  expectedVersion: string,
  timeoutMs?: number,
  args?: string[],
): Promise<{ tools: number }>;
export function expectServerRefusal(command: string, timeoutMs?: number, args?: string[]): Promise<string>;
