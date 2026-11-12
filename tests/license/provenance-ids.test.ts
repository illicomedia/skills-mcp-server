import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { generateCanaryWatermark } from '../../dist/license/license.js';
import { FredoQaMcpServer } from '../../dist/server/server.js';
import { signedLicense, TEST_LICENSE_OPTIONS } from '../helpers/license-fixture.ts';
import { callToolText, withTempDir } from '../helpers/mcp-fixture.ts';
import { writeSkillSources } from '../helpers/skill-fixture.ts';

// GDPR action G2: what is copied into skill files, committed by projects and sent to AI
// providers carries the opaque license id, never the licensee's name or email.
const NAME = 'Example Licensee Ltd';
const EMAIL = 'licensee@example.invalid';

/** Installs qa-security with a license, then returns the installed SKILL.md and the rules answer. */
function installed(license: string): { skill: string; rules: string } {
  let out = { skill: '', rules: '' };
  withTempDir('fqa-ids-', (project) => {
    writeSkillSources(project, ['qa-security']);
    const server = new FredoQaMcpServer(license, TEST_LICENSE_OPTIONS);
    const args = { skill_id: 'qa-security', project_path: project };
    callToolText(server, 'install_skill', { ...args, confirm: true });
    const file = path.join(project, '.agents', 'skills', 'qa-security', 'SKILL.md');
    out = {
      skill: fs.readFileSync(file, 'utf8'),
      rules: callToolText(server, 'get_skill_rules', args),
    };
  });
  return out;
}

describe('license › provenance-ids', () => {
  test('the watermark and the rules answer carry the license id, no name or email', () => {
    const { skill, rules } = installed(signedLicense({ licensee: NAME, contact: EMAIL }));
    for (const text of [skill, rules]) {
      assert.match(text, /Provenance: License=LIC-2026-000123;/);
      assert.equal(text.includes(NAME), false);
      assert.equal(text.includes(EMAIL), false);
    }
  });

  test('the watermark writes only safe characters, whatever id it is given', () => {
    const mark = generateCanaryWatermark('LIC-1 --> <b>\n\r"x"/SEAT_2', 'qa-security');
    assert.equal(mark.indexOf('-->'), mark.length - 3, 'only the closing --> of the comment');
    assert.equal(/[\n\r<">]/.test(mark.slice(4, -3)), false);
    // each unsafe character becomes '_': ' ', '>', '<', newline, carriage return, quote
    assert.match(mark, /License=LIC-1_--___b____x_\/SEAT_2;/);
  });
});
