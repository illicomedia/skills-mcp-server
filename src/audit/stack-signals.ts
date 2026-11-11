import type { GitForge } from './types.js';

/** Pure signals behind the stack detection: no disk access (probes are passed in). */

/** Whether a path, relative to the audited project, exists (a file or a folder). */
type PathProbe = (rel: string) => boolean;

/** HTTP/HTTPS web origin signals only — bare dist/ or public/ is not a website. */
export function detectWebProject(fileExists: PathProbe, hasDir: PathProbe): boolean {
  const hasWebDocumentRoot =
    fileExists('index.html') ||
    fileExists('src/index.html') ||
    fileExists('public/index.html') ||
    fileExists('website/index.html') ||
    fileExists('website/public/index.html') ||
    fileExists('apps/web/index.html') ||
    fileExists('apps/web/public/index.html') ||
    fileExists('client/index.html') ||
    fileExists('client/public/index.html') ||
    hasDir('www');
  const hasWebFrameworkConfig =
    fileExists('next.config.js') ||
    fileExists('next.config.mjs') ||
    fileExists('next.config.ts') ||
    fileExists('next.config.mts') ||
    fileExists('nuxt.config.js') ||
    fileExists('nuxt.config.mjs') ||
    fileExists('nuxt.config.ts') ||
    fileExists('astro.config.js') ||
    fileExists('astro.config.mjs') ||
    fileExists('astro.config.ts') ||
    fileExists('svelte.config.js') ||
    fileExists('svelte.config.ts') ||
    fileExists('angular.json') ||
    fileExists('remix.config.js') ||
    fileExists('remix.config.ts') ||
    fileExists('gatsby-config.js') ||
    fileExists('gatsby-config.mjs') ||
    fileExists('gatsby-config.ts');
  const hasBundlerStaticSite =
    (fileExists('vite.config.ts') ||
      fileExists('vite.config.js') ||
      fileExists('vite.config.mjs') ||
      fileExists('webpack.config.js') ||
      fileExists('webpack.config.ts')) &&
    (hasDir('public') || fileExists('index.html'));
  const hasNestedWebPackage =
    hasDir('website/public') || hasDir('apps/web/public') || hasDir('client/public');
  return hasWebDocumentRoot || hasWebFrameworkConfig || hasBundlerStaticSite || hasNestedWebPackage;
}

/** The code forge named in the git remote configuration. */
export function detectGitForge(gitConfigContent: string): GitForge {
  if (/gitlab/i.test(gitConfigContent)) {
    return 'gitlab';
  }
  if (/forgejo|gitea|codeberg/i.test(gitConfigContent)) {
    return 'forgejo';
  }
  if (/bitbucket/i.test(gitConfigContent)) {
    return 'bitbucket';
  }
  if (/dev\.azure\.com|visualstudio\.com/i.test(gitConfigContent)) {
    return 'azure';
  }
  if (/github/i.test(gitConfigContent)) {
    return 'github';
  }
  return 'unknown';
}
