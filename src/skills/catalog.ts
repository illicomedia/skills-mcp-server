import * as path from 'node:path';
import { resolveSkillLicense } from '../license/templates.js';
import { exists, readText } from '../security/path-guard.js';
import type { LicenseValidationResult, SkillMetadata, SkillTier } from '../types.js';
import { SKILLS_CATALOG } from './catalog-data.js';

/**
 * Filter skills by active license tier
 */
export function getAvailableSkills(userTier: SkillTier): SkillMetadata[] {
  if (userTier === 'enterprise') {
    return SKILLS_CATALOG;
  }
  if (userTier === 'pro') {
    return SKILLS_CATALOG.filter((s) => s.tier === 'free' || s.tier === 'pro');
  }
  // Free tier
  return SKILLS_CATALOG.filter((s) => s.tier === 'free');
}

/**
 * Finds a skill by ID
 */
export function findSkill(id: string): SkillMetadata | undefined {
  return SKILLS_CATALOG.find((s) => s.id === id);
}

/**
 * Attempts to load the real SKILL.md from filesystem, or falls back to metadata
 */
export function loadSkillContent(skillId: string, searchDir?: string): string {
  const meta = findSkill(skillId);
  if (!meta) {
    throw new Error(`Unknown skill: ${skillId}`);
  }

  // Look for actual file on disk if available
  const base = searchDir ?? process.cwd();
  const candidatePaths = [
    path.join(base, 'skills', 'free', skillId, 'SKILL.md'),
    path.join(base, 'skills', 'pro', skillId, 'SKILL.md'),
    path.join(base, 'skills', 'enterprise', skillId, 'SKILL.md'),
    path.join(base, 'skills', skillId, 'SKILL.md'),
    path.join(base, '.agents', 'skills', skillId, 'SKILL.md'),
  ];

  let firstEmpty: string | undefined;
  for (const p of candidatePaths) {
    if (!exists(p)) {
      continue;
    }
    try {
      const content = readText(p);
      if (content.trim() !== '') {
        return content;
      }
      firstEmpty ??= p;
    } catch {
      // Unreadable (a directory, no permission): treated like a missing file
    }
  }

  // A blank file is not a skill: installing it would report success and give an agent no rules.
  if (firstEmpty) {
    throw new SkillFileEmptyError(skillId, firstEmpty);
  }

  // The package ships no skill files. Never synthesize rules: an agent would follow
  // invented directives (e.g. scripts the project does not have).
  throw new SkillNotInstalledError(skillId, candidatePaths);
}

const SKILL_PAGE_BASE_URL = 'https://www.illicomedia.com/qa-skills/skills';

/**
 * Raised when a known skill has no SKILL.md on disk. The message tells the agent to stop
 * and how the developer can install the skill, instead of letting it improvise rules.
 * @public Callers tell it apart with instanceof (the tests do, through dist/).
 */
export class SkillNotInstalledError extends Error {
  constructor(
    public readonly skillId: string,
    public readonly searchedPaths: string[],
  ) {
    super(
      `Skill '${skillId}' is not installed in this project: no SKILL.md found ` +
        `(searched: ${searchedPaths.join(', ')}). This MCP server does not ship skill files. ` +
        `Ask the developer to download the skill from ${SKILL_PAGE_BASE_URL}/${skillId} ` +
        `and extract it into .agents/skills/${skillId}/, then retry. ` +
        `Do not apply or invent rules for this skill until it is installed.`,
    );
    this.name = 'SkillNotInstalledError';
  }
}

/**
 * Raised when a skill's SKILL.md exists but holds nothing but whitespace (a failed download,
 * a truncated copy). Like SkillNotInstalledError, the message tells the developer what to do.
 * @public Callers tell it apart with instanceof (the tests do, through dist/).
 */
export class SkillFileEmptyError extends Error {
  constructor(
    public readonly skillId: string,
    public readonly emptyPath: string,
  ) {
    super(
      `Skill '${skillId}' has an empty SKILL.md (${emptyPath}). The file looks like a failed ` +
        `or truncated download: download the skill again from ${SKILL_PAGE_BASE_URL}/${skillId} ` +
        `and extract it into .agents/skills/${skillId}/, then retry. ` +
        `Do not apply or invent rules for this skill until it is installed.`,
    );
    this.name = 'SkillFileEmptyError';
  }
}

/**
 * Loads or generates a compliant LICENSE file for a skill
 */
export function loadSkillLicense(
  skillId: string,
  license: LicenseValidationResult,
  searchDir?: string,
): string {
  const meta = findSkill(skillId);
  if (!meta) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  return resolveSkillLicense(meta, license, searchDir);
}
