import { defineConfig, devices } from '@playwright/test';
import { BACKEND_URL, FRONTEND_URL } from './support/env';

/**
 * Playwright config for My Site's end-to-end suite.
 *
 * Scope is capped on purpose: `PROJECT_TODO.md`'s testing-strategy section calls for 3-5
 * critical journeys, "kept deliberately thin", because E2E tests are the slow, brittle tier of
 * the pyramid. Component tests (`frontend`, Vitest) and integration tests (`backend`,
 * Testcontainers) own breadth; this suite only proves the two halves work together end to end.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // Every journey shares one server-side dataset, and the contact form is rate-limited per
  // requester IP -- parallel workers would race on both. Serial execution is the honest choice
  // here rather than sprinkling retries over a suite that is genuinely order-sensitive.
  fullyParallel: false,
  workers: 1,

  // No local retries on purpose: a journey that only passes on the second attempt is a defect
  // in the test (or the app), and retries would hide it. CI gets one retry to absorb
  // infrastructure noise, not to paper over flakiness.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'setup',
      testDir: './setup',
      testMatch: /global\.setup\.ts/,
      teardown: 'teardown',
    },
    {
      name: 'teardown',
      testDir: './setup',
      testMatch: /global\.teardown\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  /**
   * Postgres is deliberately NOT managed here. There is no `docker-compose.yml` until Phase 5,
   * so the database is a `docker run` the developer owns (see e2e/README.md); wiring a
   * container's lifecycle into the test runner would mean the suite could drop a developer's
   * database on exit. The two application servers are fair game -- they are stateless
   * processes.
   *
   * `reuseExistingServer` is on outside CI, so an already-running `mvn spring-boot:run` /
   * `npm start` is used as-is instead of failing on a port clash.
   */
  webServer: [
    {
      command: 'mvn spring-boot:run -Dspring-boot.run.profiles=dev',
      cwd: '../backend',
      url: `${BACKEND_URL}/actuator/health`,
      reuseExistingServer: !process.env.CI,
      // Maven can spend minutes resolving dependencies on a cold ~/.m2 before Spring even starts.
      timeout: 300_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm start',
      cwd: '../frontend',
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
