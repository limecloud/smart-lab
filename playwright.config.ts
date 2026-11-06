import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 1512, height: 982 },
    screenshot: 'only-on-failure',
    trace: { mode: 'retain-on-failure', screenshots: false },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH
        || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: '4312',
      LAB_API_PORT: '4312',
      LAB_WEB_PORT: '5175',
      LAB_DATA_PATH: 'test-results/e2e-validated-state.json',
    },
  },
});
