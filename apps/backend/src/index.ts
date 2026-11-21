import './platform/env.js';

import { main } from './main.js';

void main().catch((err) => {
  console.error('[boot] fatal error:', err);
  process.exit(1);
});

// Re-exports so the frontend can `import type { AppRouter } from '@nexus/backend'`
export { appRouter } from './http/trpc.js';
export type { AppRouter } from './http/trpc.js';
