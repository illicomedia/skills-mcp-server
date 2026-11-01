import { runComplianceAudit } from '../audit/index.js';
import {
  generateCanaryWatermark,
  type LicenseOptions,
  PRICING_URL,
  PROJECT_LICENSE_FILE,
  validateLicense,
} from '../license/license.js';
import { getAvailableSkills, loadSkillContent, SKILLS_CATALOG } from '../skills/catalog.js';
import { installSkill, pruneSkills, syncWorkspaceSkills } from '../skills/installer.js';
import type { LicenseValidationResult } from '../types.js';
import { SERVER_VERSION } from '../version.js';

type ToolArguments = Record<string, unknown>;

function projectPathOf(args: ToolArguments): string {
  return (args.project_path as string) || process.cwd();
}

function setLicenseKey(
  args: ToolArguments,
  onLicenseUpdate: (key: string) => void,
  licenseOptions: LicenseOptions,
): string {
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

function verifyLicense(
  args: ToolArguments,
  license: LicenseValidationResult,
  licenseOptions: LicenseOptions,
): string {
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

function listSkills(args: ToolArguments, license: LicenseValidationResult): string {
  const accessibleIds = new Set(getAvailableSkills(license.tier).map((s) => s.id));
  const categoryFilter = args.category as string | undefined;
  const listed = categoryFilter
    ? SKILLS_CATALOG.filter((s) => s.category === categoryFilter)
    : SKILLS_CATALOG;
  const accessibleCount = listed.filter((s) => accessibleIds.has(s.id)).length;

  const advisory =
    accessibleCount < listed.length
      ? `\n> [!NOTE] ${license.message}\n> Skills marked 🔒 require a signed Pro or Enterprise license file (${PROJECT_LICENSE_FILE}). Plans: ${PRICING_URL}\n`
      : '';

  const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const rows = listed.map((s) => {
    const access = accessibleIds.has(s.id)
      ? '✅ Available'
      : `🔒 Requires ${s.tier === 'enterprise' ? 'Enterprise' : 'Pro'} license`;
    return `| \`${s.id}\` | ${s.tier.toUpperCase()} | ${access} | ${s.category} | ${cell(s.name)}: ${cell(s.description)} |`;
  });
  const table = [
    '| Skill | Tier | Access | Category | Description |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');

  return `# Fredo QA Skills catalog (${accessibleCount} accessible under ${license.tier.toUpperCase()} plan, ${listed.length} listed)\n${advisory}\n${table}`;
}

function getSkillRules(args: ToolArguments, license: LicenseValidationResult): string {
  const skillId = args.skill_id as string;
  const skills = getAvailableSkills(license.tier);
  const skill = skills.find((s) => s.id === skillId);

  if (!skill) {
    return `# Access Restricted: ${skillId}\nThis skill is a commercial package requiring an active Pro or Enterprise license.\nCurrent tier: **${license.tier.toUpperCase()}**\n\n${license.message}\n\nTo unlock this skill, provide a signed license file with 'set_license_key' or visit:\nhttps://www.illicomedia.com/qa-skills/pricing`;
  }

  const content = loadSkillContent(skillId);
  const watermark = generateCanaryWatermark(license.customerName || 'community_user', skillId);

  return `${watermark}\n\n${content}`;
}

function getVersion(license: LicenseValidationResult): string {
  return JSON.stringify(
    {
      version: SERVER_VERSION,
      package: '@illicomedia/skills-mcp-server',
      protocolVersion: '2024-11-05',
      nodeVersion: process.version,
      skillsCount: SKILLS_CATALOG.length,
      licenseTier: license.tier.toUpperCase(),
    },
    null,
    2,
  );
}

export const ToolExecutor = {
  execute(
    name: string,
    args: ToolArguments,
    activeLicenseKey: string | undefined,
    onLicenseUpdate: (key: string) => void,
    licenseOptions: LicenseOptions = {},
  ): string {
    const providedKey = typeof args.license_key === 'string' ? args.license_key.trim() : '';
    if (providedKey) {
      onLicenseUpdate(providedKey);
    }
    const license = validateLicense(providedKey || activeLicenseKey, licenseOptions);
    const confirm = Boolean(args.confirm);

    switch (name) {
      case 'set_license_key':
        return setLicenseKey(args, onLicenseUpdate, licenseOptions);
      case 'verify_license':
        return verifyLicense(args, license, licenseOptions);
      case 'list_skills':
        return listSkills(args, license);
      case 'get_skill_rules':
        return getSkillRules(args, license);
      case 'install_skill':
        return JSON.stringify(
          installSkill(args.skill_id as string, projectPathOf(args), license, { confirm }),
          null,
          2,
        );
      case 'sync_workspace_skills':
        return syncWorkspaceSkills(
          projectPathOf(args),
          args.skills as string[] | undefined,
          license,
          {
            confirm,
          },
        ).summaryMessage;
      case 'prune_skills':
        return pruneSkills(projectPathOf(args), {
          confirm,
          keepSkills: args.keep_skills as string[] | undefined,
        }).summaryMessage;
      case 'quick_check':
        return JSON.stringify(runComplianceAudit(projectPathOf(args), { confirm }), null, 2);
      case 'get_version':
        return getVersion(license);
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  },
};
