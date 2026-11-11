import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test, { describe } from 'node:test';
import {
  copyDirInside,
  makeDirInside,
  removeInside,
  renameInside,
  unlinkInside,
  writeTextInside,
} from '../../dist/security/path-guard.js';

describe('security › path-guard-writes', () => {
  /** The guarded write helpers: the only way the server changes files (decision D17). */

  function sandbox(run: (root: string, outside: string) => void): void {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-guard-'));
    const root = path.join(base, 'project');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'keep me');
    try {
      run(root, outside);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }

  test('Guarded writes: inside the project root they work', () => {
    sandbox((root) => {
      const dir = path.join(root, '.agents', 'skills', 'qa-core');
      makeDirInside(root, dir);
      writeTextInside(root, path.join(dir, 'SKILL.md'), '# rules');
      copyDirInside(root, dir, path.join(root, '.agents', 'copy'));
      renameInside(root, path.join(root, '.agents', 'copy'), path.join(root, '.agents', 'moved'));
      assert.strictEqual(
        fs.readFileSync(path.join(root, '.agents', 'moved', 'SKILL.md'), 'utf8'),
        '# rules',
      );
      removeInside(root, path.join(root, '.agents', 'moved'));
      assert.strictEqual(fs.existsSync(path.join(root, '.agents', 'moved')), false);
    });
  });

  test('Guarded writes: every helper refuses a target outside the project root', () => {
    sandbox((root, outside) => {
      const outsidePath = path.join(root, '..', 'outside', 'x');
      assert.throws(() => makeDirInside(root, outsidePath), /escapes project root/);
      assert.throws(() => writeTextInside(root, outsidePath, 'x'), /escapes project root/);
      assert.throws(() => removeInside(root, outsidePath), /not inside project root/);
      assert.throws(() => unlinkInside(root, outsidePath), /not inside project root/);
      assert.throws(
        () => renameInside(root, path.join(root, 'a'), outsidePath),
        /not inside project root/,
      );
      assert.throws(
        () => renameInside(root, outsidePath, path.join(root, 'a')),
        /not inside project root/,
      );
      assert.throws(() => copyDirInside(root, outside, outsidePath), /not inside project root/);
      assert.throws(
        () => removeInside(root, root),
        /not inside project root/,
        'never the root itself',
      );
      assert.strictEqual(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'keep me');
    });
  });

  test('Guarded writes: a symlinked folder leading outside cannot be written through', () => {
    sandbox((root, outside) => {
      fs.symlinkSync(outside, path.join(root, 'link'));
      assert.throws(
        () => writeTextInside(root, path.join(root, 'link', 'secret.txt'), 'overwritten'),
        /points outside project root/,
      );
      assert.throws(
        () => removeInside(root, path.join(root, 'link', 'secret.txt')),
        /points outside/,
      );
      assert.strictEqual(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'keep me');
    });
  });

  test('Guarded writes: removing or moving a symlink never touches what it points to', () => {
    sandbox((root, outside) => {
      const link = path.join(root, 'skill');
      fs.symlinkSync(outside, link);
      renameInside(root, link, path.join(root, 'archived'));
      assert.ok(fs.lstatSync(path.join(root, 'archived')).isSymbolicLink());
      removeInside(root, path.join(root, 'archived'));
      fs.symlinkSync(outside, link);
      unlinkInside(root, link);
      assert.strictEqual(fs.existsSync(link), false);
      assert.strictEqual(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'keep me');
    });
  });
});
