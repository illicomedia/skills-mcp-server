import { runComplianceAudit } from './audit.js';
import { SKILLS_CATALOG, getAvailableSkills, loadSkillContent } from './catalog.js';
import { installSkill, syncWorkspaceSkills } from './installer.js';
import { generateCanaryWatermark, validateLicenseKey } from './license.js';
import type { LicenseValidationResult } from './types.js';

export class ToolExecutor {
  public static execute(
    name: string,
    args: Record<string, unknown>,
    activeLicenseKey: string | undefined,
    onLicenseUpdate: (key: string) => void,
  ): string {
    if (args.license_key && typeof args.license_key === 'string') {
      onLicenseUpdate(args.license_key.trim());
      activeLicenseKey = args.license_key.trim();
    }
    const license = validateLicenseKey(activeLicenseKey);

    switch (name) {
      case 'set_license_key': {
        const key = (args.license_key as string)?.trim();
        onLicenseUpdate(key);
        const updatedLicense = validateLicenseKey(key);
        return JSON.stringify(
          {
            status: updatedLicense.valid ? 'AUTHENTICATED' : 'FREE_TIER_FALLBACK',
            tier: updatedLicense.tier.toUpperCase(),
            customer: updatedLicense.customerName || 'Community User',
            expiresAt: updatedLicense.expiresAt || 'Never (Free Tier)',
            valid: updatedLicense.valid,
            message: updatedLicense.message,
          },
          null,
          2,
        );
      }

      case 'verify_license': {
        const targetLicense: LicenseValidationResult = args.license_key
          ? validateLicenseKey(args.license_key as string)
          : license;
        return JSON.stringify(
          {
            status: targetLicense.valid
              ? 'ACTIVE'
              : targetLicense.isExpired
                ? 'EXPIRED'
                : 'FREE_TIER',
            tier: targetLicense.tier.toUpperCase(),
            customer: targetLicense.customerName || 'Community User',
            expiresAt: targetLicense.expiresAt || 'Never (Free Tier)',
            fallbackMode: targetLicense.fallbackMode,
            message: targetLicense.message,
            portal: 'https://skills.illicomedia.com/pricing',
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
          ? `\n> [!NOTE] Running on Free Foundation tier (${freeCount} MIT skills). Upgrade to Pro or Enterprise at https://skills.illicomedia.com/pricing to unlock all ${totalCount} skills.\n`
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
          return `# Access Restricted: ${skillId}\nThis skill is a commercial package requiring an active Pro or Enterprise license.\nCurrent tier: **${license.tier.toUpperCase()}**\n\n${license.message}\n\nTo unlock this skill or activate an API key, use 'set_license_key' or visit:\nhttps://skills.illicomedia.com/pricing`;
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
