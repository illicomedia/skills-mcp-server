import { PRICING_URL, validateLicense } from '../license/license.js';
import { validateSafeProjectPath } from '../security/path-guard.js';
import type { LicenseValidationResult, SkillTier } from '../types.js';
import { type InstallSkillResult, installSkill } from './installer.js';
import { detectProjectSkills } from './stack-detection.js';

export interface SyncWorkspaceOptions {
  confirm?: boolean;
}

export interface SyncWorkspaceResult {
  projectPath: string;
  activeTier: SkillTier;
  installed: InstallSkillResult[];
  skippedUnauthorized: InstallSkillResult[];
  /** Skills that could not be installed for another reason (e.g. no SKILL.md available). */
  failed: InstallSkillResult[];
  detectedSkills: string[];
  summaryMessage: string;
}

/**
 * Synchronizes workspace skills: either auto-detects or installs an explicit list.
 * Respects license tiers and reports auth requirements clearly.
 * Requires explicit confirm: true to perform disk writes (safe preview by default).
 */
export function syncWorkspaceSkills(
  projectPath: string = process.cwd(),
  requestedSkills?: string[],
  licenseOverride?: LicenseValidationResult,
  options?: SyncWorkspaceOptions,
): SyncWorkspaceResult {
  const safeProjectPath = validateSafeProjectPath(projectPath, 'sync_workspace_skills');
  const license = licenseOverride || validateLicense(undefined, { projectRoot: safeProjectPath });
  const isConfirmed = Boolean(options?.confirm);
  const skillsToInstall =
    requestedSkills && requestedSkills.length > 0
      ? requestedSkills
      : detectProjectSkills(safeProjectPath);

  const installed: InstallSkillResult[] = [];
  const skippedUnauthorized: InstallSkillResult[] = [];
  const failed: InstallSkillResult[] = [];

  for (const id of skillsToInstall) {
    const res = installSkill(id, safeProjectPath, license, { confirm: isConfirmed });
    if (res.success) {
      installed.push(res);
    } else if (res.requiresAuth) {
      skippedUnauthorized.push(res);
    } else {
      failed.push(res);
    }
  }

  const installedList = installed
    .map(
      (r) =>
        `  - ${isConfirmed ? '✓' : '📋'} **\`${r.skillId}\`** [${String(r.tier).toUpperCase()}]: ${r.skillName}`,
    )
    .join('\n');
  const skippedList = skippedUnauthorized
    .map(
      (r) =>
        `  - 🔒 **\`${r.skillId}\`** [${String(r.requiredTier).toUpperCase()}]: Authentication required (Use 'set_license_key')`,
    )
    .join('\n');
  const failedList = failed.map((r) => `  - ✗ **\`${r.skillId}\`**: ${r.message}`).join('\n');
  const failedSection =
    failed.length > 0 ? `### Not Installed (${failed.length}):\n${failedList}\n\n` : '';

  let summary = '';
  if (isConfirmed) {
    summary = `# Fredo QA Skills Workspace Sync\n\n`;
    summary += `Target: \`${safeProjectPath}\`\n`;
    summary += `Active Plan: **${license.tier.toUpperCase()}**\n\n`;

    if (installed.length > 0) {
      summary += `### Successfully Installed (${installed.length}):\n${installedList}\n\n`;
    }

    if (skippedUnauthorized.length > 0) {
      summary += `### Requires Authentication (${skippedUnauthorized.length}):\n${skippedList}\n\n`;
      summary += `> [!WARNING] To unlock commercial skills, activate your license with the \`set_license_key\` tool.\n`;
      summary += `> Purchase or manage licenses: ${PRICING_URL}\n\n`;
    }

    summary += failedSection;
    summary += `### Next Steps for AI Agent:\n`;
    summary += `- Reference installed skills from \`.agents/skills/<skill_id>/SKILL.md\`\n`;
    summary += `- Run relevant inner loop checks before commits\n`;
  } else {
    summary = `# [DRY-RUN PREVIEW] Fredo QA Skills Workspace Sync\n\n`;
    summary += `> [!IMPORTANT] **0 files written to disk**. User agreement is required before modifying workspace files.\n\n`;
    summary += `Target: \`${safeProjectPath}\`\n`;
    summary += `Active Plan: **${license.tier.toUpperCase()}**\n\n`;

    if (installed.length > 0) {
      summary += `### Skills Ready to Install (${installed.length}):\n${installedList}\n\n`;
    }

    if (skippedUnauthorized.length > 0) {
      summary += `### Requires Authentication (${skippedUnauthorized.length}):\n${skippedList}\n\n`;
      summary += `> [!WARNING] To unlock commercial skills, activate your license with the \`set_license_key\` tool.\n`;
      summary += `> Purchase or manage licenses: ${PRICING_URL}\n\n`;
    }

    summary += failedSection;
    summary += `### Next Steps for AI Agent:\n`;
    summary += `1. Ask the developer for explicit confirmation in the chat: "I detected the following QA skills for this repository (${installed.map((s) => s.skillId).join(', ')}). Would you like me to install them into .agents/skills/?"\n`;
    summary += `2. Re-run \`sync_workspace_skills\` with \`confirm: true\` only after receiving user approval.\n`;
  }

  return {
    projectPath: safeProjectPath,
    activeTier: license.tier,
    installed,
    skippedUnauthorized,
    failed,
    detectedSkills: skillsToInstall,
    summaryMessage: summary,
  };
}
