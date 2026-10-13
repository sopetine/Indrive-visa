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
  checklist: {
    status: "available",
    message: "",
    warnings: ["Live web research was unavailable; verify with the authority."],
    items: [{ category: "document", text: "Valid passport", status: "supported", sources: [{ title: "Immigration office", url: "https://example.gov/apply" }], warnings: ["Live web research was unavailable; verify with the authority."] }],
  },
};

const actionReport = {
  ...report,
  critical: [
    { label: "Confirm passport validity", value: "Six months remaining", type: "rule", source: "https://example.gov/passport" },
    { label: "Check transit rules", value: "Before booking", type: "rule", source: "https://example.gov/transit" },
  ],
};

test("preparation progress restores only for the same opaque report identity", async ({ page }) => {
  await page.route("https://visa-advisor.sopetine.workers.dev/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionReport) });
  });
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible()) await disclaimer.click();
  await page.evaluate(() => localStorage.setItem("visa-advisor.checklist-progress.v1", JSON.stringify({
    Russian: ["Paris", "private trip comment"],
    ["a".repeat(64)]: ["not a completion flag"],
  })));
  await page.getByLabel(/Passport nationality/).fill("Russian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByLabel(/Comments/).fill("synthetic private comment");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  const checks = page.locator(".critical-step-checkbox");
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".before-you-book-progress")).toHaveText("2 of 2 complete");
  const saved = await page.evaluate(() => localStorage.getItem("visa-advisor.checklist-progress.v1"));
  expect(saved).toMatch(/^\{"[a-f0-9]{64}":\[true,true\]\}$/);
  for (const privateValue of ["synthetic private comment", "Russian", "Georgia", "Paris", "2026-11-11", "business", "entry"]) {
    expect(saved).not.toContain(privateValue);
  }
  expect(Object.values(JSON.parse(saved))[0].every((flag) => typeof flag === "boolean")).toBe(true);

  await page.reload();
  await expect(page.locator(".critical-step-checkbox").nth(0)).toBeChecked();
  await expect(page.locator(".critical-step-checkbox").nth(1)).toBeChecked();
  await expect(page.locator(".before-you-book-progress")).toHaveText("2 of 2 complete");

  await page.evaluate(() => { location.hash = "#/report?nat=Russian&from=Georgia&dst=Rome"; });
  await expect(page.locator(".critical-step-checkbox").nth(0)).not.toBeChecked();
  await expect(page.locator(".before-you-book-progress")).toHaveText("0 of 2 complete");
});

test("preparation checklist remains interactive when progress storage throws", async ({ page }) => {
  await page.route("https://visa-advisor.sopetine.workers.dev/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionReport) });
  });
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem;
    Object.defineProperty(Storage.prototype, "getItem", { configurable: true, value(key) {
      if (key === "visa-advisor.checklist-progress.v1") throw new Error("read denied");
      return Reflect.apply(originalGet, this, [key]);
    }});
  });
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible()) await disclaimer.click();
  await page.evaluate(() => { location.hash = "#/report?nat=Russian&from=Georgia&dst=Paris"; });
  await expect(page.locator(".critical-step-checkbox")).toHaveCount(2);
  await page.locator(".critical-step-checkbox").nth(0).check();
  await expect(page.locator(".before-you-book-progress")).toHaveText("1 of 2 complete");
});

test("preparation checklist remains interactive when progress writes throw", async ({ page }) => {
  await page.route("https://visa-advisor.sopetine.workers.dev/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionReport) });
  });
  await page.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, "setItem", { configurable: true, value(key, value) {
      if (key === "visa-advisor.checklist-progress.v1") throw new Error("write denied");
      return Reflect.apply(originalSet, this, [key, value]);
    }});
  });
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible()) await disclaimer.click();
  await page.evaluate(() => { location.hash = "#/report?nat=Russian&from=Georgia&dst=Paris"; });
  await expect(page.locator(".critical-step-checkbox")).toHaveCount(2);
  await page.locator(".critical-step-checkbox").nth(1).check();
  await expect(page.locator(".before-you-book-progress")).toHaveText("1 of 2 complete");
});

test("checklist progress is isolated by trip, comments, intent, and action-set identity", async ({ page }) => {
  await page.route("https://visa-advisor.sopetine.workers.dev/**", async (route) => {
    const input = route.request().postDataJSON();
    const payload = input.destination === "Tokyo"
      ? { ...actionReport, critical: actionReport.critical.slice(0, 1) }
      : actionReport;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible()) await disclaimer.click();
  await page.getByLabel(/Passport nationality/).fill("Russian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await page.locator(".critical-step-checkbox").first().check();
  const variants = [
    ["nat=Canadian&from=Georgia&dst=Paris", 2],
    ["nat=Russian&from=Armenia&dst=Paris", 2],
    ["nat=Russian&from=Georgia&dst=Rome", 2],
    ["nat=Russian&from=Georgia&dst=Paris&intent=airport-transit", 2],
    ["nat=Russian&from=Georgia&dst=Paris&comments=another-note", 2],
    ["nat=Russian&from=Georgia&dst=Tokyo", 1],
  ];
  for (const [query, count] of variants) {
    await page.evaluate((value) => { location.hash = `#/report?${value}`; }, query);
    await expect(page.locator(".critical-step-checkbox")).toHaveCount(count);
    await expect(page.locator(".before-you-book-progress")).toHaveText(`0 of ${count} complete`);
  }
});

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
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible().catch(() => false)) await disclaimer.click();
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
  expect(new URL(apiURL).searchParams.get("v")).toBe(`${promptHash}-sse1`);
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

test("streamed research lists unique result hosts and final source favicons without overflow", async ({ page }, testInfo) => {
  const streamedReport = { ...report, researchWarning: "", sources: [
    { title: "Authority", url: "https://example.gov/visa", domain: "example.gov" },
    { title: "Guide", url: "https://travel.example/guide", domain: "travel.example" },
  ], sourcesReturned: 2 };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate((finalReport) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (String(input).startsWith("https://visa-advisor.sopetine.workers.dev")) {
        const encoder = new TextEncoder();
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "query", query: "visa requirements" })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "result", url: "https://example.gov/visa" })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "result", url: "https://example.gov/other" })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "result", url: "https://travel.example/guide" })}\n\n`));
            setTimeout(() => { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "final", report: finalReport })}\n\n`)); controller.close(); }, 700);
          },
        }), { status: 200, headers: { "content-type": "text/event-stream" } }));
      }
      return nativeFetch(input, options);
    };
  }, streamedReport);
  await page.route("**/favicon.ico", (route) => route.abort());
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Russian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  const researching = page.locator("[data-researching-sites]");
  await expect(researching).toBeVisible();
  await expect(researching.locator("li")).toHaveCount(2);
  await expect(researching).toContainText("example.gov");
  await expect(researching).toContainText("travel.example");
  await expect(researching.locator("li").nth(0)).toContainText("example.gov");
  await expect(researching.locator("li").nth(1)).toContainText("travel.example");
  await expect(page.locator(".report-source-tag .site-favicon-fallback")).toHaveCount(2);
  expect(await page.locator(".report-source-tag .site-favicon-fallback").evaluateAll((icons) => icons.map((icon) => icon.dataset.faviconUrl))).toEqual([
    "https://example.gov/favicon.ico", "https://travel.example/favicon.ico",
  ]);
  await expect(researching).toBeHidden();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`visa-advisor-${width}.png`), fullPage: true });
  }
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

test("the logo returns home and clears entered and saved form details", async ({ page }) => {
  let workerCalls = 0;
  await page.route("https://visa-advisor.sopetine.workers.dev/", async (route) => {
    workerCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  const nationality = page.getByLabel(/Passport nationality/);
  const basedIn = page.getByLabel(/Based in/);
  const destination = page.getByLabel(/Destination city/);
  const comments = page.getByLabel(/Comments/);
  await nationality.fill("Russian");
  await basedIn.fill("Georgia");
  await destination.fill("Paris");
  await comments.fill("Private travel note");
  await page.getByLabel(/Trip intent/).selectOption("airport-transit");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
  const cachedReportRoute = page.url();
  const cachedReportKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("visa-advisor.report.")));
  expect(cachedReportKeys.length).toBeGreaterThan(0);

  const logo = page.getByRole("link", { name: /Visa Advisor — go to start/ });
  await logo.click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(nationality).toHaveValue("");
  await expect(basedIn).toHaveValue("");
  await expect(destination).toHaveValue("");
  await expect(comments).toHaveValue("");
  await expect(page.getByLabel(/Trip intent/)).toHaveValue("entry");
  await expect(page.locator("[data-view-pill]")).toBeHidden();
  await expect(page.locator(".field-error:visible")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Check requirements/ })).toBeDisabled();
  expect(await page.evaluate(() => ({
    local: localStorage.getItem("visa-advisor.last-input"),
    session: sessionStorage.getItem("visa-advisor.last-input"),
  }))).toEqual({ local: null, session: null });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("visa-advisor.report.")))).toEqual(expect.arrayContaining(cachedReportKeys));
  expect(workerCalls).toBe(1);

  await page.reload();
  await expect(nationality).toHaveValue("");
  await expect(basedIn).toHaveValue("");
  await expect(destination).toHaveValue("");
  await expect(comments).toHaveValue("");
  await expect(page.getByLabel(/Trip intent/)).toHaveValue("entry");
  await expect(page.locator("[data-view-pill]")).toBeHidden();
  await expect(page.getByRole("button", { name: /Check requirements/ })).toBeDisabled();
  expect(await page.evaluate(() => ({
    local: localStorage.getItem("visa-advisor.last-input"),
    session: sessionStorage.getItem("visa-advisor.last-input"),
  }))).toEqual({ local: null, session: null });

  await page.goto(cachedReportRoute);
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("visa-advisor.report.")))).toEqual(expect.arrayContaining(cachedReportKeys));

  await page.goto("/#/");
  await page.evaluate(() => localStorage.setItem("visa-advisor.last-input", JSON.stringify({
    nationality: "Canadian",
    from: "Tbilisi",
    destination: "London",
    comments: "Saved trip",
    tripIntent: "airport-transit",
  })));
  await page.reload();
  await expect(page.locator("[data-view-pill]")).toBeVisible();
  await expect(nationality).toHaveValue("Canadian");
  await expect(basedIn).toHaveValue("Tbilisi");
  await expect(destination).toHaveValue("London");
  await expect(comments).toHaveValue("Saved trip");
  await expect(page.getByLabel(/Trip intent/)).toHaveValue("airport-transit");
  await logo.click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator("[data-view-pill]")).toBeHidden();
  await expect(nationality).toHaveValue("");
  await expect(basedIn).toHaveValue("");
  await expect(destination).toHaveValue("");
  await expect(comments).toHaveValue("");
  await expect(page.getByLabel(/Trip intent/)).toHaveValue("entry");
  expect(await page.evaluate(() => ({
    local: localStorage.getItem("visa-advisor.last-input"),
    session: sessionStorage.getItem("visa-advisor.last-input"),
  }))).toEqual({ local: null, session: null });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("visa-advisor.report.")))).toEqual(expect.arrayContaining(cachedReportKeys));

  await basedIn.fill("Tbilisi");
  await destination.fill("London");
  await page.evaluate(() => document.querySelector("[data-form]").requestSubmit());
  await expect(page.locator('[data-error-for="nationality"]')).toBeVisible();
  await logo.click();
  await expect(nationality).toHaveValue("");
  await expect(basedIn).toHaveValue("");
  await expect(destination).toHaveValue("");
  await expect(comments).toHaveValue("");
  await expect(page.getByLabel(/Trip intent/)).toHaveValue("entry");
  await expect(page.locator("[data-view-pill]")).toBeHidden();
  await expect(page.locator(".field-error:visible")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Check requirements/ })).toBeDisabled();
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

test("successful report has accessible print action and privacy-safe printable content", async ({ page }, testInfo) => {
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
  await expect(page.getByRole("heading", { name: "Verified documents and next steps" })).toBeVisible();
  await expect(page.locator(".evidence-checklist")).toContainText("Supported");
  await expect(page.locator(".evidence-checklist")).toContainText("Live web research was unavailable");
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("checklist-desktop.png"), fullPage: true });
  await page.emulateMedia({ media: "print" });
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

test("print fallback preserves report and narrow layout has no horizontal overflow", async ({ page }, testInfo) => {
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
  await expect(page.locator(".evidence-checklist a")).toHaveAttribute("href", "https://example.gov/apply");
  await page.screenshot({ path: testInfo.outputPath("checklist-mobile.png"), fullPage: true });
  const dimensions = await page.locator("body").evaluate((el) => ({ body: el.scrollWidth, viewport: innerWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
});

test("report with no checklist evidence shows an honest unavailable state", async ({ page }) => {
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ...report, checklist: { status: "unavailable", items: [], message: "No checklist items could be verified against cited research.", warnings: [] }, sources: [], sourcesReturned: 0 }),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect(page.locator(".evidence-checklist")).toContainText("No checklist items could be verified");
  await expect(page.locator(".evidence-checklist-item")).toHaveCount(0);
});

test("preparation actions toggle accessibly and leave cited evidence unchanged across themes and widths", async ({ page }, testInfo) => {
  const interactiveReport = {
    ...report,
    critical: [
      { label: "[MONEY] Confirm application fee", value: "Pay before arrival", source: "https://example.gov/fee", type: "money" },
      { label: "[ENTRY] Check entry conditions", value: "Bring a printed confirmation", source: "https://example.gov/entry", type: "entry" },
    ],
  };
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(interactiveReport) })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();

  const actions = page.locator(".critical-step-checkbox");
  await expect(actions).toHaveCount(2);
  await expect(actions.nth(0)).toHaveAccessibleName("Confirm application fee Pay before arrival");
  const progress = page.locator(".before-you-book-progress");
  await expect(progress).toHaveText("0 of 2 complete");
  const evidence = page.locator(".evidence-checklist");
  const snapshot = await evidence.evaluate((el) => ({ text: el.innerText, links: [...el.querySelectorAll("a")].map((a) => [a.textContent, a.href]) }));
  expect(await page.locator(".before-you-book").evaluate((el) => el.compareDocumentPosition(document.querySelector(".evidence-checklist")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();

  await page.getByLabel("Confirm application fee Pay before arrival").click();
  await expect(actions.nth(0)).toBeChecked();
  await expect(progress).toHaveText("1 of 2 complete");
  for (let step = 0; step < 20; step += 1) {
    if (await actions.nth(1).evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(actions.nth(1)).toBeFocused();
  expect(await actions.nth(1).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Space");
  await expect(actions.nth(1)).toBeChecked();
  await expect(progress).toHaveText("2 of 2 complete");
  await actions.nth(1).click();
  await expect(actions.nth(1)).not.toBeChecked();
  await expect(progress).toHaveText("1 of 2 complete");
  expect(await evidence.evaluate((el) => ({ text: el.innerText, links: [...el.querySelectorAll("a")].map((a) => [a.textContent, a.href]) }))).toEqual(snapshot);
  await expect(page.locator(".before-you-book [aria-live='polite'][aria-atomic='true']")).toHaveCount(1);

  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    if (colorScheme === "dark") {
      const verify = page.locator(".critical-step-verify").first();
      await expect(verify).toBeVisible();
      const { color, backgroundColor } = await verify.evaluate((el) => {
        const style = getComputedStyle(el);
        return { color: style.color, backgroundColor: style.backgroundColor };
      });
      const luminance = (rgb) => {
        const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const contrast = (Math.max(luminance(color), luminance(backgroundColor)) + 0.05) /
        (Math.min(luminance(color), luminance(backgroundColor)) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(actions.nth(0)).toBeVisible();
      await expect(progress).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`preparation-${colorScheme}-${width}.png`), fullPage: true });
    }
  }
});
