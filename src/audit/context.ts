import * as path from 'node:path';
import {
  type DirEntry,
  exists,
  isDirectory,
  listDir,
  listDirEntries,
  readText,
} from '../security/path-guard.js';
import type { AuditContext, GitForge, StackDetection } from './types.js';

const IGNORED_SCAN_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'vendor',
  '.venv',
  'venv',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
]);

function readEntries(directory: string): DirEntry[] {
  try {
    return listDirEntries(directory);
  } catch {
    return [];
  }
}

export function createAuditContext(projectPath: string): AuditContext {
  const resolvedPath = path.resolve(projectPath);
  const parentPath = path.dirname(resolvedPath);

  const fileExists = (rel: string): boolean => exists(path.join(resolvedPath, rel));

  const findUp = (rel: string): string | null => {
    let curr = resolvedPath;
    while (true) {
      const candidate = path.join(curr, rel);
      if (exists(candidate)) {
        return candidate;
      }
      const parent = path.dirname(curr);
      if (parent === curr) {
        break;
      }
      if (exists(path.join(curr, '.git'))) {
        break;
      }
      curr = parent;
    }
    return null;
  };

  const parentFileExists = (rel: string): boolean => {
    const found = findUp(rel);
    return found !== null && path.dirname(found) !== resolvedPath;
  };

  const hasDir = (rel: string): boolean => {
    const p = path.join(resolvedPath, rel);
    return exists(p) && isDirectory(p);
  };

  const readFile = (rel: string): string | null => {
    try {
      const p = path.join(resolvedPath, rel);
      if (!exists(p)) {
        return null;
      }
      return readText(p);
    } catch {
      return null;
    }
  };

  const readParentFile = (rel: string): string | null => {
    const found = findUp(rel);
    if (!found || path.dirname(found) === resolvedPath) {
      return null;
    }
    try {
      return readText(found);
    } catch {
      return null;
    }
  };

  const readDir = (rel: string): string[] => {
    try {
      const p = path.join(resolvedPath, rel);
      if (!exists(p)) {
        return [];
      }
      return listDir(p);
    } catch {
      return [];
    }
  };

  const findFiles = (
    maxDepth: number,
    predicate: (relPath: string, fileName: string) => boolean,
  ): string[] => {
    const matches: string[] = [];

    const walk = (currentDir: string, currentRel: string, depth: number) => {
      if (depth > maxDepth) {
        return;
      }
      for (const entry of readEntries(currentDir)) {
        const relPath = currentRel ? `${currentRel}/${entry.name}` : entry.name;
        if (entry.isDirectory() && !IGNORED_SCAN_DIRS.has(entry.name)) {
          walk(path.join(currentDir, entry.name), relPath, depth + 1);
        } else if (entry.isFile() && predicate(relPath, entry.name)) {
          matches.push(relPath);
        }
      }
    };

    walk(resolvedPath, '', 1);
    return matches;
  };

  const hasPhpFiles = (relDir: string): boolean => {
    try {
      const fullDir = path.join(resolvedPath, relDir);
      return exists(fullDir) && listDir(fullDir).some((f) => f.endsWith('.php'));
    } catch {
      return false;
    }
  };

  const hasShellScripts = (): boolean => {
    try {
      const rootFiles = listDir(resolvedPath);
      if (rootFiles.some((f) => f.endsWith('.sh'))) {
        return true;
      }
      const scriptsDir = path.join(resolvedPath, 'scripts');
      return (
        exists(scriptsDir) &&
        isDirectory(scriptsDir) &&
        listDir(scriptsDir).some((f) => f.endsWith('.sh'))
      );
    } catch {
      return false;
    }
  };

  // Stack detection across all 8 Fredo QA language skills
  const isRust = fileExists('Cargo.toml');
  const isGo = fileExists('go.mod');
  const isNode = fileExists('package.json');
  const isPython =
    fileExists('pyproject.toml') ||
    fileExists('requirements.txt') ||
    fileExists('setup.py') ||
    fileExists('Pipfile');
  const isJava =
    fileExists('pom.xml') ||
    fileExists('build.gradle') ||
    fileExists('build.gradle.kts') ||
    fileExists('mvnw') ||
    fileExists('gradlew');
  const isCpp =
    fileExists('CMakeLists.txt') ||
    fileExists('compile_commands.json') ||
    fileExists('meson.build') ||
    fileExists('configure.ac');
  const isPhp =
    fileExists('composer.json') ||
    hasPhpFiles('.') ||
    hasPhpFiles('public/api') ||
    hasPhpFiles('api') ||
    hasPhpFiles('src');
  const isBash =
    !(isNode || isRust || isGo || isPython || isJava || isCpp || isPhp) &&
    (hasShellScripts() || fileExists('.shellcheckrc') || hasDir('tests/bats'));
  const hasMakefile =
    fileExists('Makefile') || fileExists('justfile') || fileExists('scripts/qa.sh');
  const makefileContent = fileExists('Makefile') ? (readFile('Makefile') ?? '') : '';
  const makefileHasQaRunner = /(?:^|\n)\s*(?:qa[a-z0-9_-]*|test[a-z0-9_-]*)\s*:/m.test(
    makefileContent,
  );
  const hasLocalQaRunner =
    fileExists('scripts/qa.sh') ||
    fileExists('scripts/qa') ||
    fileExists('justfile') ||
    fileExists('Taskfile.yml') ||
    fileExists('Taskfile.yaml') ||
    fileExists('Taskfile') ||
    hasDir('.githooks') ||
    fileExists('.git/hooks/pre-push') ||
    fileExists('.git/hooks/pre-commit') ||
    makefileHasQaRunner;
  const hasAgentArtifacts =
    hasDir('.agents') ||
    hasDir('.claude') ||
    hasDir('.cursor') ||
    hasDir('.windsurf') ||
    fileExists('AGENTS.md') ||
    parentFileExists('AGENTS.md');
  const isWebProject =
    hasDir('public') ||
    fileExists('index.html') ||
    fileExists('src/index.html') ||
    hasDir('dist') ||
    hasDir('www');
  const isOfflineCliProject =
    !isWebProject && (isRust || isGo || isCpp || isBash || hasLocalQaRunner);
  const hasEnvFiles =
    fileExists('.env') ||
    fileExists('.env.local') ||
    fileExists('.env.prod') ||
    fileExists('.env.example');
  const hasManifest =
    isNode || isRust || isGo || isPython || isJava || isCpp || fileExists('composer.json');

  const gitConfigPath = findUp('.git/config');
  let gitConfigContent = '';
  if (gitConfigPath) {
    try {
      gitConfigContent = readText(gitConfigPath);
    } catch {
      gitConfigContent = '';
    }
  }
  let detectedForge: GitForge = 'unknown';
  if (/gitlab/i.test(gitConfigContent)) {
    detectedForge = 'gitlab';
  } else if (/forgejo|gitea|codeberg/i.test(gitConfigContent)) {
    detectedForge = 'forgejo';
  } else if (/bitbucket/i.test(gitConfigContent)) {
    detectedForge = 'bitbucket';
  } else if (/dev\.azure\.com|visualstudio\.com/i.test(gitConfigContent)) {
    detectedForge = 'azure';
  } else if (/github/i.test(gitConfigContent)) {
    detectedForge = 'github';
  }

  const stack: StackDetection = {
    isRust,
    isGo,
    isNode,
    isPython,
    isJava,
    isCpp,
    isPhp,
    isBash,
    hasMakefile,
    hasLocalQaRunner,
    hasAgentArtifacts,
    isOfflineCliProject,
    isWebProject,
    hasEnvFiles,
    hasManifest,
  };

  return {
    projectPath,
    resolvedPath,
    parentPath,
    stack,
    detectedForge,
    fileExists,
    parentFileExists,
    findUp,
    findFiles,
    hasDir,
    readFile,
    readParentFile,
    readDir,
  };
}
