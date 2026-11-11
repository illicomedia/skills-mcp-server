import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after } from 'node:test';
import { runComplianceAudit } from '../../dist/audit/index.js';

/**
 * Real git, isolated from the machine's configuration (no global or system config, no global
 * excludes file), to check the audit's .gitignore reading against git itself.
 */
export const gitAvailable = spawnSync('git', ['--version']).status === 0;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-git-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const emptyConfig = path.join(root, 'empty-gitconfig');
fs.writeFileSync(emptyConfig, '');

function git(cwd: string, args: string[], ignoreCase: boolean): number | null {
  return spawnSync(
    'git',
    ['-c', `core.ignorecase=${ignoreCase}`, '-c', `core.excludesFile=${emptyConfig}`, ...args],
    {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' },
    },
  ).status;
}

let counter = 0;
/** A new, empty git repository. */
export function repo(): string {
  counter += 1;
  const dir = path.join(root, `r${counter}`);
  fs.mkdirSync(dir);
  assert.equal(git(dir, ['init', '-q', '.'], false), 0);
  return dir;
}

/** Whether git ignores `rel` (relative to `dir`). */
export function gitIgnores(dir: string, rel: string, ignoreCase: boolean): boolean {
  return git(dir, ['check-ignore', '-q', rel], ignoreCase) === 0;
}

/** Whether the audit check called `name` passed for this project. */
export function auditCheckPassed(project: string, name: string): boolean {
  const check = runComplianceAudit(project, { confirm: true }).results.find((r) => r.name === name);
  assert.ok(check, `no check named ${name}`);
  return check.passed;
}

/** Writes files (relative path → content) under `dir`, creating folders as needed. */
export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

/** A differential case: the .gitignore content, and whether the audit must agree with git exactly. */
export type GitCase = readonly [content: string, exact: boolean];

/**
 * Runs every case of a corpus through `probe` (git's answer and the audit's) and returns the
 * disagreements: the audit reporting "ignored" while git would commit the file (never allowed),
 * or, for exact cases with core.ignorecase off, any difference. An empty list: the audit agrees.
 */
export function disagreementsWithGit(
  corpus: readonly GitCase[],
  ignoreCase: boolean,
  probe: (content: string, ignoreCase: boolean) => { gitSays: boolean; ours: boolean },
): string[] {
  const problems: string[] = [];
  for (const [content, exact] of corpus) {
    const { gitSays, ours } = probe(content, ignoreCase);
    if (ours && !gitSays) {
      problems.push(`${JSON.stringify(content)}: the audit says ignored, git would commit it`);
    } else if (exact && !ignoreCase && ours !== gitSays) {
      problems.push(`${JSON.stringify(content)}: the audit says ${ours}, git says ${gitSays}`);
    }
  }
  return problems;
}
