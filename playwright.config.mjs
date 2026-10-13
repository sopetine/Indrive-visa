import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";

const port = process.env.PLAYWRIGHT_TEST_PORT ?? execFileSync(
  process.execPath,
  ["scripts/find-free-port.mjs"],
  { encoding: "utf8" },
).trim();
process.env.PLAYWRIGHT_TEST_PORT = port;
const testServerUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: testServerUrl,
    headless: true,
    timezoneId: "Asia/Tbilisi",
  },
  webServer: {
    command: `python3 -m http.server ${port} --directory visa-advisor --bind 127.0.0.1`,
    url: testServerUrl,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
