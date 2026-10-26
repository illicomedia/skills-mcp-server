import { readFileSync } from 'node:fs';

/** Version of this package, read from the package.json shipped next to dist/ (single source of truth). */
export const SERVER_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
