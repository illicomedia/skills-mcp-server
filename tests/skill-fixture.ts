import * as fs from 'node:fs';
import * as path from 'node:path';
import { SKILLS_CATALOG } from '../dist/skills/catalog.js';

/**
 * The package ships no skill files, so installs need a real source on disk.
 * Writes `skills/<id>/SKILL.md` under projectDir (one of the paths loadSkillContent searches).
 */
export function writeSkillSources(
  projectDir: string,
  skillIds: string[] = SKILLS_CATALOG.map((s) => s.id),
): void {
  for (const id of skillIds) {
    const dir = path.join(projectDir, 'skills', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${id} (test fixture)\n`, 'utf-8');
  }
}
