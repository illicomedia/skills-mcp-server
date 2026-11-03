#!/usr/bin/env node

/** Runs before `tsc`: tsc never deletes the output of a removed source, so the build starts empty. */

import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

rmSync(fileURLToPath(new URL('../dist/', import.meta.url)), { recursive: true, force: true });
