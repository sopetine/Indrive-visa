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
    { label: "Confirm passport validity before starting the long official application process for your selected travel route", value: "Six months remaining", type: "rule", source: "https://example.gov/passport/" + "verification-details-".repeat(9) },
    { label: "Check transit rules", value: "Before booking", type: "rule", source: "https://example.gov/transit" },
  ],
};

test("advisor form validation is accessible and clears as required fields are edited", async ({ page }) => {
  const submitted = [];
  await page.route("https://visa-advisor.sopetine.workers.dev/", async (route) => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) });
  });
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible().catch(() => false)) await disclaimer.click();

  const submit = page.getByRole("button", { name: /Check requirements/ });
  await expect(submit).toBeDisabled();
  await page.locator("[data-form]").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  for (const [id, error] of [
    ["input-nationality", "Enter your nationality"],
    ["input-from", "Enter where you're based"],
    ["input-destination", "Enter a destination city"],
  ]) {
    const control = page.locator(`#${id}`);
    await expect(control).toHaveAttribute("aria-invalid", "true");
    const describedBy = await control.getAttribute("aria-describedby");
    expect(describedBy).toContain(`field-error-${id.replace("input-", "")}`);
    await expect(page.locator(`#field-error-${id.replace("input-", "")}`)).toHaveText(error);
    const label = page.locator(`label[for="${id}"]`);
    await expect(label).toHaveCount(1);
  }
  await expect(submit).toBeDisabled();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await expect(page.locator("#input-nationality")).not.toHaveAttribute("aria-invalid");
  await expect(page.locator("#nationality-hint")).toBeVisible();
  await expect(page.locator("#field-error-nationality")).toBeHidden();
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await expect(submit).toBeEnabled();

  for (const [width, height] of [[1440, 900], [900, 720], [600, 720], [390, 680]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      rowColumns: getComputedStyle(document.querySelector("[data-field-row]")).gridTemplateColumns,
      formVisible: document.querySelector("[data-form]").getBoundingClientRect().width > 0,
    }));
    expect(layout.document).toBeLessThanOrEqual(layout.viewport);
    expect(layout.formVisible).toBe(true);
    if (width <= 600) expect(layout.rowColumns.split(" ")).toHaveLength(1);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.locator("[data-submit]").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(":focus")).toHaveAttribute("id", "input-comments");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(":focus")).toHaveAttribute("id", "input-trip-intent");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(":focus")).toHaveAttribute("id", "input-destination");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(":focus")).toHaveAttribute("id", "input-from");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(":focus")).toHaveAttribute("id", "input-nationality");
  await page.locator("[data-submit]").focus();
  await page.locator("[data-submit]").click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toMatchObject({ nationality: "Canadian", from: "Georgia", destination: "Paris", purpose: "business", tripIntent: "entry" });
  expect(submitted[0].comments || "").toBe("");
});

test("form introduction is a responsive hero labelled by its accessible heading", async ({ page }) => {
  await page.goto("/");
  const formView = page.locator('[data-view="form"]');
  const heading = formView.getByRole("heading", { level: 1 });
  await expect(formView).toHaveAttribute("aria-labelledby", "form-title");
  await expect(heading).toHaveAttribute("id", "form-title");
  await expect(heading).toHaveText(/Visa requirements,\s*in seconds\./);
  await expect(formView.locator(".form-subtitle")).toHaveText(
    "Check entry requirements for your trip, with live research and links to the sources.",
  );

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await formView.locator(".form-intro").evaluate((hero) => {
      const title = hero.querySelector("h1");
      const subtitle = hero.querySelector(".form-subtitle");
      return {
        background: getComputedStyle(hero).backgroundColor,
        titleFontSize: parseFloat(getComputedStyle(title).fontSize),
        heroWidth: hero.getBoundingClientRect().width,
        titleWidth: title.scrollWidth,
        titleClientWidth: title.clientWidth,
        subtitleWidth: subtitle.scrollWidth,
        subtitleClientWidth: subtitle.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(layout.background).toBe("rgb(193, 241, 29)");
    expect(layout.titleFontSize).toBeGreaterThanOrEqual(38);
    expect(layout.titleWidth).toBeLessThanOrEqual(layout.titleClientWidth);
    expect(layout.subtitleWidth).toBeLessThanOrEqual(layout.subtitleClientWidth);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
});

test("form visual baseline is captured at required sizes and compact heights", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("visa-advisor.disclaimer", "v1"));
  await page.goto("/");
  const form = page.locator('[data-view="form"]');

  for (const [width, theme] of [[1440, "light"], [390, "light"], [1440, "dark"], [390, "dark"]]) {
    await page.setViewportSize({ width, height: 844 });
    for (let attempt = 0; attempt < 3 && await page.locator("body").getAttribute("class") !== `theme-${theme}`; attempt += 1) {
      await page.locator("[data-theme-control]").click();
    }
    await expect(page.locator("body")).toHaveClass(`theme-${theme}`);
    await expect(form).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`form-${theme}-${width}.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 680 });
  const compact = await page.evaluate(() => {
    const intro = document.querySelector(".form-intro");
    const advisorForm = document.querySelector(".advisor-form");
    const submit = document.querySelector("[data-submit]");
    const field = document.querySelector("#input-nationality");
    const box = (element) => element.getBoundingClientRect();
    return {
      introPaddingTop: getComputedStyle(intro).paddingTop,
      formPaddingTop: getComputedStyle(advisorForm).paddingTop,
      formGap: getComputedStyle(advisorForm).rowGap,
      fieldVisible: box(field).width > 0 && box(field).height > 0,
      submitVisible: box(submit).width > 0 && box(submit).height > 0,
      submitReachableByScroll: box(submit).top < document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    };
  });
  expect(compact.introPaddingTop).toBe("24px");
  expect(compact.formPaddingTop).toBe("20px");
  expect(compact.formGap).toBe("12px");
  expect(compact.fieldVisible).toBe(true);
  expect(compact.submitVisible).toBe(true);
  expect(compact.submitReachableByScroll).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("form-compact-390x680.png"), fullPage: true });
});

test("mast branding, keyboard theme control, and responsive widths", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("visa-advisor.disclaimer", "v1"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("link", { name: "Visa Advisor — go to start" })).toBeVisible();
  await expect(page.getByText("TRAVEL REQUIREMENTS")).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Site controls" });
  const theme = navigation.getByRole("button", { name: /Theme: Light/ });
  await theme.focus();
  await expect(theme).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await expect(navigation.getByRole("button", { name: /Theme: Dark/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(page.locator("body")).not.toHaveClass(/theme-light|theme-dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor)).toBe("rgb(20, 22, 18)");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveClass(/theme-light/);

  for (const width of [1440, 901, 900, 601, 600, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const sizes = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      mastHeight: document.querySelector(".site-header--advisor").getBoundingClientRect().height,
    }));
    expect(sizes.document, `document overflow at ${width}px`).toBeLessThanOrEqual(sizes.viewport);
    expect(sizes.mastHeight, `mast height at ${width}px`).toBe(width <= 900 ? 66 : 80);
  }
});

test("shared focus indicators follow theme tokens and reduced motion suppresses effects", async ({ page }) => {
  await page.goto("/");
  await page.locator(".logo").focus();
  await page.keyboard.press("Shift+Tab");
  const skipLink = page.locator(".skip-link");
  await expect(skipLink).toBeFocused();

  for (const theme of ["theme-light", "theme-dark"]) {
    await page.locator("body").evaluate((body, themeClass) => {
      body.classList.remove("theme-light", "theme-dark");
      body.classList.add(themeClass);
    }, theme);
    const focus = await skipLink.evaluate((node) => ({
      outlineStyle: getComputedStyle(node).outlineStyle,
      outlineColor: getComputedStyle(node).outlineColor,
      expectedColor: (() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-focus)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })(),
      landmark: Boolean(document.querySelector("main")),
    }));
    expect(focus.outlineStyle).toBe("solid");
    expect(focus.outlineColor).toBe(focus.expectedColor);
    expect(focus.landmark).toBe(true);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.evaluate(() => ({
    viewAnimation: getComputedStyle(document.querySelector(".view")).animationName,
    buttonTransition: getComputedStyle(document.querySelector(".btn")).transitionDuration,
    progressAnimation: getComputedStyle(document.querySelector(".action-bar-progress-fill")).animationName,
  }));
  expect(motion.viewAnimation).toBe("none");
  expect(motion.buttonTransition.split(",").every((duration) => parseFloat(duration) === 0)).toBe(true);
  expect(motion.progressAnimation).toBe("none");
});

test("checklist print is conditional, focused, one-shot, and preserves progress", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-11T12:00:00+04:00") });
  await page.route("https://visa-advisor.sopetine.workers.dev/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionReport) })
  );
  await page.addInitScript(() => {
    window.__printModes = [];
    window.print = () => window.__printModes.push(document.documentElement.getAttribute("data-checklist-print"));
  });
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible()) await disclaimer.click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByLabel(/Comments/).fill("PRIVATE NOTE: keep this out of the printed checklist");
  await page.getByRole("button", { name: /Check requirements/ }).click();

  const checklist = page.locator(".before-you-book");
  const printChecklist = page.getByRole("button", { name: "Print checklist" });
  await expect(checklist).toContainText("Before you book");
  await expect(printChecklist).toBeVisible();
  const checkboxes = page.locator(".critical-step-checkbox");
  await checkboxes.first().check();
  const flagsBefore = await checkboxes.evaluateAll((nodes) => nodes.map((node) => node.checked));
  const progressBefore = await page.evaluate(() => localStorage.getItem("visa-advisor.checklist-progress.v1"));

  await printChecklist.click();
  await expect.poll(() => page.evaluate(() => window.__printModes.length)).toBe(1);
  expect(await page.evaluate(() => window.__printModes[0])).toBe("true");
  await page.emulateMedia({ media: "print" });
  const printPresentation = await page.evaluate(() => ({
    header: getComputedStyle(document.querySelector(".print-report-header")).visibility,
    checklist: getComputedStyle(document.querySelector(".before-you-book")).display,
    otherContent: [...document.querySelectorAll(".report-body > :not(.before-you-book)")].map((node) => getComputedStyle(node).display),
    checkbox: getComputedStyle(document.querySelector(".critical-step-checkbox")).appearance,
    linkDestinations: [...document.querySelectorAll(".critical-step-verify")].map((link) => ({
      href: link.getAttribute("href"),
      printed: getComputedStyle(link, "::after").content,
    })),
    privateComment: getComputedStyle(document.querySelector(".comments-textarea")).visibility,
    privateCommentFormVisibility: getComputedStyle(document.querySelector(".comments-textarea").closest("form")).visibility,
    privateCommentValue: document.querySelector(".comments-textarea").value,
    layout: (() => {
      const checklist = document.querySelector(".before-you-book");
      const longLabel = document.querySelector(".critical-step-label");
      const longLink = document.querySelector(".critical-step-verify");
      return {
        checklistScroll: checklist.scrollWidth,
        checklistClient: checklist.clientWidth,
        documentScroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        documentClient: Math.min(document.documentElement.clientWidth, document.body.clientWidth),
        labelWrap: getComputedStyle(longLabel).overflowWrap,
        linkWrap: getComputedStyle(longLink).overflowWrap,
        linkWhiteSpace: getComputedStyle(longLink).whiteSpace,
      };
    })(),
  }));
  expect(printPresentation.header).toBe("visible");
  expect(printPresentation.checklist).toBe("block");
  expect(printPresentation.otherContent.every((display) => display === "none")).toBe(true);
  expect(printPresentation.checkbox).toBe("auto");
  expect(printPresentation.linkDestinations).toHaveLength(2);
  expect(printPresentation.linkDestinations[0].href).toBe(actionReport.critical[0].source);
  expect(printPresentation.linkDestinations[0].printed).toContain(actionReport.critical[0].source);
  expect(printPresentation.linkDestinations[1].href).toBe(actionReport.critical[1].source);
  expect(printPresentation.linkDestinations[1].printed).toContain(actionReport.critical[1].source);
  expect(printPresentation.privateComment).not.toBe("visible");
  expect(printPresentation.privateCommentFormVisibility).not.toBe("visible");
  expect(printPresentation.privateCommentValue).toContain("PRIVATE NOTE");
  expect(printPresentation.layout.checklistScroll).toBeLessThanOrEqual(printPresentation.layout.checklistClient);
  expect(printPresentation.layout.documentScroll).toBeLessThanOrEqual(printPresentation.layout.documentClient);
  expect(printPresentation.layout.labelWrap).toMatch(/anywhere|break-word/);
  expect(printPresentation.layout.linkWrap).toMatch(/anywhere|break-word/);
  expect(printPresentation.layout.linkWhiteSpace).toBe("normal");
  await expect(page.locator("[data-print-route]")).toContainText("Paris");
  await expect(page.locator("[data-print-date]")).toHaveText("2026-11-11");
  await expect(checklist).toContainText("1 of 2 complete");
  await expect(checklist).toContainText(actionReport.critical[0].label);
  await expect(checklist).toContainText("Six months remaining");
  await expect(checklist).toContainText(actionReport.critical[1].label);
  await expect(checklist).toContainText("Before booking");
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).not.toBeChecked();
  expect(await checkboxes.evaluateAll((nodes) => nodes.map((node) => node.checked))).toEqual(flagsBefore);
  expect(await page.evaluate(() => localStorage.getItem("visa-advisor.checklist-progress.v1"))).toBe(progressBefore);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("html")).not.toHaveAttribute("data-checklist-print");
  expect(await checkboxes.evaluateAll((nodes) => nodes.map((node) => node.checked))).toEqual(flagsBefore);
  expect(await page.evaluate(() => localStorage.getItem("visa-advisor.checklist-progress.v1"))).toBe(progressBefore);

  await printChecklist.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__printModes.length)).toBe(2);
  expect(await page.evaluate(() => window.__printModes.length)).toBe(2);
  expect(await page.evaluate(() => window.__printModes[1])).toBe("true");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  expect(await checkboxes.evaluateAll((nodes) => nodes.map((node) => node.checked))).toEqual(flagsBefore);
  expect(await page.evaluate(() => localStorage.getItem("visa-advisor.checklist-progress.v1"))).toBe(progressBefore);
});

test("checklist print control is absent when the report has no booking actions", async ({ page }) => {
  await page.route("https://visa-advisor.sopetine.workers.dev/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) })
  );
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible()) await disclaimer.click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect(page.getByRole("button", { name: "Print checklist" })).toHaveCount(0);
});

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
  await page.locator(".critical-step-checkbox").nth(1).check();
  await page.getByRole("button", { name: "Reset progress" }).click();
  await expect(page.locator(".critical-step-checkbox:checked")).toHaveCount(0);
  await expect(page.locator(".before-you-book-progress")).toHaveText("0 of 2 complete");
  await page.locator(".critical-step-checkbox").nth(1).check();
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
  await page.locator(".critical-step-checkbox").nth(0).check();
  await page.locator(".critical-step-checkbox").nth(1).check();
  await page.getByRole("button", { name: "Reset progress" }).click();
  await expect(page.locator(".critical-step-checkbox:checked")).toHaveCount(0);
  await expect(page.locator(".before-you-book-progress")).toHaveText("0 of 2 complete");
  await page.locator(".critical-step-checkbox").nth(1).check();
  await expect(page.locator(".before-you-book-progress")).toHaveText("1 of 2 complete");
});

test("reset progress clears only the current report and persists after reload", async ({ page }) => {
  await page.route("https://visa-advisor.sopetine.workers.dev/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionReport) });
  });
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible()) await disclaimer.click();
  await page.evaluate(() => localStorage.setItem("visa-advisor.checklist-progress.v1", JSON.stringify({
    ["a".repeat(64)]: [true, false],
  })));
  await page.evaluate(() => { location.hash = "#/report?nat=Russian&from=Georgia&dst=Paris"; });
  await expect(page.locator(".critical-step-checkbox")).toHaveCount(2);
  await page.locator(".critical-step-checkbox").first().check();
  await page.evaluate(() => { location.hash = "#/report?nat=Russian&from=Georgia&dst=Rome"; });
  await page.locator(".critical-step-checkbox").nth(1).check();
  const withB = await page.evaluate(() => JSON.parse(localStorage.getItem("visa-advisor.checklist-progress.v1")));
  const aId = Object.keys(withB).find((id) => id !== "a".repeat(64) && JSON.stringify(withB[id]) === "[true,false]");
  const bId = Object.keys(withB).find((id) => id !== "a".repeat(64) && id !== aId);
  expect(aId).toBeTruthy();
  expect(bId).toBeTruthy();
  await page.evaluate(() => { location.hash = "#/report?nat=Russian&from=Georgia&dst=Paris"; });
  await page.getByRole("button", { name: "Reset progress" }).click();
  await expect(page.locator(".critical-step-checkbox:checked")).toHaveCount(0);
  await expect(page.locator(".before-you-book-progress")).toHaveText("0 of 2 complete");
  await page.reload();
  await expect(page.locator(".before-you-book-progress")).toHaveText("0 of 2 complete");
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("visa-advisor.checklist-progress.v1")));
  expect(after[aId]).toEqual([false, false]);
  expect(after[bId]).toEqual([false, true]);
  expect(after["a".repeat(64)]).toEqual([true, false]);
});

test("reset progress is keyboard operable with a visible focus indicator", async ({ page }) => {
  await page.route("https://visa-advisor.sopetine.workers.dev/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionReport) });
  });
  await page.goto("/");
  const disclaimer = page.getByRole("button", { name: "I understand" });
  if (await disclaimer.isVisible()) await disclaimer.click();
  await page.getByLabel(/Passport nationality/).fill("Russian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  const reset = page.getByRole("button", { name: "Reset progress" });
  await reset.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(reset).toBeFocused();
  expect(await reset.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.locator(".before-you-book-progress")).toHaveText("0 of 2 complete");
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

test("research progress stays indeterminate until the report is ready", async ({ page }, testInfo) => {
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
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ["light", "dark"]) {
      for (let attempt = 0; attempt < 3 && await page.locator("body").getAttribute("class") !== `theme-${theme}`; attempt += 1) {
        await page.locator("[data-theme-control]").click();
      }
      await expect(page.locator("body")).toHaveClass(`theme-${theme}`);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`research-progress-${theme}-${width}.png`), fullPage: true });
    }
  }
  await expect.poll(() => typeof release).toBe("function");
  release();
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
  await expect(fill).not.toHaveClass(/is-indeterminate/);
});

test("research error retry and clarification remain operable across themes and widths", async ({ page }, testInfo) => {
  let requests = 0;
  await page.route("https://visa-advisor.sopetine.workers.dev/", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Service temporarily unavailable" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(requests === 2
      ? { type: "clarify", question: "Which passport will you travel on?" }
      : report) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();

  const error = page.locator("[data-report-error]");
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("role", "alert");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ["light", "dark"]) {
      await page.locator("[data-theme-control]").click();
      for (let attempt = 0; attempt < 3 && await page.locator("body").getAttribute("class") !== `theme-${theme}`; attempt += 1) {
        await page.locator("[data-theme-control]").click();
      }
      await expect(page.locator("body")).toHaveClass(`theme-${theme}`);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`report-error-${theme}-${width}.png`), fullPage: true });
    }
  }

  // Exercise the OS dark theme path, where the theme control removes explicit classes.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("[data-theme-control]").click();
  await expect(page.locator("body")).not.toHaveClass(/theme-/);
  const retry = page.getByRole("button", { name: /try again/i });
  await expect(retry).toHaveCSS("color", "rgb(20, 22, 18)");
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.press("Enter");
  const clarify = page.locator("[data-report-clarify]");
  await expect(clarify).toBeVisible();
  await expect(clarify).toContainText("Which passport will you travel on?");
  await page.screenshot({ path: testInfo.outputPath("report-clarification-dark-mobile.png"), fullPage: true });
  const answer = page.getByLabel("Your answer");
  await answer.focus();
  await expect(answer).toBeFocused();
  await answer.fill("Canadian passport");
  const sendAnswer = page.getByRole("button", { name: /send answer/i });
  await expect(sendAnswer).toBeEnabled();
  await expect(sendAnswer).toHaveCSS("color", "rgb(20, 22, 18)");
  await sendAnswer.click();
  await expect(page.getByText("Visa-free", { exact: true }).first()).toBeVisible();
});

test("malformed model tool-call output is shown as a retryable error, never as report content", async ({ page }) => {
  const malformed = "<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name=\"web_search\">";
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: "The AI provider returned an unrecognized response format. Please try again." }),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByLabel(/Passport nationality/).fill("Russian");
  await page.getByLabel(/Based in/).fill("Monaco");
  await page.getByLabel(/Destination city/).fill("Ukraine");
  await page.getByRole("button", { name: /Check requirements/ }).click();

  const error = page.locator("[data-report-error]");
  await expect(error).toBeVisible();
  await expect(error).toContainText(/try again/i);
  await expect(page.locator("[data-view=report]")).not.toContainText("Report format unrecognized");
  await expect(page.locator("[data-view=report]")).not.toContainText(malformed);
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
  await page.addInitScript(() => {
    window.printCalls = 0;
    window.printModes = [];
    window.print = () => {
      window.printCalls += 1;
      window.printModes.push(document.documentElement.getAttribute("data-checklist-print"));
    };
  });
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionReport) })
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
  expect(await page.evaluate(() => window.printModes)).toEqual([null]);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-print-header]")).toBeVisible();
  await expect(page.locator(".before-you-book")).toBeVisible();
  await expect(page.locator(".before-you-book")).toContainText(actionReport.critical[0].label);
  await expect(page.locator(".before-you-book")).toContainText("Six months remaining");
  await expect(page.locator(".before-you-book .critical-step-verify").first()).toHaveAttribute("href", actionReport.critical[0].source);
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
  await expect(page.locator(".before-you-book")).toContainText("Before you book");
  await expect(page.locator(".evidence-checklist")).toContainText("Valid passport");
  await expect(page.locator("[data-report-body]")).not.toContainText("PRIVATE NOTE SHOULD NOT PRINT");
  await expect(page.locator("[data-view=report]")).not.toContainText("PRIVATE NOTE SHOULD NOT PRINT");
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

  const verifyLink = page.locator(".critical-step-verify").first();
  await verifyLink.focus();
  await expect(verifyLink).toBeFocused();
  expect(await verifyLink.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  const evidenceLink = evidence.getByRole("link", { name: /Source: Immigration office/ });
  await evidenceLink.focus();
  await expect(evidenceLink).toBeFocused();
  expect(await evidenceLink.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await expect(evidence.locator('.evidence-checklist-item[data-status="supported"]')).toHaveCount(1);
  await expect(evidence.locator(".checklist-warning").first()).toBeVisible();

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
      await expect(evidenceLink).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`preparation-${colorScheme}-${width}.png`), fullPage: true });
    }
  }
});

test("semantic theme tokens support explicit light, explicit dark, and system fallback", async ({ page }) => {
  await page.goto("/");
  const token = (name) => page.locator("body").evaluate((body, key) => getComputedStyle(body).getPropertyValue(key).trim(), name);

  expect(await token("--color-lime")).toBe("#c1f11d");
  expect(await token("--color-ink")).toBe("#141414");
  expect(await token("--color-bg")).toBe("#fffee9");
  expect(await token("--color-muted")).toBe("#717465");
  expect(await token("--color-line")).toBe("#e8e8d9");
  expect(await token("--color-field")).toBe("#f4f4e9");
  expect(await token("--color-card-secondary")).toBe("#656b5c");
  expect(await token("--color-hover")).toBe("#f0efd9");
  expect(await token("--color-progress-done")).toBe("#edf3ce");
  expect(await token("--color-progress-done-text")).toBe("#536519");
  expect(await token("--color-error")).toBe("#a73523");

  await page.locator("body").evaluate((body) => body.classList.replace("theme-light", "theme-dark"));
  expect(await token("--color-bg")).toBe("#141612");
  expect(await token("--color-card")).toBe("#24271f");
  expect(await token("--color-field")).toBe("#20231c");
  expect(await token("--color-ink")).toBe("#f5f5ec");
  expect(await token("--main-white")).toBe("#24271f");
  expect(await token("--text-and-icon-primary")).toBe("#f5f5ec");
  expect(await token("--extensions-background-lighterror")).toBe("#592d29");
  expect(await token("--extensions-background-lightwarning")).toBe("#51451f");
  expect(await token("--extensions-background-lightsuccess")).toBe("#294631");
  expect(await token("--color-ink-on-lime")).toBe("#141414");
  const citedTag = await page.locator("body").evaluate((body) => {
    const tag = document.createElement("span");
    tag.className = "report-source-tag is-cited";
    body.append(tag);
    const style = getComputedStyle(tag);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  expect(citedTag).toEqual({ color: "rgb(20, 20, 20)", backgroundColor: "rgb(193, 241, 29)" });
  const statusContrast = await page.locator("body").evaluate((body) => {
    const style = getComputedStyle(body);
    const luminance = (hex) => {
      const channels = hex.trim().match(/[\da-f]{2}/gi).slice(-3).map((channel) => parseInt(channel, 16) / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    return [
      ["--extensions-text-and-icon-error", "--extensions-background-lighterror"],
      ["--extensions-text-and-icon-warning", "--extensions-background-lightwarning"],
      ["--extensions-text-and-icon-success", "--extensions-background-lightsuccess"],
    ].map(([foreground, background]) => {
      const values = [foreground, background].map((name) => style.getPropertyValue(name).trim());
      const [high, low] = values.map(luminance).sort((a, b) => b - a);
      return (high + 0.05) / (low + 0.05);
    });
  });
  for (const ratio of statusContrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
  const warningConsumerContrast = await page.locator("body").evaluate((body) => {
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    return ["icon-chip icon-chip--warn", "status-badge--evisa", "report-caveats", "report-critical"]
      .map((className) => {
        const element = document.createElement("div");
        element.className = className;
        body.append(element);
        const style = getComputedStyle(element);
        const [high, low] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
        return (high + 0.05) / (low + 0.05);
      });
  });
  for (const ratio of warningConsumerContrast) expect(ratio).toBeGreaterThanOrEqual(4.5);

  await page.locator("body").evaluate((body) => body.classList.remove("theme-dark"));
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await token("--color-bg")).toBe("#141612");
  expect(await token("--color-ink")).toBe("#f5f5ec");
});

test("rendered validation, report status, and checklist progress meet theme contrast and keyboard requirements", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("visa-advisor.disclaimer", "v1"));
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(actionReport) })
  );
  await page.goto("/");
  await page.locator("[data-form]").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

  const contrastRatio = (foreground, background) => {
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };
  const renderedColors = (element) => element.evaluate((node) => {
    const style = getComputedStyle(node);
    let ancestor = node;
    let backgroundColor = style.backgroundColor;
    while (ancestor && (backgroundColor === "rgba(0, 0, 0, 0)" || backgroundColor === "transparent")) {
      ancestor = ancestor.parentElement;
      if (ancestor) backgroundColor = getComputedStyle(ancestor).backgroundColor;
    }
    return { color: style.color, backgroundColor };
  });

  for (const theme of ["light", "dark"]) {
    await page.locator("body").evaluate((body, value) => {
      body.classList.remove("theme-light", "theme-dark");
      body.classList.add(`theme-${value}`);
    }, theme);
    const themeControl = page.locator("[data-theme-control]");
    await themeControl.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(themeControl).toBeFocused();
    const focusColors = await themeControl.evaluate((node) => {
      const style = getComputedStyle(node);
      let ancestor = node;
      let backgroundColor = style.backgroundColor;
      while (ancestor && (backgroundColor === "rgba(0, 0, 0, 0)" || backgroundColor === "transparent")) {
        ancestor = ancestor.parentElement;
        if (ancestor) backgroundColor = getComputedStyle(ancestor).backgroundColor;
      }
      return { outlineStyle: style.outlineStyle, outlineColor: style.outlineColor, backgroundColor };
    });
    expect(focusColors.outlineStyle, `${theme} rendered keyboard focus`).toBe("solid");
    expect(contrastRatio(focusColors.outlineColor, focusColors.backgroundColor), `${theme} focus indicator`).toBeGreaterThanOrEqual(3);

    const error = page.locator("#field-error-nationality");
    const errorColors = await renderedColors(error);
    expect(contrastRatio(errorColors.color, errorColors.backgroundColor), `${theme} validation text`).toBeGreaterThanOrEqual(4.5);

    await page.getByLabel(/Passport nationality/).fill("Canadian");
    await page.getByLabel(/Based in/).fill("Georgia");
    await page.getByLabel(/Destination city/).fill("Paris");
    await page.getByRole("button", { name: /Check requirements/ }).click();
    const status = page.locator(".report-status .status-badge");
    await expect(status).toBeVisible();
    const statusColors = await renderedColors(status);
    expect(contrastRatio(statusColors.color, statusColors.backgroundColor), `${theme} report status`).toBeGreaterThanOrEqual(4.5);

    const checkbox = page.locator(".critical-step-checkbox").first();
    await checkbox.focus();
    await expect(checkbox).toBeFocused();
    const progress = page.locator(".before-you-book-progress");
    const progressColors = await renderedColors(progress);
    expect(contrastRatio(progressColors.color, progressColors.backgroundColor), `${theme} checklist progress`).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => { location.hash = "#/"; });
    await page.waitForSelector('[data-view="form"]:not([hidden])');
  }
});

test("completed report cards, sources, and disclosures stay readable and keyboard visible", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("visa-advisor.disclaimer", "v1"));
  await page.route("https://visa-advisor.sopetine.workers.dev/", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...report, caveats: "Check entry rules with the destination authority before travel.", searchQueries: ["Paris visa requirements official authority" ] }) })
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByLabel(/Passport nationality/).fill("Canadian");
  await page.getByLabel(/Based in/).fill("Georgia");
  await page.getByLabel(/Destination city/).fill("Paris");
  await page.getByRole("button", { name: /Check requirements/ }).click();
  await expect(page.locator(".report-status")).toContainText("Visa-free");
  await expect(page.locator(".report-doc-group")).toContainText("Valid passport");
  await expect(page.locator(".report-caveats")).toBeVisible();
  await expect(page.locator(".report-research-warning")).toBeVisible();
  await expect(page.locator(".report-sources")).toContainText("example.gov");
  const disclosure = page.locator(".report-research-log");
  await expect(disclosure).toBeVisible();
  await disclosure.locator("summary").focus();
  await expect(disclosure.locator("summary")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(disclosure).not.toHaveAttribute("open", "");
  const source = page.locator(".report-source-tag").first();
  await source.focus();
  await expect(source).toBeFocused();
  expect(await source.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");

  for (const [width, theme] of [[1440, "light"], [390, "light"], [1440, "dark"], [390, "dark"]]) {
    await page.setViewportSize({ width, height: 844 });
    for (let attempt = 0; attempt < 3 && await page.locator("body").getAttribute("class") !== `theme-${theme}`; attempt += 1) {
      await page.locator("[data-theme-control]").click();
    }
    await expect(page.locator("body")).toHaveClass(`theme-${theme}`);
    const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(layout.document).toBeLessThanOrEqual(layout.viewport);
    const routeChip = await page.locator(".route-chip--alt").evaluate((el) => ({
      color: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundColor,
      text: el.textContent.trim().replace(/\s+/g, " "),
    }));
    expect(routeChip.text).toBe("Georgia / Paris");
    expect(routeChip.color).toBe(theme === "dark" ? "rgb(245, 245, 236)" : "rgb(20, 20, 20)");
    expect(routeChip.background).toBe(theme === "dark" ? "rgb(20, 22, 18)" : "rgb(255, 254, 233)");
    const reportCard = await page.locator(".report-section").first().evaluate((el) => ({
      text: el.scrollWidth,
      width: el.clientWidth,
      background: getComputedStyle(el).backgroundColor,
    }));
    expect(reportCard.text).toBeLessThanOrEqual(reportCard.width);
    expect(reportCard.background).not.toBe("rgba(0, 0, 0, 0)");
    await page.screenshot({ path: testInfo.outputPath(`report-${theme}-${width}.png`), fullPage: true });
  }
});

test("shared typography uses the requested stacks and compact display metrics", async ({ page }) => {
  await page.goto("/");
  const typography = await page.evaluate(() => {
    const heading = document.createElement("h1");
    document.body.append(heading);
    const headingStyle = getComputedStyle(heading);
    const bodyStyle = getComputedStyle(document.body);
    return {
      headingFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-family-heading").trim(),
      bodyFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-family-body").trim(),
      headingSize: headingStyle.fontSize,
      headingTracking: headingStyle.letterSpacing,
      headingLineHeight: headingStyle.lineHeight,
      bodySize: bodyStyle.fontSize,
      bodyLineHeight: bodyStyle.lineHeight,
    };
  });
  expect(typography.headingFamily).toMatch(/^"Agrandir", "Suisse", Arial, system-ui, sans-serif$/);
  expect(typography.bodyFamily).toMatch(/^"Suisse", Arial, system-ui, sans-serif$/);
  expect(parseFloat(typography.headingSize)).toBeGreaterThanOrEqual(42);
  expect(parseFloat(typography.headingSize)).toBeLessThanOrEqual(112);
  expect(parseFloat(typography.headingTracking) / parseFloat(typography.headingSize)).toBeCloseTo(-0.06, 2);
  expect(parseFloat(typography.headingLineHeight) / parseFloat(typography.headingSize)).toBeCloseTo(0.94, 2);
  expect(typography.bodySize).toBe("16px");
  expect(parseFloat(typography.bodyLineHeight) / parseFloat(typography.bodySize)).toBeCloseTo(1.375, 2);
});
