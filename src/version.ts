import { fileURLToPath } from 'node:url';
import { readText } from './security/path-guard.js';

/** Version of this package, read from the package.json shipped next to dist/ (single source of truth). */
export const SERVER_VERSION: string = (
  JSON.parse(readText(fileURLToPath(new URL('../package.json', import.meta.url)))) as {
    version: string;
  }
).version;
