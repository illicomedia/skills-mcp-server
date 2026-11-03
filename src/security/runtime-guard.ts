/**
 * The server reads whole codebases on behalf of an AI agent, so it only runs on Node.js release
 * lines that still receive security fixes. npm treats package.json "engines" as advice, so the
 * server enforces the same range itself at startup.
 *
 * Keep in sync with package.json "engines" (a test checks it). Removing a line is a major release.
 */
export const SUPPORTED_NODE_RANGE = '^22.0.0 || ^24.0.0 || >=26.0.0';

const SUPPORTED_LINES = [22, 24];
const FIRST_OPEN_ENDED_LINE = 26;

/** Null when this Node.js version may run the server, otherwise why it may not. */
export function unsupportedRuntimeReason(version: string): string | null {
  const major = Number(/^v?(\d+)\.\d+\.\d+/.exec(version)?.[1]);
  if (SUPPORTED_LINES.includes(major) || major >= FIRST_OPEN_ENDED_LINE) {
    return null;
  }
  return [
    `Node.js ${version} is not supported: it no longer receives security fixes, and this server reads your codebase.`,
    `Requires Node.js 22, 24 or 26+ (${SUPPORTED_NODE_RANGE}).`,
    'Upgrade Node.js, or set your MCP client\'s "command" to the path of a supported node binary.',
  ].join(' ');
}
