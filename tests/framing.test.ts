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

function collect(max: number) {
  const lines: string[] = [];
  let oversize = 0;
  const f = new LineFramer(
    max,
    (l) => lines.push(l),
    () => {
      oversize += 1;
    },
  );
  return { f, lines, oversize: () => oversize };
}

test('LineFramer: empty chunks and lone newlines produce only empty lines', () => {
  const { f, lines, oversize } = collect(8);
  f.push(Buffer.alloc(0));
  f.push(Buffer.from('\n'));
  f.push(Buffer.alloc(0));
  f.push(Buffer.from('\n\n'));
  assert.deepEqual(lines, ['', '', '']);
  assert.equal(oversize(), 0);
});

test('LineFramer: a line fed one byte at a time is assembled, at and over the cap', () => {
  const ok = collect(5);
  for (const byte of Buffer.from('hello\n')) {
    ok.f.push(Buffer.from([byte]));
  }
  assert.deepEqual(ok.lines, ['hello']);

  const over = collect(5);
  for (const byte of Buffer.from('hello!\nnext\n')) {
    over.f.push(Buffer.from([byte]));
  }
  assert.equal(over.oversize(), 1);
  assert.deepEqual(over.lines, ['next']);
});

test('LineFramer: the cap holds across a chunk boundary, on both sides', () => {
  const exact = collect(6);
  exact.f.push(Buffer.from('abc'));
  exact.f.push(Buffer.from('def\n'));
  assert.deepEqual(exact.lines, ['abcdef']);

  const over = collect(6);
  over.f.push(Buffer.from('abc'));
  over.f.push(Buffer.from('defg\nok\n'));
  assert.equal(over.oversize(), 1);
  assert.deepEqual(over.lines, ['ok']);
});

test('LineFramer: every oversize line is reported once, back to back or separated', () => {
  const { f, lines, oversize } = collect(3);
  f.push(Buffer.from('aaaa\nbbbbb\nok\ncccccc'));
  f.push(Buffer.from('c\n\nz\n'));
  assert.equal(oversize(), 3);
  assert.deepEqual(lines, ['ok', '', 'z']);
});

test('LineFramer: a cap of zero accepts only empty lines', () => {
  const { f, lines, oversize } = collect(0);
  f.push(Buffer.from('\nx\n\n'));
  assert.deepEqual(lines, ['', '']);
  assert.equal(oversize(), 1);
});

test('LineFramer: CRLF keeps the carriage return for the caller to trim', () => {
  const { f, lines } = collect(16);
  f.push(Buffer.from('a\r\nb\r\n'));
  assert.deepEqual(lines, ['a\r', 'b\r']);
});

test('LineFramer: NUL bytes and invalid UTF-8 are delivered, not fatal', () => {
  const { f, lines, oversize } = collect(16);
  f.push(Buffer.from([0x61, 0x00, 0x62, 0x0a, 0xff, 0xfe, 0xc3, 0x0a]));
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'a\u0000b');
  assert.ok(lines[1].includes('�'));
  assert.equal(oversize(), 0);
});

test('LineFramer: end() twice, or after a newline, adds only empty lines', () => {
  const { f, lines } = collect(8);
  f.push(Buffer.from('a\n'));
  f.end();
  f.end();
  assert.deepEqual(lines, ['a', '', '']);
});

test('LineFramer: feeding after end() starts a fresh line', () => {
  const { f, lines } = collect(8);
  f.push(Buffer.from('partial'));
  f.end();
  f.push(Buffer.from('again\n'));
  assert.deepEqual(lines, ['partial', 'again']);
});

test('LineFramer: any chunking of the same bytes gives the same lines (seeded fuzz)', () => {
  let seed = 12345;
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const alphabet = Buffer.from('ab\n€{}"\r');
  const stream = Buffer.from(Array.from({ length: 4000 }, () => alphabet[next(alphabet.length)]));
  const whole = collect(20);
  whole.f.push(stream);
  whole.f.end();
  for (let round = 0; round < 50; round += 1) {
    const parts = collect(20);
    let at = 0;
    while (at < stream.length) {
      const size = 1 + next(37);
      parts.f.push(stream.subarray(at, at + size));
      at += size;
    }
    parts.f.end();
    assert.deepEqual(parts.lines, whole.lines, `round ${round}`);
    assert.equal(parts.oversize(), whole.oversize(), `round ${round}`);
  }
});

test('LineFramer: a hundred thousand small lines in one chunk', () => {
  const { f, lines } = collect(16);
  f.push(Buffer.from('{"a":1}\n'.repeat(100_000)));
  assert.equal(lines.length, 100_000);
});

test('LineFramer: a stream of endless oversize garbage is reported once and never accumulates', () => {
  const { f, lines, oversize } = collect(1024);
  const block = Buffer.alloc(64 * 1024, 0x41);
  for (let i = 0; i < 2000; i += 1) {
    f.push(block);
  }
  assert.equal(oversize(), 1);
  f.push(Buffer.from('\nok\n'));
  assert.deepEqual(lines, ['ok']);
});

test('handleLine: the cap counts bytes, so a line of multi-byte characters is measured honestly', () => {
  const server = new FredoQaMcpServer();
  const euros = '€'.repeat(Math.floor(MAX_REQUEST_BYTES / 3) + 1); // fewer characters than bytes
  assert.ok(euros.length < MAX_REQUEST_BYTES);
  assert.ok(Buffer.byteLength(euros) > MAX_REQUEST_BYTES);
  assert.match(String(server.handleLine(euros)), /maximum allowed size/);
});

test('LineFramer: a partial line is copied, so a reused or huge chunk is never kept alive', () => {
  const { f, lines } = collect(16);
  const chunk = Buffer.from('abc');
  f.push(chunk);
  chunk.fill(0x7a); // the caller reuses its buffer before the line ends
  f.push(Buffer.from('def\n'));
  assert.deepEqual(lines, ['abcdef']);
});
