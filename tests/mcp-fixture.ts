import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { FredoQaMcpServer } from '../dist/server/server.js';

/** Calls an MCP tool through the server's JSON-RPC handler and returns its text answer. */
export function callToolText(
  server: FredoQaMcpServer,
  name: string,
  args: Record<string, unknown> = {},
): string {
  const res = server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return (res.result as { content: { text: string }[] }).content[0].text;
}

/** Runs `run` in a fresh temporary folder, removed afterwards even when the test fails. */
export function withTempDir(prefix: string, run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Installs fake skills (`.agents/skills/<id>/SKILL.md`) into a project folder. */
function addSkills(project: string, skills: Record<string, string>): void {
  for (const [id, content] of Object.entries(skills)) {
    const dir = path.join(project, '.agents', 'skills', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  }
}

/** A Go project (go.mod) with fake installed skills, the setup the prune tests share. */
export function goProjectWithSkills(project: string, skills: Record<string, string>): void {
  fs.writeFileSync(path.join(project, 'go.mod'), 'module example.com/test\ngo 1.22\n');
  addSkills(project, skills);
}

/**
 * Runs `startStdio` on in-memory pipes: `feed` pushes into the server's stdin (end it with
 * `input.push(null)`), and the text the server wrote to stdout is returned.
 */
export async function runStdio(
  server: FredoQaMcpServer,
  feed: (input: Readable) => void,
): Promise<string> {
  const input = new Readable({ read() {} });
  let text = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  const origStdin = process.stdin;
  const origStdout = process.stdout;
  Object.defineProperty(process, 'stdin', { value: input, configurable: true });
  Object.defineProperty(process, 'stdout', { value: output, configurable: true });
  try {
    server.startStdio();
    feed(input);
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: origStdout, configurable: true });
  }
  return text;
}
