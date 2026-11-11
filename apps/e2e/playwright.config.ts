import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const port = 3100;
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node apps/api/dist/main.js',
    cwd: root,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    env: {
      ...inheritedEnv,
      NODE_ENV: 'test',
      PORT: String(port),
      APP_URL: `http://127.0.0.1:${port}`,
      WEB_DIST_PATH: resolve(root, 'apps/web/dist'),
      ENABLE_DOCS: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
