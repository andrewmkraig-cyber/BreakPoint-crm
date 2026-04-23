import { defineConfig, devices } from "@playwright/test";

// Smoke-test runner. Spins up `next dev` on a dedicated port so it doesn't
// collide with a long-running dev server the recruiter may already have
// open on :3000. Points tests at http://localhost:3456.
//
// CI sets PLAYWRIGHT_BASE_URL explicitly; local runs fall back to the
// auto-started dev server.

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3456);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 120_000, // Next.js cold-compile on first request can push ~30s
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // `next dev` picks up .env.local automatically, which is how the
        // local run gets DATABASE_URL / NEXTAUTH_SECRET / the RF token.
        // CI runs inline `next dev` in a step and sets PLAYWRIGHT_BASE_URL
        // so this block is skipped.
        command: `npx next dev -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
