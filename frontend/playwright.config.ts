import { defineConfig } from '@playwright/test';
const port = process.env.AEGIS_FRONTEND_PORT || '5174';
if (!/^\d{4,5}$/.test(port)) throw new Error('Invalid AEGIS_FRONTEND_PORT');
const baseURL = process.env.AEGIS_FRONTEND_URL || 'http://127.0.0.1:' + port;
export default defineConfig({
  testDir: process.env.AEGIS_REAL_BROWSER === '1' ? './e2e-live' : './e2e',
  // Live suites mutate a shared disposable policy and consume real quotas.
  workers: process.env.AEGIS_REAL_BROWSER === '1' ? 1 : undefined,
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL },
  webServer: process.env.AEGIS_FRONTEND_URL ? undefined : { command: 'npm run dev -- --port ' + port + ' --strictPort', url: baseURL, reuseExistingServer: false },
});
