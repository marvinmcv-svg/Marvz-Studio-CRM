import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a production build serving the bundled demo data
 * (read-only, no database needed). Run:  npm run build && npm run test:e2e
 * Screenshots of every page land in test-results/screens/<project>/.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/manifest.webmanifest`,
    reuseExistingServer: true,
    env: { SQUAD_ALLOW_DEMO: "1" },
    timeout: 60_000,
  },
  projects: [
    { name: "desktop-light", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, colorScheme: "light" } },
    { name: "desktop-dark", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, colorScheme: "dark" } },
    { name: "ipad", use: { ...devices["iPad Pro 11"], browserName: "chromium", colorScheme: "light" } },
    { name: "iphone-light", use: { ...devices["iPhone 15"], browserName: "chromium", colorScheme: "light" } },
    { name: "iphone-dark", use: { ...devices["iPhone 15"], browserName: "chromium", colorScheme: "dark" } },
  ],
});
