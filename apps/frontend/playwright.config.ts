import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e for the Nexus UI. Requires the backend stack running
 * (Postgres + Redis via `pnpm db:up`) - the webServer entry below starts
 * the mock OpenAI stub, API, worker and the Vite dev server automatically.
 *
 *   pnpm --filter @nexus/frontend test:e2e
 *
 * The full stack is verified in CI with a deterministic mock OpenAI stub
 * (no API key): workspace -> upload -> index -> streamed chat answer.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bash e2e/e2e-server.sh',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://nexus:nexus@localhost:5432/nexus',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      UPLOAD_DIR: process.env.UPLOAD_DIR ?? '/tmp/nexus-e2e-uploads',
    },
  },
});
