import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test', testMatch: '**/*.spec.js', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3101', headless: true, trace: 'retain-on-failure', launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {} },
  webServer: { command: 'node server/index.js', url: 'http://127.0.0.1:3101/api/health', reuseExistingServer: false, env: { PORT: '3101', HOST: '127.0.0.1', DATABASE_PATH: ':memory:', NODE_ENV: 'test' } },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }]
});
