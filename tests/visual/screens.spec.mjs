// Visual baselines. When a change is meant to alter these screens, update them with
// `npm run test:visual -- --update-snapshots` and say so in the change summary.
import { test, expect } from "@playwright/test";

const report = {
  type: "report",
  markdown: ["### Visa status", "Embassy / consulate visa required", "", "### Allowed stay", "90 days within any 180-day period", "", "### Required documents", "- Required: Valid passport", "", "### Official application", "https://example.gov/apply"].join("\n"),
  sources: [{ title: "Immigration office", url: "https://example.gov/apply", domain: "example.gov" }],
  sourcesReturned: 1,
  checklist: { status: "available", message: "", warnings: [], items: [{ category: "document", text: "Valid passport", status: "supported", sources: [{ title: "Immigration office", url: "https://example.gov/apply" }], warnings: [] }] },
};

for (const theme of ["light", "dark"]) {
  for (const width of [1440, 390]) {
    test(`form and report · ${theme} · ${width}px`, async ({ page }) => {
      // Deterministic screens: fixed date, no outside network, explicit theme class (the app's control overrides the system setting).
      await page.clock.setFixedTime(new Date("2026-10-20T10:00:00+04:00"));
      await page.addInitScript(() => localStorage.setItem("visa-advisor.disclaimer", "v1"));
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|fonts\.googleapis\.com|fonts\.gstatic\.com)/, (route) => route.abort());
      await page.route("https://visa-advisor.sopetine.workers.dev/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) }));
      await page.goto("/");
      await page.evaluate((name) => { document.body.classList.remove("theme-light", "theme-dark"); document.body.classList.add(name); }, `theme-${theme}`);
      await expect(page).toHaveScreenshot(`form-${theme}-${width}.png`, { fullPage: true });
      await page.getByLabel(/Passport nationality/).fill("Indian");
      await page.getByLabel(/Based in/).fill("Georgia");
      await page.getByLabel(/Destination city/).fill("Paris");
      await page.getByRole("button", { name: /Check requirements/ }).click();
      await expect(page.locator(".status-badge")).toBeVisible();
      await expect(page).toHaveScreenshot(`report-${theme}-${width}.png`, { fullPage: true });
    });

    test(`research progress · ${theme} · ${width}px`, async ({ page }) => {
      let release;
      await page.clock.setFixedTime(new Date("2026-10-20T10:00:00+04:00"));
      await page.addInitScript(() => localStorage.setItem("visa-advisor.disclaimer", "v1"));
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|fonts\.googleapis\.com|fonts\.gstatic\.com)/, (route) => route.abort());
      await page.route("https://visa-advisor.sopetine.workers.dev/", async (route) => {
        await new Promise((resolve) => { release = resolve; });
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) });
      });
      await page.goto("/");
      await page.evaluate((name) => { document.body.classList.remove("theme-light", "theme-dark"); document.body.classList.add(name); }, `theme-${theme}`);
      await page.getByLabel(/Passport nationality/).fill("Indian");
      await page.getByLabel(/Based in/).fill("Georgia");
      await page.getByLabel(/Destination city/).fill("Paris");
      await page.getByRole("button", { name: /Check requirements/ }).click();
      await expect(page.locator("[data-action-bar-progress]")).toBeVisible();
      await expect(page.locator("[data-report-loading]")).toBeVisible();
      await expect(page.locator("[data-researching-sites]")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page).toHaveScreenshot(`progress-${theme}-${width}.png`, { fullPage: true });
      await expect.poll(() => typeof release).toBe("function");
      release();
      await expect(page.locator(".status-badge")).toBeVisible();
    });
  }
}
