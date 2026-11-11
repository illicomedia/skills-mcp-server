import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FredoQaMcpServer } from '../../dist/server/server.js';
import { TEST_LICENSE_OPTIONS } from '../helpers/license-fixture.ts';
import { callToolText } from '../helpers/mcp-fixture.ts';

describe('server › get-version', () => {
  const info = (): Record<string, unknown> =>
    JSON.parse(callToolText(new FredoQaMcpServer(undefined, TEST_LICENSE_OPTIONS), 'get_version'));

  test('get_version: gives the absolute URL of the website to go to in case of a problem', () => {
    const helpUrl = info().helpUrl;
    assert.equal(helpUrl, 'https://www.illicomedia.com/qa-skills/');
    const url = new URL(String(helpUrl));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.host, 'www.illicomedia.com');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  });

  test('get_version: the help URL carries nothing about the user, the license or the version', () => {
    const helpUrl = String(info().helpUrl);
    for (const leak of ['?', '#', 'mcp_v', 'license', 'LIC-', '@']) {
      assert.equal(helpUrl.includes(leak), false, leak);
    }
  });

  test('get_version: every key of earlier versions is still there with its type (additive only)', () => {
    const data = info();
    for (const [key, type] of [
      ['version', 'string'],
      ['package', 'string'],
      ['protocolVersion', 'string'],
      ['supportedProtocolVersions', 'object'],
      ['nodeVersion', 'string'],
      ['skillsCount', 'number'],
      ['licenseTier', 'string'],
    ] as const) {
      assert.equal(typeof data[key], type, key);
    }
  });
});
