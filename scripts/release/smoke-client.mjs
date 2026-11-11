// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT

/** A minimal MCP client: the smoke test of a built server, and the refusal check. */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';

const DEFAULT_SMOKE_TIMEOUT_MS = 10_000;

/** MCP protocol revision the smoke test announces as a client. */
export const SMOKE_PROTOCOL_VERSION = '2024-11-05';

/**
 * Starts a built server and runs a real MCP stdio session: initialize, the initialized
 * notification, tools/list, then tools/call get_version. Resolves with the number of tools;
 * rejects when the server crashes, stays silent, speaks no protocol version, reports another
 * version or exposes no tools.
 */
export function smokeTestServer(
  command,
  expectedVersion,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
  args = [],
) {
  return new Promise((resolve, reject) => {
    const server = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = [];
    let settled = false;
    let tools = 0;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.kill();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const send = (message) => {
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    };

    const timer = setTimeout(
      () => finish(new Error(`Server gave no answer within ${timeoutMs} ms`)),
      timeoutMs,
    );

    const onInitialize = (result) => {
      if (typeof result?.protocolVersion !== 'string') {
        return finish(new Error('Server answered initialize without a protocolVersion'));
      }
      const version = result.serverInfo?.version;
      if (version !== expectedVersion) {
        return finish(new Error(`Server reports version ${version}, expected ${expectedVersion}`));
      }
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/list', params: {} });
    };

    const onToolsList = (result) => {
      tools = (result?.tools ?? []).length;
      if (tools === 0) {
        return finish(new Error('Server exposes no tools'));
      }
      send({ id: 3, method: 'tools/call', params: { name: 'get_version', arguments: {} } });
    };

    const onGetVersion = (result) => {
      const text = result?.content?.[0]?.text ?? '';
      if (result?.isError || !text.includes(`"version": "${expectedVersion}"`)) {
        return finish(new Error(`tools/call get_version failed: ${text}`));
      }
      finish(null, { tools });
    };

    const handlers = { 1: onInitialize, 2: onToolsList, 3: onGetVersion };

    server.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    server.stdin.on('error', finish);
    server.on('error', (error) => finish(error));
    server.on('exit', (code) =>
      finish(new Error(`Server exited early with code ${code}: ${stderr.join('').trim()}`)),
    );

    readline.createInterface({ input: server.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      handlers[message.id]?.(message.result);
    });

    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: SMOKE_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'release-smoke-test', version: expectedVersion },
      },
    });
  });
}

/**
 * Starts a built server that must refuse to run (an unsupported Node.js): resolves when it exits
 * with code 1 and a [FATAL] "not supported" message, printing nothing on stdout; rejects when it
 * exits otherwise or stays alive. Its stdin is empty: a server that wrongly starts sees the end of
 * its input and exits with code 0, which is rejected.
 */
export function expectServerRefusal(command, timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS, args = []) {
  return new Promise((resolve, reject) => {
    const server = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    const timer = setTimeout(() => {
      server.kill();
      reject(new Error(`Server did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    server.stdout.on('data', (chunk) => {
      output.stdout += String(chunk);
    });
    server.stderr.on('data', (chunk) => {
      output.stderr += String(chunk);
    });
    server.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 1 && !output.stdout && /\[FATAL\].*not supported/.test(output.stderr)) {
        resolve(output.stderr.trim());
      } else {
        reject(
          new Error(
            `Expected a refusal, got exit ${code}: ${output.stderr || output.stdout}`.trim(),
          ),
        );
      }
    });
  });
}
