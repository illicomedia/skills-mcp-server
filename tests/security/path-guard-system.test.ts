import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { validateSafeProjectPath } from '../../dist/security/path-guard.js';
import { isBlockedSystemPath } from '../../dist/security/system-paths.js';

describe('security › path-guard-system', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fqa-sysdir-'));
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  const posix = process.platform !== 'win32';

  test('isBlockedSystemPath: system roots and everything below the system trees are blocked', () => {
    const blocked = [
      '/',
      '/etc',
      '/etc/',
      '/etc/ssh',
      '/etc/ssh/sshd_config.d',
      '/bin',
      '/bin/sub',
      '/sbin',
      '/boot',
      '/boot/efi',
      '/dev',
      '/dev/shm',
      '/proc',
      '/proc/self/fd',
      '/sys',
      '/sys/kernel',
      '/root',
      '/usr',
      '/usr/bin',
      '/usr/bin/x',
      '/usr/sbin',
      '/usr/lib',
      '/usr/lib/node_modules',
      '/usr/lib64',
      '/usr/libexec',
      '/lib',
      '/lib64/x',
      '/var/run',
      '/var/run/docker',
      '/private/etc',
      '/private/etc/ssh',
      '/ETC/ssh',
      'C:\\',
      'c:/',
      'C:\\Windows',
      'C:\\Windows\\System32',
      'c:\\windows\\system32\\config',
      'D:\\Windows',
      'C:\\Program Files',
      'C:\\Program Files\\Git',
      'C:\\Program Files (x86)\\Foo',
      'C:\\ProgramData',
      'C:\\ProgramData\\ssh',
      // WSL mounts of Windows drives
      '/mnt/c',
      '/mnt/c/',
      '/mnt/c/Windows',
      '/mnt/c/Windows/System32',
      '/mnt/C/windows/system32',
      '/mnt/d/Program Files/App',
      '/mnt/c/ProgramData/ssh',
      // macOS system trees
      '/System',
      '/System/Library/CoreServices',
      '/Library',
      '/Library/Keychains',
      '/private/var/run',
      '/private/var/run/mDNSResponder',
    ];
    for (const candidate of blocked) {
      assert.equal(isBlockedSystemPath(candidate), true, candidate);
    }
  });

  test('isBlockedSystemPath: ordinary project locations are allowed', () => {
    const allowed = [
      '/home/user/project',
      '/home/user/etc',
      '/Users/me/Projects/bin',
      '/tmp',
      '/tmp/etc',
      '/tmp/project/usr/bin',
      '/mnt/d/projects',
      '/opt/app',
      '/srv/www',
      '/var/www/site',
      '/var/lib/project',
      '/usr/local/src/project',
      '/usr/src/app',
      '/root/project',
      '/binary',
      '/etcetera',
      '/bootstrap',
      '/devices',
      '/processes',
      '/systems',
      '/libs',
      '/lib2',
      'relative/etc',
      'C:\\Users\\me\\project',
      'C:\\Windows2',
      'C:\\WindowsApps',
      'C:\\Program Files Custom',
      'C:\\ProgramDataX',
      'D:\\work\\Windows',
      '/mnt/d/projects2/skills-mcp-server',
      '/mnt/c/Users/me/project',
      '/mnt/cdrom',
      '/mnt/cdrom/windows',
      '/mnt/c2/windows',
      '/mnt/wsl',
      '/mnt',
      '/Users/me/Library/project',
      '/home/me/System',
      '/Libraryx',
      '/private/var/folders/x',
      '/private/tmp/project',
      '',
    ];
    for (const candidate of allowed) {
      assert.equal(isBlockedSystemPath(candidate), false, candidate);
    }
  });

  test('validateSafeProjectPath: a directory below a system tree is refused', {
    skip: !posix,
  }, () => {
    for (const below of ['/etc/default', '/usr/bin', '/proc/self', '/sys/kernel', '/dev/shm']) {
      if (fs.existsSync(below)) {
        assert.throws(
          () => validateSafeProjectPath(below, 'op'),
          /cannot target system directory/,
          below,
        );
      }
    }
  });

  test('validateSafeProjectPath: dot segments cannot reach a system tree', { skip: !posix }, () => {
    assert.throws(
      () =>
        validateSafeProjectPath(path.join(root, '..', '..', '..', '..', 'etc', 'default'), 'op'),
      /cannot target system directory|does not exist/,
    );
    assert.throws(
      () => validateSafeProjectPath('/tmp/../etc/default', 'op'),
      /cannot target system directory/,
    );
  });

  test('validateSafeProjectPath: a symlink into a system tree is refused, even nested', {
    skip: !posix,
  }, () => {
    const direct = path.join(root, 'to-usr-bin');
    fs.symlinkSync('/usr/bin', direct);
    assert.throws(() => validateSafeProjectPath(direct, 'op'), /cannot target system directory/);

    const chained = path.join(root, 'chain');
    fs.symlinkSync(direct, chained);
    assert.throws(() => validateSafeProjectPath(chained, 'op'), /cannot target system directory/);
  });

  test('validateSafeProjectPath: normal project folders still work', () => {
    const project = fs.mkdtempSync(path.join(root, 'proj-'));
    const nested = path.join(project, 'etc', 'bin');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(validateSafeProjectPath(project, 'op'), fs.realpathSync(project));
    assert.equal(validateSafeProjectPath(nested, 'op'), fs.realpathSync(nested));
    assert.equal(validateSafeProjectPath(`${project}/`, 'op'), fs.realpathSync(project));
  });

  test('validateSafeProjectPath: the error names the operation', { skip: !posix }, () => {
    assert.throws(() => validateSafeProjectPath('/etc/default', 'quick_check'), /\[quick_check\]/);
  });
});
