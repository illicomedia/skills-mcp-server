// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

export interface SettingsContext {
  api(method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; data: any }>;
  interactive: boolean;
  confirm(question: string): Promise<boolean>;
  log(message: string): void;
  ok(message: string): void;
  warn(message: string): void;
}

export interface SettingsChange {
  summary: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export function parseSettingsArgs(argv: string[]): { action: string; yes: boolean; tokenFile: string | null };
export function readState(ctx: SettingsContext, declared: any): Promise<any>;
export function planSettings(declared: any, state: any): { changes: SettingsChange[]; drift: string[] };
export function checkSettings(ctx: SettingsContext, declared: any): Promise<boolean>;
export function applySettings(ctx: SettingsContext, declared: any, options?: { yes?: boolean }): Promise<boolean>;
