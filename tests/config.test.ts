// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCTION_API_ENDPOINT, resolveApiEndpoint } from '../dist/config.js';

test('the default is the versioned production API', () => {
  assert.equal(PRODUCTION_API_ENDPOINT, 'https://www.illicomedia.com/api/v1');
  assert.equal(resolveApiEndpoint(undefined), PRODUCTION_API_ENDPOINT);
  assert.equal(resolveApiEndpoint('  '), PRODUCTION_API_ENDPOINT);
});

test('an HTTPS override is used, without its trailing slash', () => {
  assert.equal(resolveApiEndpoint('https://api.example.com/v1/'), 'https://api.example.com/v1');
});

test('plain HTTP is refused everywhere', () => {
  assert.equal(resolveApiEndpoint('http://evil.example/api'), PRODUCTION_API_ENDPOINT);
  assert.equal(resolveApiEndpoint('http://localhost:8080/api/v1'), PRODUCTION_API_ENDPOINT);
});

test('anything else keeps the default', () => {
  assert.equal(resolveApiEndpoint('not a url'), PRODUCTION_API_ENDPOINT);
  assert.equal(resolveApiEndpoint('ftp://example.com'), PRODUCTION_API_ENDPOINT);
});
