import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { exists, readTextBounded } from '../security/path-guard.js';
import type { LicenseValidationResult } from '../types.js';
import { SERVER_RELEASE_DATE, TRUSTED_LICENSE_KEYS } from './keys.js';

const HMAC_SALT = 'fredo-qa-skills-provenance-v1';
export const PRICING_URL = 'https://www.illicomedia.com/qa-skills/pricing';
const MAX_LICENSE_BYTES = 64 * 1024;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const STRING_FIELDS = [
  'license_id',
  'licensee',
  'contact',
  'issued_at',
  'updates_until',
  'key_id',
  'signature',
] as const;
const ALLOWED_FIELDS = new Set<string>([
  ...STRING_FIELDS,
  'tier',
  'seats',
  'binding',
  'schema_version',
  '$schema',
]);

/** License file format version understood by this build (see LICENSE_SCHEMA_URL). */
export const LICENSE_SCHEMA_VERSION = 1;
export const LICENSE_SCHEMA_URL = 'https://www.illicomedia.com/schemas/qa-license-v1.schema.json';

export const USER_LICENSE_PATH = ['.config', 'fredo-qa', 'license.json'];
export const PROJECT_LICENSE_FILE = '.qa-license.json';

export interface LicenseOptions {
  trustedKeys?: Readonly<Record<string, string>>;
  releaseDate?: string;
  homeDir?: string;
  projectRoot?: string;
}

interface LicenseDocument {
  $schema?: string;
  schema_version: number;
  license_id: string;
  licensee: string;
  contact: string;
  tier: 'pro' | 'enterprise';
  seats: number;
  issued_at: string;
  updates_until: string;
  binding: { kind: string };
  key_id: string;
  signature: string;
}

/** Canonical JSON (RFC 8785 for the value types a license uses): sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

function freeTier(
  message: string,
  extra: Partial<LicenseValidationResult> = {},
): LicenseValidationResult {
  return {
    valid: false,
    tier: 'free',
    keyType: 'none',
    isExpired: false,
    fallbackMode: true,
    message,
    ...extra,
  };
}

function readLicenseFile(file: string): string {
  return readTextBounded(file, MAX_LICENSE_BYTES);
}

function discoverLicenseFile(options: LicenseOptions): string | undefined {
  // Fixed locations only: the server reads no environment variable (decision D17).
  const candidates = [
    path.join(options.homeDir ?? os.homedir(), ...USER_LICENSE_PATH),
    path.join(options.projectRoot ?? process.cwd(), PROJECT_LICENSE_FILE),
  ];
  return candidates.find((file): file is string => Boolean(file) && exists(file as string));
}

function parseLicense(text: string): LicenseDocument | string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return 'license file is not valid JSON';
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return 'license file must contain a JSON object';
  }
  const record = data as Record<string, unknown>;
  if (record.schema_version !== LICENSE_SCHEMA_VERSION) {
    return Number.isInteger(record.schema_version) &&
      (record.schema_version as number) > LICENSE_SCHEMA_VERSION
      ? `license format requires a newer MCP server (this build reads version ${LICENSE_SCHEMA_VERSION}); update the MCP server`
      : `license schema_version must be ${LICENSE_SCHEMA_VERSION}`;
  }
  if (record.$schema !== undefined && record.$schema !== LICENSE_SCHEMA_URL) {
    return `license $schema must be ${LICENSE_SCHEMA_URL}`;
  }
  // Messages never repeat what the file contains: the path can be any file the caller names.
  if (Object.keys(record).some((key) => !ALLOWED_FIELDS.has(key))) {
    return 'license contains a field that is not supported';
  }
  const missing = STRING_FIELDS.find(
    (field) => typeof record[field] !== 'string' || (record[field] as string).length === 0,
  );
  if (missing) {
    return `license field '${missing}' must be a non-empty string`;
  }
  if (record.tier !== 'pro' && record.tier !== 'enterprise') {
    return "license tier must be 'pro' or 'enterprise'";
  }
  if (!Number.isInteger(record.seats) || (record.seats as number) < 1) {
    return 'license seats must be a positive integer';
  }
  for (const field of ['issued_at', 'updates_until'] as const) {
    const value = record[field] as string;
    if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
      return `license field '${field}' must be an ISO-8601 UTC timestamp`;
    }
  }
  const binding = record.binding as Record<string, unknown> | undefined;
  if (!binding || typeof binding !== 'object' || binding.kind !== 'none') {
    return "license binding kind must be 'none' in this build";
  }
  return record as unknown as LicenseDocument;
}

function verifySignature(
  doc: LicenseDocument,
  trustedKeys: Readonly<Record<string, string>>,
): string | null {
  const pem = Object.hasOwn(trustedKeys, doc.key_id) ? trustedKeys[doc.key_id] : undefined;
  if (!pem) {
    return 'license key id is not trusted by this build';
  }
  if (!BASE64.test(doc.signature)) {
    return 'license signature is not valid base64';
  }
  const { signature, ...body } = doc;
  try {
    const publicKey = crypto.createPublicKey(pem);
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      return 'trusted license key is not an Ed25519 key';
    }
    const payload = Buffer.from(canonicalJson(body), 'utf8');
    if (crypto.verify(null, payload, publicKey, Buffer.from(signature, 'base64'))) {
      return null;
    }
  } catch {
    return 'license signature could not be verified';
  }
  return 'license signature does not match its content';
}

/**
 * Verifies an Ed25519-signed license file and returns the tier it unlocks for this build.
 * `source` is the license JSON itself or a path to it; when omitted, the license file is
 * discovered from ~/.config/fredo-qa/license.json, then
 * .qa-license.json at the project root. Any failure degrades to the free tier.
 */
export function validateLicense(
  source?: string,
  options: LicenseOptions = {},
): LicenseValidationResult {
  const trimmed = source?.trim();
  let text: string;
  try {
    if (trimmed?.startsWith('{')) {
      // The same cap as for a file, measured on what the caller sent (before trimming).
      if (Buffer.byteLength(source as string, 'utf8') > MAX_LICENSE_BYTES) {
        throw new Error(`file exceeds ${MAX_LICENSE_BYTES} bytes`);
      }
      text = trimmed;
    } else {
      const file = trimmed ? path.resolve(trimmed) : discoverLicenseFile(options);
      if (!file) {
        return freeTier(
          `No license file found. Free tier active: all MIT skills are available. To unlock Pro or Enterprise skills, place a signed license file at ~/.config/fredo-qa/license.json or ${PROJECT_LICENSE_FILE} in the project, or load it with the 'set_license_key' tool.`,
        );
      }
      text = readLicenseFile(file);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return freeTier(`License file could not be read (${reason}). Free tier active.`);
  }

  const doc = parseLicense(text);
  if (typeof doc === 'string') {
    return freeTier(`Invalid license: ${doc}. Free tier active.`);
  }
  const signatureError = verifySignature(doc, options.trustedKeys ?? TRUSTED_LICENSE_KEYS);
  if (signatureError) {
    return freeTier(`Invalid license: ${signatureError}. Free tier active.`);
  }

  const identity = {
    keyType: 'signed' as const,
    customerName: doc.licensee,
    licenseId: doc.license_id,
    updatesUntil: doc.updates_until,
  };
  const releaseDate = options.releaseDate ?? SERVER_RELEASE_DATE;
  if (Date.parse(releaseDate) > Date.parse(doc.updates_until)) {
    return freeTier(
      `License ${doc.license_id} covers releases up to ${doc.updates_until}; this build was released on ${releaseDate}. Free tier active. Earlier builds stay unlocked. To renew updates, visit ${PRICING_URL}`,
      { ...identity, isExpired: true },
    );
  }
  const scope = doc.tier === 'enterprise' ? 'Pro and Enterprise' : 'Pro';
  return {
    valid: true,
    tier: doc.tier,
    isExpired: false,
    fallbackMode: false,
    message: `Signed ${doc.tier} license ${doc.license_id} verified for ${doc.licensee}. ${scope} skills unlocked.`,
    ...identity,
  };
}

/**
 * Generates a comment-based canary watermark for provenance tracking of distributed skills.
 */
export function generateCanaryWatermark(licenseeId: string, skillId: string): string {
  const hash = crypto
    .createHmac('sha256', HMAC_SALT)
    .update(`${licenseeId}:${skillId}:${new Date().toISOString().slice(0, 10)}`)
    .digest('hex')
    .slice(0, 16);

  return `<!-- Fredo QA Skills Provenance: Licensee=${licenseeId}; Skill=${skillId}; Token=${hash}; Copyright (c) Frédéric Charles Viallet -->`;
}
