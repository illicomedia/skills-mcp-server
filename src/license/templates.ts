import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LicenseValidationResult, SkillMetadata } from '../types.js';

export const DEFAULT_MIT_LICENSE = `MIT License

Copyright (c) 2026 Frédéric Charles Viallet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export function getCommercialLicenseText(
  meta: SkillMetadata,
  license: LicenseValidationResult,
): string {
  return `Fredo QA Commercial Skills License
SPDX identifier: LicenseRef-Fredo-QA-Commercial

Copyright (c) 2026 Frédéric Charles Viallet. All rights reserved.

Licensee: ${license.customerName || 'Licensed Organization'}
License Tier: ${meta.tier.toUpperCase()}
License: ${license.licenseId || 'unknown'} (Ed25519 signature verified)
Updates Until: ${license.updatesUntil || 'unknown'}
Authorized by: Frédéric Charles Viallet (www.illicomedia.com/qa-skills/)

This skill is paid, proprietary material licensed to the licensee named above for its own
development work, including work for its clients, by the people working for it on its projects,
with no limit on their number. Without separate written
permission, the licensee must not copy it (other than installation and backup copies),
distribute, publish, share, sell, rent or sublicense it, create derivative works of it for use
outside this license, share the license file, or remove copyright and provenance notices.
Results the licensee produces with the skill belong to the licensee. Termination for breach
ends the license, and non-payment ends the subscription. Provided "as is" to the extent
permitted by law; governed by French law. Full terms: the LICENSE file of the skill and
https://www.illicomedia.com/qa-skills/. The terms of sale accepted with the order prevail.`;
}

/**
 * Loads or generates a compliant LICENSE file for a skill
 */
export function resolveSkillLicense(
  meta: SkillMetadata,
  license: LicenseValidationResult,
  searchDir?: string,
): string {
  const base = searchDir ?? process.cwd();
  const candidatePaths = [
    path.join(base, 'skills', 'free', meta.id, 'LICENSE'),
    path.join(base, 'skills', 'pro', meta.id, 'LICENSE'),
    path.join(base, 'skills', 'pro', 'LICENSE'),
    path.join(base, 'skills', 'enterprise', meta.id, 'LICENSE'),
    path.join(base, 'skills', 'enterprise', 'LICENSE'),
    path.join(base, 'skills', meta.id, 'LICENSE'),
    path.join(base, 'LICENSE'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf-8').trim();
        if (content.length > 0) {
          if (meta.tier === 'free') {
            return content;
          }
          return `${content}\n\n---\nCOMMERCIAL LICENSE ACTIVATION\nLicensee: ${license.customerName || 'Licensed Organization'}\nLicense Tier: ${meta.tier.toUpperCase()}\nLicense: ${license.licenseId || 'unknown'} (Ed25519 signature verified)\nUpdates Until: ${license.updatesUntil || 'unknown'}\nAuthorized by: Frédéric Charles Viallet (www.illicomedia.com/qa-skills/)`;
        }
      } catch {
        // Fallback
      }
    }
  }

  return meta.tier === 'free' ? DEFAULT_MIT_LICENSE : getCommercialLicenseText(meta, license);
}
