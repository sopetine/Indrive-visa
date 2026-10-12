import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const prompt = readFileSync(new URL("../../visa-advisor/visa-advisor-prompt.md", import.meta.url), "utf8").trim();
const promptHash = createHash("sha256").update(prompt).digest("hex");

const report = {
  type: "report",
  markdown: [
    "### Visa status",
    "Visa-free",
    "",
    "### Required documents",
    "- Required: Valid passport",
    "",
    "### Official application",
    "https://example.gov/apply",
  ].join("\n"),
  sources: [{ title: "Immigration office", url: "https://example.gov/apply", domain: "example.gov" }],
  sourcesReturned: 1,
  researchWarning: "Live web research was unavailable; this result is not confirmed.",
};

test("required route, private comments, distinct trip context, and research warning work end to end", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-10T20:30:00Z") });
  let calls = 0;
  let promptURL;
  let apiURL;
  const submitted = [];
  await page.route("**/js/api.js*", async (route) => {
    apiURL = route.request().url();
    await route.continue();
  });
  await page.route("**/visa-advisor-prompt.md*", async (route) => {
    promptURL = route.request().url();
    await route.continue();
  });
  await page.route("https://visa-advisor.sopetine.workers.dev/", async (route) => {
    calls += 1;
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  const submit = page.getByRole("button", { name: /Check requirements/ });
  await expect(submit).toBeDisabled();
  await page.getByLabel(/Passport nationality/).fill("Russian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await expect(submit).toBeDisabled();
  await page.getByLabel(/Destination city/).fill("Munich");
  await page.getByLabel(/Comments/).fill("Dual citizenship; passport detail");
  await submit.click();
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Live web research was unavailable");
  await expect.poll(() => calls).toBe(1);
  expect(submitted[0].comments).toContain("passport detail");
  expect(new URL(apiURL).searchParams.get("v")).toBe(promptHash);
  expect(new URL(promptURL).searchParams.get("v")).toBe(promptHash);
  expect(submitted[0].systemPrompt).toBeTruthy();
  expect(submitted[0].tripIntent).toBe("entry", "missing intent should retain entry behavior");
  expect(submitted[0].date).toBe("2026-11-11", "report date should use the traveler's local calendar day");
  expect(page.url()).not.toContain("passport%20detail");

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel(/Comments/).fill("Business travel, no special status");
  await submit.click();
  await expect.poll(() => calls).toBe(2);
  expect(submitted[1].comments).toContain("no special status");
});

test("airport transit is submitted, shareable, and has a separate report cache entry", async ({ page }) => {
  const submitted = [];
  await page.route("https://visa-advisor.sopetine.workers.dev/", async (route) => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Russian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByLabel(/Trip intent/).selectOption("airport-transit");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
  expect(submitted[0].tripIntent).toBe("airport-transit");
  expect(page.url()).toContain("intent=airport-transit");
  const transitCacheKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("visa-advisor.report.")));

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel(/Trip intent/)).toHaveValue("airport-transit");
  await page.getByLabel(/Trip intent/).selectOption("entry");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted[1].tripIntent).toBe("entry");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("visa-advisor.report.")));
  expect(keys).toHaveLength(2);
  expect(keys).not.toEqual(transitCacheKeys);
});

test("required disclaimer keeps keyboard focus inside until accepted", async ({ page }) => {
  await page.goto("/");
  const ack = page.getByRole("button", { name: "I understand" });
  await expect(ack).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(ack).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(ack).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-modal]")).toBeVisible();
  await expect(page.getByLabel(/Passport nationality/)).not.toBeFocused();
});

test("unverified application URLs are not presented as official", async ({ page }) => {
  const unverified = {
    ...report,
    markdown: report.markdown.replace("https://example.gov/apply", "https://gov.com/apply"),
    sources: [{ title: "Official authority", url: "https://gov.com/apply", domain: "gov.com" }],
  };
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unverified) })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect(page.getByRole("link", { name: "Open link" })).toHaveAttribute("href", "https://gov.com/apply");
  await expect(page.getByRole("heading", { name: /verify before sharing details/i })).toBeVisible();
});

test("insecure government URLs are not presented as official", async ({ page }) => {
  const unverified = {
    ...report,
    markdown: report.markdown.replace("https://example.gov/apply", "http://service.gov.uk/apply"),
    sources: [{ title: "Government authority", url: "http://service.gov.uk/apply", domain: "service.gov.uk" }],
  };
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unverified) })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect(page.getByRole("link", { name: "Open link" })).toHaveAttribute("href", "http://service.gov.uk/apply");
  await expect(page.getByRole("heading", { name: /verify before sharing details/i })).toBeVisible();
});

test("research progress stays indeterminate until the report is ready", async ({ page }) => {
  let release;
  await page.route("https://visa-advisor.sopetine.workers.dev/", async (route) => {
    await new Promise((resolve) => { release = resolve; });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  const fill = page.locator("[data-action-bar-progress-fill]");
  await expect(fill).toHaveClass(/is-indeterminate/);
  await expect(fill).toHaveAttribute("style", /width: 0%/);
  await expect.poll(() => typeof release).toBe("function");
  release();
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
  await expect(fill).not.toHaveClass(/is-indeterminate/);
});

test("the form remains usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  const width = await page.locator("body").evaluate((el) => ({
    body: el.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.body).toBeLessThanOrEqual(width.viewport);
});

test("the form and report still work when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException("Storage is disabled", "SecurityError"); } });
    }
  });
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
});

test("corrupted saved form data falls back to the form", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("visa-advisor.last-input", "{"));
  await page.goto("/#/report");
  await expect(page.getByLabel(/Passport nationality/)).toBeVisible();
});

test("successful report has accessible print action and privacy-safe printable content", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-10T20:30:00Z") });
  await page.addInitScript(() => { window.printCalls = 0; window.print = () => { window.printCalls += 1; }; });
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByLabel(/Comments/).fill("PRIVATE NOTE SHOULD NOT PRINT");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  const print = page.getByRole("button", { name: "Print / Save as PDF" });
  await expect(print).toBeVisible();
  await expect(page.locator("[data-print-route]")).toContainText("Paris");
  await expect(page.locator("[data-print-date]")).toHaveText("2026-11-11");
  await print.focus();
  await expect(print).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.printCalls)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-print-header]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Required documents" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Live web research was unavailable");
  await expect(page.locator('[data-view="report"] a[href="https://example.gov/apply"]').first()).toHaveAttribute("href", "https://example.gov/apply");
  await expect(page.locator("[data-report-body]")).not.toContainText("PRIVATE NOTE SHOULD NOT PRINT");
  const wrapped = await page.locator('[data-view="report"] a[href="https://example.gov/apply"]').first().evaluate((el) => getComputedStyle(el, "::after").content);
  expect(wrapped).toContain("https://example.gov/apply");
  await expect(page.locator("[data-action-bar-progress]")).toBeHidden();
  await expect(page.locator("[data-print-fallback]")).toBeHidden();
  const printStyles = await page.locator("[data-view=report]").evaluate((el) => getComputedStyle(el.querySelector(".action-bar")).display);
  expect(printStyles).toBe("none");
});

test("print fallback preserves report and narrow layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { window.print = () => { throw new Error("blocked"); }; });
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await page.getByRole("button", { name: "Print / Save as PDF" }).click();
  await expect(page.locator("[data-print-fallback]")).toContainText("Use your browser menu");
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
  const dimensions = await page.locator("body").evaluate((el) => ({ body: el.scrollWidth, viewport: innerWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
});
