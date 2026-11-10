import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import test from 'node:test';
import { LineFramer } from '../dist/server/framing.js';
import { FredoQaMcpServer, MAX_REQUEST_BYTES } from '../dist/server/server.js';
import { runStdio } from './mcp-fixture.ts';

function framer(max = 8) {
  const lines: string[] = [];
  let oversize = 0;
  const f = new LineFramer(
    max,
    (line) => lines.push(line),
    () => {
      oversize += 1;
    },
  );
  return { f, lines, oversize: () => oversize };
}

test('LineFramer: lines split across chunks and several lines in one chunk', () => {
  const { f, lines } = framer();
  f.push(Buffer.from('ab'));
  f.push(Buffer.from('c\nde'));
  f.push(Buffer.from('f\ngh\n'));
  assert.deepEqual(lines, ['abc', 'def', 'gh']);
});

test('LineFramer: a line of exactly the cap is accepted, one byte more is dropped', () => {
  const { f, lines, oversize } = framer(4);
  f.push(Buffer.from('abcd\nabcde\nxy\n'));
  assert.deepEqual(lines, ['abcd', 'xy']);
  assert.equal(oversize(), 1);
});

test('LineFramer: an oversize line is reported once, even across chunks, then input resumes', () => {
  const { f, lines, oversize } = framer(4);
  f.push(Buffer.from('abcde'));
  f.push(Buffer.from('fghij'));
  f.push(Buffer.from('klm'));
  assert.equal(oversize(), 1);
  assert.deepEqual(lines, []);
  f.push(Buffer.from('nop\nok\n'));
  assert.deepEqual(lines, ['ok']);
});

test('LineFramer: the cap counts bytes and a multi-byte character may span chunks', () => {
  const { f, lines, oversize } = framer(4);
  const euro = Buffer.from('€'); // 3 bytes
  f.push(Buffer.concat([Buffer.from('a'), euro.subarray(0, 1)]));
  f.push(Buffer.concat([euro.subarray(1), Buffer.from('\n')]));
  assert.deepEqual(lines, ['a€']);
  f.push(Buffer.from('€€\n'));
  assert.equal(oversize(), 1);
});

test('LineFramer: end() flushes a last line without newline and ignores a dropped one', () => {
  const first = framer();
  first.f.push(Buffer.from('tail'));
  first.f.end();
  assert.deepEqual(first.lines, ['tail']);

  const second = framer(2);
  second.f.push(Buffer.from('toolong'));
  second.f.end();
  assert.deepEqual(second.lines, []);
  assert.equal(second.oversize(), 1);
});

test('startStdio: an oversize request is answered with a parse error and the next one still works', async () => {
  const out = await runStdio(new FredoQaMcpServer(), (input) => {
    input.push(Buffer.alloc(MAX_REQUEST_BYTES + 1, 0x61));
    input.push(
      '\n{"jsonrpc":"2.0","id":7,"method":"ping"}\n{"jsonrpc":"2.0","id":8,"method":"ping"}',
    );
    input.push(null);
  });
  const answers = out
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(answers.length, 3);
  assert.equal(answers[0].error.code, -32700);
  assert.match(answers[0].error.message, /maximum allowed size/);
  assert.equal(answers[1].id, 7);
  assert.equal(answers[2].id, 8);
});

test('built server: a huge line without newline is dropped and the next request is still answered', async () => {
  const entry = path.resolve('dist/index.js');
  const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
  });
  const block = Buffer.alloc(1024 * 1024, 0x61);
  for (let i = 0; i < 64; i += 1) {
    if (!child.stdin.write(block)) {
      await new Promise((resolve) => child.stdin.once('drain', resolve));
    }
  }
  child.stdin.write('\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  child.stdin.end();
  await new Promise((resolve) => child.once('close', resolve));
  const answers = out
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(answers[0].error.code, -32700);
  assert.equal(answers[1].id, 1);
});
