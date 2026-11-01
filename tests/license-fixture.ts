import * as crypto from 'node:crypto';
import {
  LICENSE_SCHEMA_URL,
  LICENSE_SCHEMA_VERSION,
  canonicalJson,
  type LicenseOptions,
} from '../dist/license/license.js';

export const TEST_KEY_ID = 'test-key-1';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

export const TEST_LICENSE_OPTIONS: LicenseOptions = {
  trustedKeys: {
    [TEST_KEY_ID]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  },
  releaseDate: '2026-10-07T00:00:00Z',
  env: {},
  homeDir: '/nonexistent-home',
  projectRoot: '/nonexistent-project',
};

export function licenseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: LICENSE_SCHEMA_URL,
    schema_version: LICENSE_SCHEMA_VERSION,
    license_id: 'LIC-2026-000123',
    licensee: 'Fred V.',
    contact: 'tests@illicomedia.com',
    tier: 'pro',
    seats: 10,
    issued_at: '2026-10-01T00:00:00Z',
    updates_until: '2027-10-01T00:00:00Z',
    binding: { kind: 'none' },
    key_id: TEST_KEY_ID,
    ...overrides,
  };
}

export function signLicense(
  body: Record<string, unknown>,
  key: crypto.KeyObject = privateKey,
): string {
  const signature = crypto.sign(null, Buffer.from(canonicalJson(body), 'utf8'), key);
  return JSON.stringify({ ...body, signature: signature.toString('base64') });
}

export function signedLicense(overrides: Record<string, unknown> = {}): string {
  return signLicense(licenseBody(overrides));
}
