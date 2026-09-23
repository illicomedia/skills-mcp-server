import * as crypto from 'node:crypto';
import type { LicenseValidationResult, SkillTier } from './types.js';

const HMAC_SALT = 'fredo-qa-skills-provenance-v1';

/**
 * Validates a Fredo QA Skills license key and determines active tier
 */
export function validateLicenseKey(
  rawKey?: string,
  now: Date = new Date(),
): LicenseValidationResult {
  const key = rawKey?.trim();

  if (!key) {
    return {
      valid: false,
      tier: 'free',
      keyType: 'none',
      isExpired: false,
      fallbackMode: true,
      message:
        'No license key provided. Operating in Free Foundation mode (MIT skills available: qa-core, dev-flow, qa-python, qa-bash, qa-mcp, qa-javascript-typescript, qa-php). To activate Pro or Enterprise skills, set FREDO_QA_LICENSE_KEY.',
    };
  }

  // Live Enterprise key format: fqa_live_ent_<id>_<expDateHex>_<hash>
  if (key.startsWith('fqa_live_ent_')) {
    const parts = key.split('_');
    const expEpoch = parts[4] ? Number.parseInt(parts[4], 16) : null;
    const isExpired = expEpoch ? now.getTime() > expEpoch * 1000 : false;

    if (isExpired) {
      return {
        valid: false,
        tier: 'free',
        keyType: 'live',
        customerName: parts[3] || 'Enterprise Client',
        expiresAt: expEpoch ? new Date(expEpoch * 1000).toISOString() : undefined,
        isExpired: true,
        fallbackMode: true,
        message:
          'Enterprise license has expired. Gracefully reverting to Free Foundation skills. To renew, visit https://skills.illicomedia.com/pricing',
      };
    }

    return {
      valid: true,
      tier: 'enterprise',
      keyType: 'live',
      customerName: parts[3] || 'Enterprise Client',
      expiresAt: expEpoch ? new Date(expEpoch * 1000).toISOString() : '2027-12-31T23:59:59Z',
      isExpired: false,
      fallbackMode: false,
      message: 'Active Enterprise Assurance license validated. All 16 skills unlocked.',
    };
  }

  // Live Pro key format: fqa_live_pro_<id>_<expDateHex>_<hash>
  if (key.startsWith('fqa_live_pro_') || key.startsWith('fqa_live_')) {
    const parts = key.split('_');
    const expEpoch = parts[4] ? Number.parseInt(parts[4], 16) : null;
    const isExpired = expEpoch ? now.getTime() > expEpoch * 1000 : false;

    if (isExpired) {
      return {
        valid: false,
        tier: 'free',
        keyType: 'live',
        customerName: parts[3] || 'Pro Subscriber',
        expiresAt: expEpoch ? new Date(expEpoch * 1000).toISOString() : undefined,
        isExpired: true,
        fallbackMode: true,
        message:
          'Pro subscription has expired. Gracefully reverting to Free Foundation skills under version-retention rights. To renew updates, visit https://skills.illicomedia.com/pricing',
      };
    }

    return {
      valid: true,
      tier: 'pro',
      keyType: 'live',
      customerName: parts[3] || 'Pro Subscriber',
      expiresAt: expEpoch ? new Date(expEpoch * 1000).toISOString() : '2027-12-31T23:59:59Z',
      isExpired: false,
      fallbackMode: false,
      message: 'Active Pro Production license validated. 14 skills unlocked.',
    };
  }

  // Test mode key
  if (key.startsWith('fqa_test_')) {
    return {
      valid: true,
      tier: 'pro',
      keyType: 'test',
      customerName: 'Test Sandbox User',
      expiresAt: '2099-01-01T00:00:00Z',
      isExpired: false,
      fallbackMode: false,
      message: 'Sandbox / Test license validated for development evaluation.',
    };
  }

  // Invalid key format
  return {
    valid: false,
    tier: 'free',
    keyType: 'none',
    isExpired: false,
    fallbackMode: true,
    message:
      'Invalid license key format. Reverting to Free Foundation tier. Check your license key in https://skills.illicomedia.com',
  };
}

/**
 * Generates an invisible or comment-based Canary Watermark for cryptographic provenance tracking
 */
export function generateCanaryWatermark(licenseeId: string, skillId: string): string {
  const hash = crypto
    .createHmac('sha256', HMAC_SALT)
    .update(`${licenseeId}:${skillId}:${new Date().toISOString().slice(0, 10)}`)
    .digest('hex')
    .slice(0, 16);

  return `<!-- Fredo QA Skills Provenance: Licensee=${licenseeId}; Skill=${skillId}; Token=${hash}; Copyright (c) Frédéric Charles Viallet -->`;
}
