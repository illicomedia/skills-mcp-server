import * as path from 'node:path';
import { generateCanaryWatermark, PRICING_URL, validateLicense } from '../license/license.js';
import {
  isSymbolicLink,
  makeDirInside,
  unlinkInside,
  validateSafeProjectPath,
  validateSafeWriteTarget,
  writeTextInside,
} from '../security/path-guard.js';
import type { LicenseValidationResult, SkillTier } from '../types.js';
import { findSkill, loadSkillContent, loadSkillLicense } from './catalog.js';

export interface InstallSkillResult {
  success: boolean;
  skillId: string;
  skillName?: string;
  tier?: SkillTier;
  installedFiles: string[];
  targetDirectory?: string;
  message: string;
  requiresAuth?: boolean;
  requiredTier?: SkillTier;
  promptRecommendation?: string;
  previewOnly?: boolean;
  requiresConfirmation?: boolean;
}

export interface InstallSkillOptions {
  confirm?: boolean;
}

/**
 * Installs a specific skill into the workspace .agents/skills/<id>/ folder.
 * Enforces authentication and active entitlement for Pro and Enterprise skills.
 * Requires explicit confirm: true to perform disk writes (safe preview by default).
 */
export function installSkill(
  skillId: string,
  projectPath: string = process.cwd(),
  licenseOverride?: LicenseValidationResult,
  options?: InstallSkillOptions,
): InstallSkillResult {
  let safeProjectPath: string;
  try {
    safeProjectPath = validateSafeProjectPath(projectPath, 'install_skill');
  } catch (err) {
    return {
      success: false,
      skillId,
      installedFiles: [],
      message: `Failed to install skill '${skillId}': ${(err as Error).message}`,
    };
  }

  const meta = findSkill(skillId);
  if (!meta) {
    return {
      success: false,
      skillId,
      installedFiles: [],
      message: `Unknown skill '${skillId}'. Use 'list_skills' to view all available skills in the catalog.`,
    };
  }

  const license = licenseOverride || validateLicense(undefined, { projectRoot: safeProjectPath });

  // Authentication & Entitlement Gate for Paid Skills
  if (meta.tier === 'pro' && license.tier !== 'pro' && license.tier !== 'enterprise') {
    return {
      success: false,
      skillId,
      skillName: meta.name,
      tier: meta.tier,
      installedFiles: [],
      requiresAuth: true,
      requiredTier: 'pro',
      message:
        `Authentication required: '${skillId}' (${meta.name}) is a Pro Production skill.\n` +
        `Current active tier: ${license.tier.toUpperCase()}.\n` +
        `To install, provide a signed Pro or Enterprise license file via the 'set_license_key' tool or at ~/.config/fredo-qa/license.json.\n` +
        `Purchase or manage licenses at: ${PRICING_URL}`,
    };
  }

  if (meta.tier === 'enterprise' && license.tier !== 'enterprise') {
    return {
      success: false,
      skillId,
      skillName: meta.name,
      tier: meta.tier,
      installedFiles: [],
      requiresAuth: true,
      requiredTier: 'enterprise',
      message:
        `Authentication required: '${skillId}' (${meta.name}) is an Enterprise Assurance skill.\n` +
        `Current active tier: ${license.tier.toUpperCase()}.\n` +
        `To install, provide a signed Enterprise license file via the 'set_license_key' tool or at ~/.config/fredo-qa/license.json.\n` +
        `Contact enterprise licensing at: ${PRICING_URL}`,
    };
  }

  // Installation authorized
  const targetDir = path.join(safeProjectPath, '.agents', 'skills', skillId);
  try {
    validateSafeWriteTarget(safeProjectPath, targetDir);
  } catch (err) {
    return {
      success: false,
      skillId,
      installedFiles: [],
      message: `Failed to install skill '${skillId}': ${(err as Error).message}`,
    };
  }
  const skillFilePath = path.join(targetDir, 'SKILL.md');
  const licenseFilePath = path.join(targetDir, 'LICENSE');

  // Resolve the skill source before any preview or write, so a missing skill never
  // leaves an empty directory or a synthesized SKILL.md behind.
  let rawSkillContent: string;
  try {
    rawSkillContent = loadSkillContent(skillId, projectPath);
  } catch (err) {
    return {
      success: false,
      skillId,
      installedFiles: [],
      message: `Failed to install skill '${skillId}': ${(err as Error).message}`,
    };
  }

  if (!options?.confirm) {
    return {
      success: true,
      skillId,
      skillName: meta.name,
      tier: meta.tier,
      installedFiles: [],
      targetDirectory: targetDir,
      previewOnly: true,
      requiresConfirmation: true,
      message:
        `[PREVIEW ONLY - 0 files written to disk]\n` +
        `Skill '${skillId}' (${meta.name}) is prepared for installation under ${meta.tier.toUpperCase()} tier.\n` +
        `Target directory: ${targetDir}\n` +
        `Files planned:\n` +
        `  - ${skillFilePath} (declarative quality directives & HMAC provenance watermark)\n` +
        `  - ${licenseFilePath} (${meta.tier.toUpperCase()} legal notice)\n\n` +
        `⚠️ USER CONFIRMATION REQUIRED: Ask the developer for explicit confirmation in chat before modifying workspace files.\n` +
        `Call 'install_skill' with 'confirm: true' only after the developer explicitly approves.`,
      promptRecommendation: `Ask developer: "Would you like me to install '${meta.name}' (${skillId}) into .agents/skills/${skillId}/?"`,
    };
  }

  try {
    try {
      if (isSymbolicLink(targetDir)) {
        unlinkInside(safeProjectPath, targetDir);
      }
    } catch {
      // Not an existing file or symlink
    }
    makeDirInside(safeProjectPath, targetDir);

    const skillContent =
      meta.tier === 'free'
        ? rawSkillContent
        : `${generateCanaryWatermark(license.customerName || 'pro_subscriber', skillId)}\n\n${rawSkillContent}`;

    const licenseContent = loadSkillLicense(skillId, license, projectPath);

    writeTextInside(safeProjectPath, skillFilePath, skillContent);
    writeTextInside(safeProjectPath, licenseFilePath, licenseContent);

    return {
      success: true,
      skillId,
      skillName: meta.name,
      tier: meta.tier,
      installedFiles: [skillFilePath, licenseFilePath],
      targetDirectory: targetDir,
      message: `Skill '${skillId}' (${meta.name}) successfully installed under ${meta.tier.toUpperCase()} tier with valid LICENSE.`,
      promptRecommendation: `Apply the quality gates in .agents/skills/${skillId}/SKILL.md to this codebase and verify compliance.`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      skillId,
      installedFiles: [],
      message: `Failed to install skill '${skillId}': ${(err as Error).message}`,
    };
  }
}
