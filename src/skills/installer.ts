import * as fs from 'node:fs';
import * as path from 'node:path';
import { findSkill, loadSkillContent, loadSkillLicense } from './catalog.js';
import { generateCanaryWatermark, validateLicense } from '../license/license.js';
import { validateSafeProjectPath, validateSafeWriteTarget } from '../security/path-guard.js';
import type { LicenseValidationResult, SkillMetadata, SkillTier } from '../types.js';

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

export interface SyncWorkspaceOptions {
  confirm?: boolean;
}

export interface PruneSkillsOptions {
  confirm?: boolean;
  keepSkills?: string[];
  archiveDirName?: string;
}

export interface PruneSkillsResult {
  projectPath: string;
  success: boolean;
  previewOnly: boolean;
  requiresConfirmation: boolean;
  detectedSkills: string[];
  archivedSkills: string[];
  retainedSkills: string[];
  archiveDirectory: string;
  summaryMessage: string;
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
        `To install, provide a signed Pro or Enterprise license file via the 'set_license_key' tool or FREDO_QA_LICENSE_FILE.\n` +
        `Purchase or manage licenses at: https://www.illicomedia.com/qa-skills/pricing`,
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
        `To install, provide a signed Enterprise license file via the 'set_license_key' tool or FREDO_QA_LICENSE_FILE.\n` +
        `Contact enterprise licensing at: https://www.illicomedia.com/qa-skills/pricing`,
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
      const stat = fs.lstatSync(targetDir);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(targetDir);
      }
    } catch {
      // Not an existing file or symlink
    }
    fs.mkdirSync(targetDir, { recursive: true });

    const skillContent =
      meta.tier !== 'free'
        ? `${generateCanaryWatermark(license.customerName || 'pro_subscriber', skillId)}\n\n${rawSkillContent}`
        : rawSkillContent;

    const licenseContent = loadSkillLicense(skillId, license, projectPath);

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
  } catch (err: unknown) {
    return {
      success: false,
      skillId,
      installedFiles: [],
      message: `Failed to install skill '${skillId}': ${(err as Error).message}`,
    };
  }
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
  const hasPhpFiles = (relDir: string): boolean => {
    try {
      const fullDir = path.join(projectPath, relDir);
      return fs.existsSync(fullDir) && fs.readdirSync(fullDir).some((f) => f.endsWith('.php'));
    } catch {
      return false;
    }
  };

  if (
    fileExists('composer.json') ||
    hasPhpFiles('.') ||
    hasPhpFiles('public/api') ||
    hasPhpFiles('website/public/api') ||
    hasPhpFiles('tests/php') ||
    hasPhpFiles('api') ||
    hasPhpFiles('src')
  ) {
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
  if (
    fileExists('.github/workflows') ||
    fileExists('Dockerfile') ||
    fileExists('docker-compose.yml') ||
    fileExists('infra/docker')
  ) {
    detected.add('qa-devops');
    detected.add('qa-security');
  }

  // MCP Protocol detection
  if (
    fileExists('packages/mcp-server') ||
    fileExists('mcp.json') ||
    fileExists('mcp_config.json') ||
    (fileExists('package.json') && fileContains('package.json', 'modelcontextprotocol'))
  ) {
    detected.add('qa-mcp');
  }

  // Well-Known standards detection
  if (
    fileExists('website/public/.well-known') ||
    fileExists('public/.well-known') ||
    fileExists('.well-known')
  ) {
    detected.add('qa-well-known');
  }

  // Web application & compliance detection
  if (
    fileExists('website') ||
    fileExists('src/pages') ||
    fileExists('src/app') ||
    fileExists('public')
  ) {
    detected.add('qa-seo-website');
    detected.add('qa-accessibility');
    detected.add('qa-performance');
    detected.add('qa-gdpr-rgpd');
    detected.add('qa-cnil');
  }

  // Software supply chain assurance
  if (fileExists('package.json') || fileExists('Cargo.toml') || fileExists('go.mod')) {
    detected.add('qa-cra-software-supply-chain');
  }

  // Email / DNS indicators
  if (fileExists('dns') || fileExists('infra/dns') || fileExists('scripts/deploy-ovh.js')) {
    detected.add('qa-emails-dns');
  }

  return Array.from(detected);
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
  if (!isConfirmed) {
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
      summary += `> Purchase or manage licenses: https://www.illicomedia.com/qa-skills/pricing\n\n`;
    }

    summary += failedSection;
    summary += `### Next Steps for AI Agent:\n`;
    summary += `1. Ask the developer for explicit confirmation in the chat: "I detected the following QA skills for this repository (${installed.map((s) => s.skillId).join(', ')}). Would you like me to install them into .agents/skills/?"\n`;
    summary += `2. Re-run \`sync_workspace_skills\` with \`confirm: true\` only after receiving user approval.\n`;
  } else {
    summary = `# Fredo QA Skills Workspace Sync\n\n`;
    summary += `Target: \`${safeProjectPath}\`\n`;
    summary += `Active Plan: **${license.tier.toUpperCase()}**\n\n`;

    if (installed.length > 0) {
      summary += `### Successfully Installed (${installed.length}):\n${installedList}\n\n`;
    }

    if (skippedUnauthorized.length > 0) {
      summary += `### Requires Authentication (${skippedUnauthorized.length}):\n${skippedList}\n\n`;
      summary += `> [!WARNING] To unlock commercial skills, activate your license with the \`set_license_key\` tool.\n`;
      summary += `> Purchase or manage licenses: https://www.illicomedia.com/qa-skills/pricing\n\n`;
    }

    summary += failedSection;
    summary += `### Next Steps for AI Agent:\n`;
    summary += `- Reference installed skills from \`.agents/skills/<skill_id>/SKILL.md\`\n`;
    summary += `- Run relevant inner loop checks before commits\n`;
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

/**
 * Safely prunes unneeded QA skills from .agents/skills/ by archiving them to .agents/.archive/
 * based on detected project tech stacks and optional explicit whitelist.
 * Non-destructive: moves files rather than permanently deleting them.
 * Requires explicit confirm: true to perform moves (safe preview by default).
 */
export function pruneSkills(
  projectPath: string = process.cwd(),
  options?: PruneSkillsOptions,
): PruneSkillsResult {
  const safeProjectPath = validateSafeProjectPath(projectPath, 'prune_skills');
  const skillsDir = path.join(safeProjectPath, '.agents', 'skills');
  const archiveDir = path.join(safeProjectPath, '.agents', options?.archiveDirName || '.archive');
  const isConfirmed = Boolean(options?.confirm);

  // If no skills dir exists, nothing to prune
  if (!fs.existsSync(skillsDir)) {
    return {
      projectPath: safeProjectPath,
      success: true,
      previewOnly: false,
      requiresConfirmation: false,
      detectedSkills: [],
      archivedSkills: [],
      retainedSkills: [],
      archiveDirectory: archiveDir,
      summaryMessage: `# Prune Skills: Nothing to do\n\nNo \`.agents/skills/\` directory exists in \`${safeProjectPath}\`.`,
    };
  }

  // Determine needed skills
  const detected = new Set(detectProjectSkills(safeProjectPath));
  // Core skills are always preserved
  detected.add('qa-core');
  detected.add('dev-flow');

  // Whitelisted skills from user options
  if (options?.keepSkills && Array.isArray(options.keepSkills)) {
    for (const id of options.keepSkills) {
      if (typeof id === 'string' && id.trim()) {
        detected.add(id.trim());
      }
    }
  }

  // Discover currently installed skills in .agents/skills/
  const installedEntries: string[] = [];
  try {
    for (const name of fs.readdirSync(skillsDir)) {
      const fullPath = path.join(skillsDir, name);
      try {
        const lstat = fs.lstatSync(fullPath);
        const isDirOrSymlinkDir =
          lstat.isDirectory() ||
          (lstat.isSymbolicLink() && fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory());
        if (isDirOrSymlinkDir) {
          if (lstat.isSymbolicLink()) {
            const real = fs.realpathSync(fullPath);
            validateSafeProjectPath(real, 'prune_skills symlink target');
          }
          if (fs.existsSync(path.join(fullPath, 'SKILL.md')) || findSkill(name)) {
            installedEntries.push(name);
          }
        }
      } catch {}
    }
  } catch (err) {
    return {
      projectPath: safeProjectPath,
      success: false,
      previewOnly: false,
      requiresConfirmation: false,
      detectedSkills: Array.from(detected),
      archivedSkills: [],
      retainedSkills: [],
      archiveDirectory: archiveDir,
      summaryMessage: `Failed to read .agents/skills/: ${(err as Error).message}`,
    };
  }

  const unneededSkills = installedEntries.filter((id) => !detected.has(id));
  const retainedSkills = installedEntries.filter((id) => detected.has(id));

  // If all installed skills are needed
  if (unneededSkills.length === 0) {
    return {
      projectPath: safeProjectPath,
      success: true,
      previewOnly: false,
      requiresConfirmation: false,
      detectedSkills: Array.from(detected),
      archivedSkills: [],
      retainedSkills,
      archiveDirectory: archiveDir,
      summaryMessage:
        `# [CLEAN] Workspace Skills Up to Date\n\n` +
        `All ${installedEntries.length} installed skill(s) in \`${skillsDir}\` match this repository's active stacks.\n` +
        `No unneeded skills detected for archiving.`,
    };
  }

  if (!isConfirmed) {
    const unneededList = unneededSkills
      .map((s) => `  - 📦 **\`${s}\`** (Not detected in project files)`)
      .join('\n');
    const retainedList = retainedSkills.map((s) => `  - ✓ **\`${s}\`** (Active stack)`).join('\n');

    let previewMsg = `# [DRY-RUN PREVIEW] Safe Skill Archiving (Prune)\n\n`;
    previewMsg += `> [!NOTE] **Non-Destructive Archiving**: Files will be moved to \`.agents/.archive/\`, not deleted.\n`;
    previewMsg += `> They become inactive for the AI agent to save context window tokens, but remain 100% recoverable.\n\n`;
    previewMsg += `Target Project: \`${safeProjectPath}\`\n`;
    previewMsg += `Archive Destination: \`${archiveDir}\`\n\n`;
    previewMsg += `### Unneeded Skills to Archive (${unneededSkills.length}):\n${unneededList}\n\n`;
    if (retainedSkills.length > 0) {
      previewMsg += `### Active Skills to Retain (${retainedSkills.length}):\n${retainedList}\n\n`;
    }
    previewMsg += `### Next Steps for AI Agent:\n`;
    previewMsg += `1. Ask developer for approval: "I identified ${unneededSkills.length} unneeded skill(s) in this project (${unneededSkills.join(', ')}). Would you like me to archive them to .agents/.archive/?"\n`;
    previewMsg += `2. Re-run \`prune_skills\` with \`confirm: true\` only after developer approves.\n`;

    return {
      projectPath: safeProjectPath,
      success: true,
      previewOnly: true,
      requiresConfirmation: true,
      detectedSkills: Array.from(detected),
      archivedSkills: unneededSkills,
      retainedSkills,
      archiveDirectory: archiveDir,
      summaryMessage: previewMsg,
    };
  }

  // Execution: Move unneeded skills to .agents/.archive/
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
  } catch (err) {
    return {
      projectPath: safeProjectPath,
      success: false,
      previewOnly: false,
      requiresConfirmation: false,
      detectedSkills: Array.from(detected),
      archivedSkills: [],
      retainedSkills: installedEntries,
      archiveDirectory: archiveDir,
      summaryMessage: `Failed to create archive directory \`${archiveDir}\`: ${(err as Error).message}`,
    };
  }

  const successfullyArchived: string[] = [];
  const failedToArchive: string[] = [];

  for (const skillId of unneededSkills) {
    const src = path.join(skillsDir, skillId);
    const dest = path.join(archiveDir, skillId);
    try {
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      fs.renameSync(src, dest);
      successfullyArchived.push(skillId);
    } catch {
      try {
        fs.cpSync(src, dest, { recursive: true });
        fs.rmSync(src, { recursive: true, force: true });
        successfullyArchived.push(skillId);
      } catch {
        failedToArchive.push(skillId);
      }
    }
  }

  const archivedList = successfullyArchived
    .map((s) => `  - 📦 **\`${s}\`** -> \`.agents/.archive/${s}/\``)
    .join('\n');
  const retainedList = retainedSkills.map((s) => `  - ✓ **\`${s}\`** (Active)`).join('\n');

  let successMsg = `# Fredo QA Skills: Successfully Archived (${successfullyArchived.length})\n\n`;
  successMsg += `> [!NOTE] **Non-Destructive**: Skills have been moved from \`.agents/skills/\` to \`.agents/.archive/\`.\n`;
  successMsg += `> They are now inactive for AI agents, saving context tokens, but remain 100% recoverable.\n\n`;
  successMsg += `Archive Location: \`${archiveDir}\`\n\n`;
  successMsg += `### Archived Skills:\n${archivedList}\n\n`;
  if (retainedSkills.length > 0) {
    successMsg += `### Active Retained Skills (${retainedSkills.length}):\n${retainedList}\n\n`;
  }
  if (failedToArchive.length > 0) {
    successMsg += `⚠️ Failed to move: ${failedToArchive.join(', ')}\n`;
  }

  return {
    projectPath: safeProjectPath,
    success: true,
    previewOnly: false,
    requiresConfirmation: false,
    detectedSkills: Array.from(detected),
    archivedSkills: successfullyArchived,
    retainedSkills,
    archiveDirectory: archiveDir,
    summaryMessage: successMsg,
  };
}
