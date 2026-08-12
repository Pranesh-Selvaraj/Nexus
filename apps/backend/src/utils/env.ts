import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

// Candidates: cwd-based (pnpm runs scripts from the package dir) and
// file-based fallbacks that work no matter where the process is started.
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(sourceDir, '../../.env'),
  path.resolve(sourceDir, '../../../.env'),
];

config({ path: candidates, quiet: true });
