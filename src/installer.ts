import * as fs from 'node:fs';
import * as path from 'node:path';
import { findSkill, loadSkillContent, loadSkillLicense } from './catalog.js';
import { generateCanaryWatermark, validateLicenseKey } from './license.js';
import type { LicenseValidationResult, SkillMetadata, SkillTier } from './types.js';

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
}

export interface SyncWorkspaceResult {
  projectPath: string;
  activeTier: SkillTier;
  installed: InstallSkillResult[];
  skippedUnauthorized: InstallSkillResult[];
  detectedSkills: string[];
  summaryMessage: string;
}

/**
 * Installs a specific skill into the workspace .agents/skills/<id>/ folder.
 * Enforces authentication and active entitlement for Pro and Enterprise skills.
 */
export function installSkill(
  skillId: string,
  projectPath: string = process.cwd(),
  licenseOverride?: LicenseValidationResult,
): InstallSkillResult {
  const meta = findSkill(skillId);
  if (!meta) {
    return {
      success: false,
      skillId,
      installedFiles: [],
      message: `Unknown skill '${skillId}'. Use 'list_skills' to view all available skills in the catalog.`,
    };
  }

  const license = licenseOverride || validateLicenseKey(undefined);

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
        `To install, provide a valid Pro or Enterprise license key via the 'set_license_key' tool or set FREDO_QA_LICENSE_KEY.\n` +
        `Purchase or manage licenses at: https://skills.illicomedia.com/pricing`,
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
        `To install, provide an Enterprise license key via the 'set_license_key' tool or set FREDO_QA_LICENSE_KEY.\n` +
        `Contact enterprise licensing at: https://skills.illicomedia.com/pricing`,
    };
  }

  // Installation authorized
  const targetDir = path.join(projectPath, '.agents', 'skills', skillId);
  fs.mkdirSync(targetDir, { recursive: true });

  const rawSkillContent = loadSkillContent(skillId, projectPath);
  const skillContent =
    meta.tier !== 'free'
      ? `${generateCanaryWatermark(license.customerName || 'pro_subscriber', skillId)}\n\n${rawSkillContent}`
      : rawSkillContent;

  const licenseContent = loadSkillLicense(skillId, license, projectPath);

  const skillFilePath = path.join(targetDir, 'SKILL.md');
  const licenseFilePath = path.join(targetDir, 'LICENSE');

  fs.writeFileSync(skillFilePath, skillContent, 'utf-8');
  fs.writeFileSync(licenseFilePath, licenseContent, 'utf-8');

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
}

/**
 * Detects relevant skills by inspecting workspace files and indicators
 */
export function detectProjectSkills(projectPath: string = process.cwd()): string[] {
  const detected = new Set<string>(['qa-core', 'dev-flow']);

  const fileExists = (rel: string) => fs.existsSync(path.join(projectPath, rel));
  const fileContains = (rel: string, query: string) => {
    try {
      const p = path.join(projectPath, rel);
      return fs.existsSync(p) && fs.readFileSync(p, 'utf-8').includes(query);
    } catch {
      return false;
    }
  };

  // Language & Framework Detection
  if (fileExists('package.json') || fileExists('tsconfig.json')) {
    detected.add('qa-javascript-typescript');
  }
  if (fileContains('package.json', '@modelcontextprotocol') || fileExists('mcp.json')) {
    detected.add('qa-mcp');
  }
  if (
    fileExists('pyproject.toml') ||
    fileExists('requirements.txt') ||
    fileExists('setup.py') ||
    fileExists('Pipfile')
  ) {
    detected.add('qa-python');
  }
  if (fileExists('Cargo.toml')) {
    detected.add('qa-rust');
  }
  if (fileExists('go.mod')) {
    detected.add('qa-go');
  }
  if (fileExists('pom.xml') || fileExists('build.gradle') || fileExists('build.gradle.kts')) {
    detected.add('qa-java');
  }
  if (
    fileExists('CMakeLists.txt') ||
    fileExists('Makefile') ||
    fileExists('compile_commands.json')
  ) {
    detected.add('qa-c-cpp');
  }
  if (fileExists('composer.json')) {
    detected.add('qa-php');
  }

  // Shell detection
  try {
    const files = fs.readdirSync(projectPath);
    if (files.some((f) => f.endsWith('.sh') || f === 'scripts')) {
      detected.add('qa-bash');
    }
  } catch {
    // Ignore read errors
  }

  // DevOps & Security indicators
  if (fileExists('.github/workflows') || fileExists('Dockerfile') || fileExists('docker-compose.yml')) {
    detected.add('qa-devops');
    detected.add('qa-security');
  }

  return Array.from(detected);
}

/**
 * Synchronizes workspace skills: either auto-detects or installs an explicit list.
 * Respects license tiers and reports auth requirements clearly.
 */
export function syncWorkspaceSkills(
  projectPath: string = process.cwd(),
  requestedSkills?: string[],
  licenseOverride?: LicenseValidationResult,
): SyncWorkspaceResult {
  const license = licenseOverride || validateLicenseKey(undefined);
  const skillsToInstall =
    requestedSkills && requestedSkills.length > 0
      ? requestedSkills
      : detectProjectSkills(projectPath);

  const installed: InstallSkillResult[] = [];
  const skippedUnauthorized: InstallSkillResult[] = [];

  for (const id of skillsToInstall) {
    const res = installSkill(id, projectPath, license);
    if (res.success) {
      installed.push(res);
    } else {
      skippedUnauthorized.push(res);
    }
  }

  const installedList = installed.map((r) => `  - ✓ **\`${r.skillId}\`** [${r.tier?.toUpperCase()}]: ${r.skillName}`).join('\n');
  const skippedList = skippedUnauthorized
    .map(
      (r) =>
        `  - 🔒 **\`${r.skillId}\`** [${r.requiredTier?.toUpperCase()}]: Authentication required (Use 'set_license_key')`,
    )
    .join('\n');

  let summary = `# Fredo QA Skills Workspace Sync\n\n`;
  summary += `Target: \`${projectPath}\`\n`;
  summary += `Active Plan: **${license.tier.toUpperCase()}**\n\n`;

  if (installed.length > 0) {
    summary += `### Successfully Installed (${installed.length}):\n${installedList}\n\n`;
  }

  if (skippedUnauthorized.length > 0) {
    summary += `### Requires Authentication (${skippedUnauthorized.length}):\n${skippedList}\n\n`;
    summary += `> [!WARNING] To unlock commercial skills, activate your license with the \`set_license_key\` tool.\n`;
    summary += `> Purchase or manage licenses: https://skills.illicomedia.com/pricing\n\n`;
  }

  summary += `### Next Steps for AI Agent:\n`;
  summary += `- Reference installed skills from \`.agents/skills/<skill_id>/SKILL.md\`\n`;
  summary += `- Run relevant inner loop checks before commits\n`;

  return {
    projectPath,
    activeTier: license.tier,
    installed,
    skippedUnauthorized,
    detectedSkills: skillsToInstall,
    summaryMessage: summary,
  };
}
