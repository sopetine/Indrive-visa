// Pixel baselines for the main screens. Run on the machine that created the baselines
// (AI Factory runs it locally); CI runs only tests/e2e because fonts render differently on Linux.
import base from "./playwright.config.mjs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  testDir: "./tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
});
