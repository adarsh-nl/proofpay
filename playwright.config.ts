/**
 * Playwright configuration for the ProofPay e2e suite (QA lane).
 *
 * Default (offline, deterministic): starts a Next dev server on port 3100 with
 * PayPal mock + vision mock + auto-capture, resets the e2e database and uploads, runs
 * `tests/e2e/**` serially in Chromium and records a video per test under
 * `docs/recordings/e2e` (git-ignored).
 *
 * Against a running app (hosted Render demo, or a manually started server):
 *   BASE_URL=https://<host> npm run e2e
 * which skips the managed `webServer`.
 *
 * `@live` tests additionally need a real sandbox buyer:
 *   E2E_BUYER_EMAIL=... E2E_BUYER_PASSWORD=... BASE_URL=http://localhost:3100 npm run e2e -- -g @live
 * (only when the target app runs with NEXT_PUBLIC_PAYPAL_MOCK=0.)
 */
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const MANAGED_SERVER = process.env.BASE_URL === undefined;
const RECORDINGS_DIR = path.join(__dirname, 'docs', 'recordings', 'e2e');

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: RECORDINGS_DIR,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(__dirname, 'docs', 'recordings', 'playwright-report'), open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'on',
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      // `channel: 'chromium'` forces the full Chromium binary (new headless) instead of
      // chrome-headless-shell, which crashes at startup on this machine ("icudtl.dat not
      // found in bundle"). Both binaries are installed by `npx playwright install chromium`.
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: MANAGED_SERVER
    ? {
        // `db:reset` runs first so every run starts from the three seeded demo jobs.
        command: `npm run db:reset && npx next dev -p ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        timeout: 240_000,
        reuseExistingServer: false,
        env: {
          // The three offline switches (prompt R10) keep the suite deterministic and
          // credential-free; the optional `@live` test is only for a manually started
          // server with NEXT_PUBLIC_PAYPAL_MOCK=0 (see the header).
          PAYPAL_MOCK: '1',
          NEXT_PUBLIC_PAYPAL_MOCK: '1',
          VISION_MOCK: '1',
          AUTO_CAPTURE_ON_APPROVE: '1',
          // Lets every spec file reset to the seeded demo jobs (helpers/api.ts resetDemoData).
          DEMO_RESET_ENABLED: '1',
          DATABASE_PATH: './data/e2e.db',
          UPLOAD_DIR: './data/e2e-uploads',
          APP_BASE_URL: BASE_URL,
          NEXT_TELEMETRY_DISABLED: '1',
        },
      }
    : undefined,
});
