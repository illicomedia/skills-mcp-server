import * as path from 'node:path';
import {
  copyDirInside,
  exists,
  isDirectory,
  isSymbolicLink,
  listDir,
  makeDirInside,
  realPath,
  removeInside,
  renameInside,
  validateSafeProjectPath,
} from '../security/path-guard.js';
import { findSkill } from './catalog.js';
import { detectProjectSkills } from './stack-detection.js';

export interface PruneSkillsOptions {
  confirm?: boolean;
  keepSkills?: string[];
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

/** A folder, or a link to a safe folder, that holds a skill. An unreadable entry is not a skill. */
function isInstalledSkill(skillsDir: string, name: string): boolean {
  const fullPath = path.join(skillsDir, name);
  try {
    if (!isDirectory(fullPath)) {
      return false;
    }
    if (isSymbolicLink(fullPath)) {
      validateSafeProjectPath(realPath(fullPath), 'prune_skills symlink target');
    }
    return exists(path.join(fullPath, 'SKILL.md')) || findSkill(name) !== undefined;
  } catch {
    return false;
  }
}

/** Moves a skill inside the project, copying when a move is impossible (another device). */
function archiveSkill(root: string, src: string, dest: string): boolean {
  try {
    removeInside(root, dest);
    renameInside(root, src, dest);
    return true;
  } catch {
    try {
      copyDirInside(root, src, dest);
      removeInside(root, src);
      return true;
    } catch {
      return false;
    }
  }
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
  const archiveDir = path.join(safeProjectPath, '.agents', '.archive');
  const isConfirmed = Boolean(options?.confirm);

  // If no skills dir exists, nothing to prune
  if (!exists(skillsDir)) {
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
  let installedEntries: string[];
  try {
    installedEntries = listDir(skillsDir).filter((name) => isInstalledSkill(skillsDir, name));
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
    makeDirInside(safeProjectPath, archiveDir);
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
    const archived = archiveSkill(
      safeProjectPath,
      path.join(skillsDir, skillId),
      path.join(archiveDir, skillId),
    );
    (archived ? successfullyArchived : failedToArchive).push(skillId);
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
