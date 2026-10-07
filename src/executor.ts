// SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet
// SPDX-License-Identifier: MIT
import { runComplianceAudit } from './audit.js';
import { SKILLS_CATALOG, getAvailableSkills, loadSkillContent } from './catalog.js';
import { installSkill, syncWorkspaceSkills } from './installer.js';
import { type LicenseOptions, generateCanaryWatermark, validateLicense } from './license.js';
import type { LicenseValidationResult } from './types.js';

export class ToolExecutor {
  public static execute(
    name: string,
    args: Record<string, unknown>,
    activeLicenseKey: string | undefined,
    onLicenseUpdate: (key: string) => void,
    licenseOptions: LicenseOptions = {},
  ): string {
    if (args.license_key && typeof args.license_key === 'string') {
      onLicenseUpdate(args.license_key.trim());
      activeLicenseKey = args.license_key.trim();
    }
    const license = validateLicense(activeLicenseKey, licenseOptions);

    switch (name) {
      case 'set_license_key': {
        const key = (args.license_key as string)?.trim();
        onLicenseUpdate(key);
        const updatedLicense = validateLicense(key, licenseOptions);
        return JSON.stringify(
          {
            status: updatedLicense.valid ? 'AUTHENTICATED' : 'FREE_TIER_FALLBACK',
            tier: updatedLicense.tier.toUpperCase(),
            customer: updatedLicense.customerName || 'Community User',
            licenseId: updatedLicense.licenseId ?? null,
            updatesUntil: updatedLicense.updatesUntil ?? null,
            valid: updatedLicense.valid,
            message: updatedLicense.message,
          },
          null,
          2,
        );
      }

      case 'verify_license': {
        const targetLicense: LicenseValidationResult = args.license_key
          ? validateLicense(args.license_key as string, licenseOptions)
          : license;
        return JSON.stringify(
          {
            status: targetLicense.valid
              ? 'ACTIVE'
              : targetLicense.isExpired
                ? 'UPDATES_ENDED'
                : 'FREE_TIER',
            tier: targetLicense.tier.toUpperCase(),
            customer: targetLicense.customerName || 'Community User',
            licenseId: targetLicense.licenseId ?? null,
            updatesUntil: targetLicense.updatesUntil ?? null,
            fallbackMode: targetLicense.fallbackMode,
            message: targetLicense.message,
            portal: 'https://www.illicomedia.com/qa-skills/pricing',
          },
          null,
          2,
        );
      }

      case 'list_skills': {
        const skills = getAvailableSkills(license.tier);
        const categoryFilter = args.category as string | undefined;
        const filtered = categoryFilter
          ? skills.filter((s) => s.category === categoryFilter)
          : skills;

        const freeCount = SKILLS_CATALOG.filter((s) => s.tier === 'free').length;
        const totalCount = SKILLS_CATALOG.length;
        const advisory = license.fallbackMode
          ? `\n> [!NOTE] Running on Free Foundation tier (${freeCount} MIT skills). Upgrade to Pro or Enterprise at https://www.illicomedia.com/qa-skills/pricing to unlock all ${totalCount} skills.\n`
          : '';

        const list = filtered
          .map(
            (s) =>
              `- **\`${s.id}\`** [${s.tier.toUpperCase()}] (${s.name}): ${s.description}\n  *Key Gates:* ${s.rulesSummary.join(', ')}`,
          )
          .join('\n');

        return `# Available Fredo QA Skills (${filtered.length} accessible under ${license.tier.toUpperCase()} plan)\n${advisory}\n${list}`;
      }

      case 'get_skill_rules': {
        const skillId = args.skill_id as string;
        const skills = getAvailableSkills(license.tier);
        const skill = skills.find((s) => s.id === skillId);

        if (!skill) {
          return `# Access Restricted: ${skillId}\nThis skill is a commercial package requiring an active Pro or Enterprise license.\nCurrent tier: **${license.tier.toUpperCase()}**\n\n${license.message}\n\nTo unlock this skill, provide a signed license file with 'set_license_key' or visit:\nhttps://www.illicomedia.com/qa-skills/pricing`;
        }

        const content = loadSkillContent(skillId);
        const watermark = generateCanaryWatermark(
          license.customerName || 'community_user',
          skillId,
        );

        return `${watermark}\n\n${content}`;
      }

      case 'install_skill': {
        const skillId = args.skill_id as string;
        const projectPath = (args.project_path as string) || process.cwd();
        const res = installSkill(skillId, projectPath, license);
        return JSON.stringify(res, null, 2);
      }

      case 'sync_workspace_skills': {
        const projectPath = (args.project_path as string) || process.cwd();
        const requestedSkills = args.skills as string[] | undefined;
        const res = syncWorkspaceSkills(projectPath, requestedSkills, license);
        return res.summaryMessage;
      }

      case 'audit_compliance': {
        const projectPath = (args.project_path as string) || process.cwd();
        const report = runComplianceAudit(projectPath);
        return JSON.stringify(report, null, 2);
      }

      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }
}
