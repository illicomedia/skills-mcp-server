/**
 * Ed25519 public keys (SPKI PEM) accepted for license files, indexed by key id.
 * Only public keys may appear here: signing keys stay in the license-issuing service.
 * While this map is empty, no paid license verifies and the server runs in free mode.
 */
export const TRUSTED_LICENSE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'fredo-qa-2026-10': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAPrQoO+oWLJAO81k/6uR0tRZGsDVmkvrc6CCHzO1YfpU=
-----END PUBLIC KEY-----`,
});

/**
 * Release date of this build. A license unlocks this build only when its
 * `updates_until` is on or after this date (version retention).
 */
export const SERVER_RELEASE_DATE = '2026-10-23T00:00:00Z';
