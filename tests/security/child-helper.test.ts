import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runModuleInChild } from '../helpers/child.ts';

describe('security › child-helper', () => {
  test('child output is plain even when the parent forces colours (a terminal run)', async () => {
    const saved = process.env.FORCE_COLOR;
    for (const forced of ['1', '2', '3', 'true']) {
      process.env.FORCE_COLOR = forced;
      try {
        const { done, out } = await runModuleInChild("console.log('n', 42, true, null);");
        assert.equal(done, true);
        assert.equal(out, 'n 42 true null\n', `FORCE_COLOR=${forced}`);
      } finally {
        if (saved === undefined) {
          delete process.env.FORCE_COLOR;
        } else {
          process.env.FORCE_COLOR = saved;
        }
      }
    }
  });

  test('a child that never ends is killed and reported as not done', async () => {
    const { done } = await runModuleInChild('setInterval(() => {}, 1000);', 300);
    assert.equal(done, false);
  });
});
