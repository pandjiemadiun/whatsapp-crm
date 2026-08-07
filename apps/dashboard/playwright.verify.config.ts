import { defineConfig, devices } from '@playwright/test';

/**
 * Config khusus verifikasi — menjalankan test tunggal TANPA project setup
 * (auth.setup bergantung dev server 5173; test empty state self-contained).
 * Base URL diambil dari env BASE_URL (default localhost:80 = app live).
 */
export default defineConfig({
  testDir: './src/tests/e2e',
  testMatch: /analytics-empty\.e2e\.test\.ts/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:80',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
