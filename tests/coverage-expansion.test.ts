import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { runComplianceAudit } from '../dist/audit/index.js';
import { canonicalJson, validateLicense } from '../dist/license/license.js';
import { resolveSkillLicense } from '../dist/license/templates.js';
import { ToolExecutor } from '../dist/server/executor.js';
import { FredoQaMcpServer } from '../dist/server/server.js';
import {
  findSkill,
  getAvailableSkills,
  loadSkillContent,
  loadSkillLicense,
} from '../dist/skills/catalog.js';
import { detectProjectSkills, installSkill } from '../dist/skills/installer.js';
import { signedLicense, TEST_KEY_ID, TEST_LICENSE_OPTIONS } from './license-fixture.ts';
import { writeSkillSources } from './skill-fixture.ts';

test('Server: handleRequest ping and initialized notifications', () => {
  const server = new FredoQaMcpServer();
  const pingRes = server.handleRequest({
    jsonrpc: '2.0',
    id: 10,
    method: 'ping',
  });
  assert.strictEqual(pingRes.id, 10);
  assert.deepStrictEqual(pingRes.result, {});

  const initRes = server.handleRequest({
    jsonrpc: '2.0',
    id: 11,
    method: 'notifications/initialized',
  });
  assert.strictEqual(initRes.id, 11);
});

test('Server: handleRequest captures tool execution exceptions gracefully', () => {
  const server = new FredoQaMcpServer();
  // Pass an invalid project path or induce an error in tool execution
  const originalExecute = ToolExecutor.execute;
  ToolExecutor.execute = () => {
    throw new Error('Forced execution failure');
  };
  try {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'list_skills', arguments: {} },
    });
    assert.strictEqual(res.id, 99);
    const result = res.result as { isError: boolean; content: Array<{ text: string }> };
    assert.strictEqual(result.isError, true);
    assert.match(result.content[0].text, /Forced execution failure/);
  } finally {
    ToolExecutor.execute = originalExecute;
  }
});

test('Server: startStdio handles valid lines, empty lines, and parse errors', async () => {
  const server = new FredoQaMcpServer();

  // Create mock stdin and stdout
  const input = new Readable({ read() {} });
  let outputText = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputText += chunk.toString();
      callback();
    },
  });

  const origStdin = process.stdin;
  const origStdout = process.stdout;

  Object.defineProperty(process, 'stdin', { value: input, configurable: true });
  Object.defineProperty(process, 'stdout', { value: output, configurable: true });

  try {
    server.startStdio();

    // 1. Empty lines should be ignored
    input.push('   \n');
    input.push('\n');

    // 2. Valid ping request
    input.push('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    // 3. Notification (no id)
    input.push('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

    // 4. Malformed JSON (parse error)
    input.push('{ broken json \n');

    // Allow event loop ticks for readline processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    const lines = outputText
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.strictEqual(lines.length, 2); // 1 ping response + 1 parse error response

    // Check ping response
    assert.strictEqual(lines[0].id, 1);
    assert.deepStrictEqual(lines[0].result, {});

    // Check parse error response
    assert.strictEqual(lines[1].id, null);
    assert.strictEqual(lines[1].error.code, -32700);
  } finally {
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: origStdout, configurable: true });
  }
});

test('Catalog: findSkill, loadSkillContent and loadSkillLicense error branches', () => {
  assert.strictEqual(findSkill('non-existent-skill'), undefined);

  assert.throws(() => loadSkillContent('non-existent-skill'), /Unknown skill: non-existent-skill/);

  const license = validateLicense(undefined, TEST_LICENSE_OPTIONS);
  assert.throws(
    () => loadSkillLicense('non-existent-skill', license),
    /Unknown skill: non-existent-skill/,
  );

  // No SKILL.md on disk: fail explicitly instead of synthesizing rules
  const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-empty-'));
  try {
    assert.throws(
      () => loadSkillContent('qa-core', tmpEmptyDir),
      (err: unknown) =>
        err instanceof Error &&
        err.name === 'SkillNotInstalledError' &&
        /not installed/.test(err.message) &&
        /\.agents\/skills\/qa-core\//.test(err.message) &&
        !/qa:starter|qa:standard/.test(err.message),
    );

    const res = installSkill('qa-core', tmpEmptyDir, license, { confirm: true });
    assert.strictEqual(res.success, false);
    assert.deepStrictEqual(res.installedFiles, []);
    assert.match(res.message, /not installed/);
    assert.strictEqual(fs.existsSync(path.join(tmpEmptyDir, '.agents')), false);
  } finally {
    fs.rmSync(tmpEmptyDir, { recursive: true, force: true });
  }

  // Test getAvailableSkills tiers
  const freeSkills = getAvailableSkills('free');
  assert.strictEqual(freeSkills.length, 11);
  const proSkills = getAvailableSkills('pro');
  assert.strictEqual(proSkills.length, 19);
  const entSkills = getAvailableSkills('enterprise');
  assert.strictEqual(entSkills.length, 25);
});

test('License Templates: fallback when no license file exists on disk', () => {
  const meta = findSkill('qa-core')!;
  const license = validateLicense(undefined, TEST_LICENSE_OPTIONS);
  const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-no-lic-'));
  try {
    const mitText = resolveSkillLicense(meta, license, tmpEmptyDir);
    assert.match(mitText, /MIT License/);

    const proMeta = findSkill('qa-security')!;
    const proLicense = validateLicense(
      signedLicense({ tier: 'pro', licensee: 'Acme Corp' }),
      TEST_LICENSE_OPTIONS,
    );
    const commText = resolveSkillLicense(proMeta, proLicense, tmpEmptyDir);
    assert.match(commText, /Fredo QA Commercial Skills License/);
    assert.match(commText, /Licensee: Acme Corp/);
  } finally {
    fs.rmSync(tmpEmptyDir, { recursive: true, force: true });
  }
});

test('Executor: category filter and restricted skill prompt', () => {
  // Category filter
  const resCat = ToolExecutor.execute(
    'list_skills',
    { category: 'core' },
    undefined,
    () => {},
    TEST_LICENSE_OPTIONS,
  );
  assert.match(resCat, /qa-core/);
  assert.ok(!resCat.includes('qa-python'));

  // Access restricted prompt when asking for pro rules under free tier
  const restrictedRes = ToolExecutor.execute(
    'get_skill_rules',
    { skill_id: 'qa-security' },
    undefined,
    () => {},
    TEST_LICENSE_OPTIONS,
  );
  assert.match(restrictedRes, /# Access Restricted: qa-security/);
  assert.match(restrictedRes, /https:\/\/www\.illicomedia\.com\/qa-skills\/pricing/);

  // Unsupported tool name
  assert.throws(
    () => ToolExecutor.execute('invalid_tool', {}, undefined, () => {}),
    /Unsupported tool: invalid_tool/,
  );
});

test('Installer: detectProjectSkills for Python, Rust, Go, Java, C/C++, PHP, DevOps and Shell', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-detect-'));
  try {
    fs.writeFileSync(path.join(tmp, 'pyproject.toml'), '');
    fs.writeFileSync(path.join(tmp, 'Cargo.toml'), '');
    fs.writeFileSync(path.join(tmp, 'go.mod'), '');
    fs.writeFileSync(path.join(tmp, 'pom.xml'), '');
    fs.writeFileSync(path.join(tmp, 'CMakeLists.txt'), '');
    fs.writeFileSync(path.join(tmp, 'composer.json'), '');
    fs.writeFileSync(path.join(tmp, 'script.sh'), '#!/bin/bash');
    fs.mkdirSync(path.join(tmp, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      '{"dependencies": {"@modelcontextprotocol/sdk": "1.0"}}',
    );

    const detected = detectProjectSkills(tmp);
    assert.ok(detected.includes('qa-python'));
    assert.ok(detected.includes('qa-rust'));
    assert.ok(detected.includes('qa-go'));
    assert.ok(detected.includes('qa-java'));
    assert.ok(detected.includes('qa-c-cpp'));
    assert.ok(detected.includes('qa-php'));
    assert.ok(detected.includes('qa-bash'));
    assert.ok(detected.includes('qa-devops'));
    assert.ok(detected.includes('qa-security'));
    assert.ok(detected.includes('qa-mcp'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Installer: installSkill blocks enterprise skill for pro tier', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-ent-block-'));
  try {
    const proLicense = validateLicense(
      signedLicense({ tier: 'pro', licensee: 'Pro User' }),
      TEST_LICENSE_OPTIONS,
    );
    const res = installSkill('qa-ai-infrastructure-compliance', tmp, proLicense);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.requiredTier, 'enterprise');
    assert.match(res.message, /Enterprise Assurance skill/);

    // Filesystem error handling in installSkill
    const fsErrRes = installSkill('qa-core', '/dev/null/forbidden-dir', proLicense, {
      confirm: true,
    });
    assert.strictEqual(fsErrRes.success, false);
    assert.match(fsErrRes.message, /Failed to install skill 'qa-core'/);

    // Symlink cleanup in installSkill
    writeSkillSources(tmp, ['qa-core']);
    const symlinkTargetDir = path.join(tmp, '.agents', 'skills', 'qa-core');
    fs.mkdirSync(path.dirname(symlinkTargetDir), { recursive: true });
    fs.symlinkSync(path.join(tmp, 'non-existent-target'), symlinkTargetDir);
    const symlinkRes = installSkill('qa-core', tmp, undefined, { confirm: true });
    assert.strictEqual(symlinkRes.success, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('License: canonicalJson with primitives and arrays', () => {
  assert.strictEqual(canonicalJson(123), '123');
  assert.strictEqual(canonicalJson('text'), '"text"');
  assert.strictEqual(canonicalJson(null), 'null');
  assert.strictEqual(canonicalJson([3, 1, 2]), '[3,1,2]');
  assert.strictEqual(canonicalJson([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]');
});

test('License: validation edge cases and malformed payloads', () => {
  // File exceeding size limit
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-lic-edge-'));
  try {
    const bigFile = path.join(tmp, 'big-license.json');
    fs.writeFileSync(bigFile, 'a'.repeat(65537));
    const bigRes = validateLicense(bigFile, TEST_LICENSE_OPTIONS);
    assert.strictEqual(bigRes.valid, false);
    assert.match(bigRes.message, /exceeds 65536 bytes/);

    // Non-object JSON in license file
    const nonObjDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-non-obj-'));
    try {
      const nonObjFile = path.join(nonObjDir, 'license.json');
      fs.writeFileSync(nonObjFile, '[1, 2, 3]');
      const nonObjRes = validateLicense(nonObjFile, TEST_LICENSE_OPTIONS);
      assert.strictEqual(nonObjRes.valid, false);
      assert.match(nonObjRes.message, /must contain a JSON object/);
    } finally {
      fs.rmSync(nonObjDir, { recursive: true, force: true });
    }

    // Non-Ed25519 key (e.g. RSA) triggers non-Ed25519 branch
    const rsaKeys = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const rsaDoc = signedLicense({ key_id: 'rsa-key' });
    const rsaRes = validateLicense(rsaDoc, {
      ...TEST_LICENSE_OPTIONS,
      trustedKeys: { 'rsa-key': rsaKeys.publicKey },
    });
    assert.strictEqual(rsaRes.valid, false);
    assert.match(rsaRes.message, /not an Ed25519 key/);

    // Signature verification failure exception (e.g. malformed PEM in trustedKeys throws in createPublicKey)
    const badKeyDoc = signedLicense({ key_id: 'bad-pem-key' });
    const badKeyRes = validateLicense(badKeyDoc, {
      ...TEST_LICENSE_OPTIONS,
      trustedKeys: { 'bad-pem-key': 'not a valid pem string' },
    });
    assert.strictEqual(badKeyRes.valid, false);
    assert.match(badKeyRes.message, /could not be verified/);

    // Unsupported field
    assert.match(
      validateLicense(
        '{"schema_version":1,"license_id":"1","hacked_field":"bad"}',
        TEST_LICENSE_OPTIONS,
      ).message,
      /not supported/,
    );

    // Empty string required field
    assert.match(
      validateLicense('{"schema_version":1,"license_id":""}', TEST_LICENSE_OPTIONS).message,
      /must be a non-empty string/,
    );

    // Invalid tier
    const invalidTierJson = JSON.stringify({
      schema_version: 1,
      license_id: '1',
      licensee: 'a',
      contact: 'b',
      tier: 'gold',
      seats: 1,
      issued_at: '2026-01-01T00:00:00Z',
      updates_until: '2026-01-01T00:00:00Z',
      binding: { kind: 'none' },
      key_id: 'k',
      signature: 's',
    });
    assert.match(
      validateLicense(invalidTierJson, TEST_LICENSE_OPTIONS).message,
      /must be 'pro' or 'enterprise'/,
    );

    // Invalid seats
    const invalidSeatsJson = JSON.stringify({
      schema_version: 1,
      license_id: '1',
      licensee: 'a',
      contact: 'b',
      tier: 'pro',
      seats: 0,
      issued_at: '2026-01-01T00:00:00Z',
      updates_until: '2026-01-01T00:00:00Z',
      binding: { kind: 'none' },
      key_id: 'k',
      signature: 's',
    });
    assert.match(
      validateLicense(invalidSeatsJson, TEST_LICENSE_OPTIONS).message,
      /positive integer/,
    );

    // Invalid timestamp
    const invalidDateJson = JSON.stringify({
      schema_version: 1,
      license_id: '1',
      licensee: 'a',
      contact: 'b',
      tier: 'pro',
      seats: 1,
      issued_at: 'not-a-date',
      updates_until: '2026-01-01T00:00:00Z',
      binding: { kind: 'none' },
      key_id: 'k',
      signature: 's',
    });
    assert.match(
      validateLicense(invalidDateJson, TEST_LICENSE_OPTIONS).message,
      /ISO-8601 UTC timestamp/,
    );

    // Invalid binding
    const invalidBindingJson = JSON.stringify({
      schema_version: 1,
      license_id: '1',
      licensee: 'a',
      contact: 'b',
      tier: 'pro',
      seats: 1,
      issued_at: '2026-01-01T00:00:00Z',
      updates_until: '2026-01-01T00:00:00Z',
      binding: { kind: 'hardware-dongle' },
      key_id: 'k',
      signature: 's',
    });
    assert.match(
      validateLicense(invalidBindingJson, TEST_LICENSE_OPTIONS).message,
      /binding kind must be 'none'/,
    );

    // Invalid signature base64
    const invalidSigJson = JSON.stringify({
      schema_version: 1,
      license_id: '1',
      licensee: 'a',
      contact: 'b',
      tier: 'pro',
      seats: 1,
      issued_at: '2026-01-01T00:00:00Z',
      updates_until: '2026-01-01T00:00:00Z',
      binding: { kind: 'none' },
      key_id: TEST_KEY_ID,
      signature: 'not valid base64!!!',
    });
    assert.match(validateLicense(invalidSigJson, TEST_LICENSE_OPTIONS).message, /valid base64/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Installer: installSkill returns failure for unknown skill', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-inst-unknown-'));
  try {
    const res = installSkill('totally-unknown-skill', tmp);
    assert.strictEqual(res.success, false);
    assert.match(res.message, /Unknown skill/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Catalog: loadSkillContent reads real file from disk', () => {
  const rootDir = path.resolve('../..');
  const content = loadSkillContent('qa-core', rootDir);
  assert.ok(content.length > 0);
  assert.match(content, /Core engineering policy/i);
});

test('Audit: audits project with valid security.txt and gitignore', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-sec-audit-'));
  try {
    fs.mkdirSync(path.join(tmp, '.well-known'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.well-known', 'security.txt'),
      'Contact: security@example.com\n',
    );
    fs.writeFileSync(path.join(tmp, '.gitignore'), '# no secret ignored here\n');

    const server = new FredoQaMcpServer();
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 200,
      method: 'tools/call',
      params: {
        name: 'quick_check',
        arguments: { project_path: tmp, confirm: true },
      },
    });
    assert.strictEqual(res.id, 200);
    const content = (res.result as { content: Array<{ text: string }> }).content[0].text;
    const report = JSON.parse(content);
    const secCheck = report.results.find(
      (r: { name: string }) => r.name === 'security.txt present',
    );
    assert.strictEqual(secCheck.passed, true);
    assert.match(secCheck.details, /security\.txt file present/);

    const envCheck = report.results.find(
      (r: { name: string }) => r.name === '.gitignore mentions .env',
    );
    assert.strictEqual(envCheck.passed, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: Pre-flight lock and clean exit on stdin close', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-cli-test-'));
  try {
    const cliPath = path.resolve('dist/index.js');
    const child = spawn(process.execPath, [cliPath], {
      cwd: tmp,
      env: { ...process.env, NODE_ENV: 'test' },
    });

    // Close stdin immediately so the server terminates gracefully if started
    child.stdin.end();

    const exitCode = await new Promise((resolve) => {
      child.on('close', resolve);
    });

    assert.ok(exitCode === 0 || exitCode === 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Audit: malformed package.json triggers catch block', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-malformed-pkg-'));
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{ broken JSON');
    const report = runComplianceAudit(tmp, { confirm: true });
    const qaCheck = report.results.find((r) => r.name.includes('qa:starter'));
    assert.strictEqual(qaCheck?.passed, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Installer: error handling in fileContains and readdirSync', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-err-installer-'));
  try {
    // create package.json as a directory so fs.readFileSync throws EISDIR inside fileContains
    fs.mkdirSync(path.join(tmp, 'package.json'));
    const detected = detectProjectSkills(tmp);
    assert.ok(detected.includes('qa-javascript-typescript'));

    // readdirSync throwing on a non-directory file
    const dummyFile = path.join(tmp, 'some-file.txt');
    fs.writeFileSync(dummyFile, 'hello');
    const detectedFromFile = detectProjectSkills(dummyFile);
    assert.ok(detectedFromFile.includes('qa-core'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: Pre-flight lock triggers fatal exit when LICENSE is missing', async () => {
  const licensePath = path.resolve('LICENSE');
  const backupLicense = path.resolve('LICENSE.coverage_bak');
  let renamed = false;
  if (fs.existsSync(licensePath)) {
    fs.renameSync(licensePath, backupLicense);
    renamed = true;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-no-lic-'));
  try {
    const cliPath = path.resolve('dist/index.js');
    const child = spawn(process.execPath, [cliPath], {
      cwd: tmp,
      env: { ...process.env, NODE_ENV: 'test' },
    });

    let stderrOutput = '';
    child.stderr.on('data', (d) => {
      stderrOutput += d.toString();
    });
    const exitCode = await new Promise((resolve) => {
      child.on('close', resolve);
    });

    assert.strictEqual(exitCode, 1);
    assert.match(stderrOutput, /License Pre-Flight Security Lock failed/);
  } finally {
    if (renamed && fs.existsSync(backupLicense)) {
      fs.renameSync(backupLicense, licensePath);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Security Guard: validateSafeProjectPath blocks root and sensitive system directories', async () => {
  const { validateSafeProjectPath, validateSafeWriteTarget } = await import(
    '../dist/security/path-guard.js'
  );

  assert.throws(() => validateSafeProjectPath('/', 'test_root'), /cannot target system directory/);

  assert.throws(
    () => validateSafeProjectPath('/etc', 'test_etc'),
    /cannot target system directory/,
  );

  const sshDir = path.join(os.homedir(), '.ssh');
  if (fs.existsSync(sshDir)) {
    assert.throws(
      () => validateSafeProjectPath(sshDir, 'test_ssh'),
      /cannot target credential directory/,
    );
  }

  // Path escaping in write target
  assert.throws(
    () => validateSafeWriteTarget('/tmp/project', '/tmp/other/secret'),
    /escapes project root/,
  );
});

test('Security Guard: installSkill rejects attempts to write outside project root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fredo-qa-jail-'));
  try {
    const res = installSkill('qa-core', '/etc', undefined, { confirm: true });
    assert.strictEqual(res.success, false);
    assert.match(res.message, /Security restriction/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
