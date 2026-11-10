import * as path from 'node:path';
import { exists, listDir, readText } from '../security/path-guard.js';

/** Any of these paths in a project selects these skills. */
const FILE_INDICATORS: ReadonlyArray<{ files: string[]; skills: string[] }> = [
  { files: ['package.json', 'tsconfig.json'], skills: ['qa-javascript-typescript'] },
  { files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'], skills: ['qa-python'] },
  { files: ['Cargo.toml'], skills: ['qa-rust'] },
  { files: ['go.mod'], skills: ['qa-go'] },
  { files: ['pom.xml', 'build.gradle', 'build.gradle.kts'], skills: ['qa-java'] },
  { files: ['CMakeLists.txt', 'Makefile', 'compile_commands.json'], skills: ['qa-c-cpp'] },
  { files: ['composer.json'], skills: ['qa-php'] },
  {
    files: ['.github/workflows', 'Dockerfile', 'docker-compose.yml', 'infra/docker'],
    skills: ['qa-devops', 'qa-security'],
  },
  // server.json is the MCP Registry listing artifact; mcp.json / mcp_config.json are client configs.
  {
    files: ['packages/mcp-server', 'server.json', 'mcp.json', 'mcp_config.json'],
    skills: ['qa-mcp'],
  },
  {
    files: ['website/public/.well-known', 'public/.well-known', '.well-known'],
    skills: ['qa-well-known'],
  },
  {
    files: ['website', 'src/pages', 'src/app', 'public'],
    skills: ['qa-seo-website', 'qa-accessibility', 'qa-performance', 'qa-gdpr-rgpd', 'qa-cnil'],
  },
  {
    files: ['package.json', 'Cargo.toml', 'go.mod'],
    skills: ['qa-cra-software-supply-chain'],
  },
  { files: ['dns', 'infra/dns', 'mail', 'bind', 'named.conf'], skills: ['qa-emails-dns'] },
];

const PHP_DIRECTORIES = ['.', 'public/api', 'website/public/api', 'tests/php', 'api', 'src'];

/** Reads a directory for detection: an unreadable one simply holds nothing. */
function namesIn(directory: string): string[] {
  try {
    return listDir(directory);
  } catch {
    return [];
  }
}

/**
 * MCP Registry / SDK signals in package.json (not a bare "modelcontextprotocol" substring).
 * Official npm ownership marker is `mcpName`; SDK users depend on `@modelcontextprotocol/*`.
 */
function packageJsonIndicatesMcp(packageJsonPath: string): boolean {
  try {
    const pkg = JSON.parse(readText(packageJsonPath)) as Record<string, unknown>;
    if (typeof pkg.mcpName === 'string' && pkg.mcpName.trim().length > 0) {
      return true;
    }
    const depBlocks = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    ];
    for (const block of depBlocks) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      if (
        Object.keys(block as Record<string, unknown>).some((name) =>
          name.startsWith('@modelcontextprotocol/'),
        )
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Detects relevant skills by inspecting workspace files and indicators
 */
export function detectProjectSkills(projectPath: string = process.cwd()): string[] {
  const detected = new Set<string>(['qa-core', 'dev-flow']);
  const inProject = (rel: string) => path.join(projectPath, rel);

  for (const { files, skills } of FILE_INDICATORS) {
    if (files.some((file) => exists(inProject(file)))) {
      for (const skill of skills) {
        detected.add(skill);
      }
    }
  }
  if (packageJsonIndicatesMcp(inProject('package.json'))) {
    detected.add('qa-mcp');
  }
  if (PHP_DIRECTORIES.some((dir) => namesIn(inProject(dir)).some((f) => f.endsWith('.php')))) {
    detected.add('qa-php');
  }
  if (namesIn(projectPath).some((f) => f.endsWith('.sh') || f === 'scripts')) {
    detected.add('qa-bash');
  }

  return Array.from(detected);
}
