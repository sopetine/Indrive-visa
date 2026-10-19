// Contrast audit: every visible text element, in every theme, on the main screens.
// It reports all failing pairs at once so one fix round can address them together.
import { test, expect } from "@playwright/test";

const report = {
  type: "report",
  markdown: [
    "### Visa status", "Embassy / consulate visa required", "",
    "### Allowed stay", "90 days within any 180-day period", "",
    "### Required documents", "- Required: Valid passport", "- Required: Travel insurance", "",
    "### Official application", "https://example.gov/apply",
  ].join("\n"),
  sources: [{ title: "Immigration office", url: "https://example.gov/apply", domain: "example.gov" }],
  sourcesReturned: 1,
  researchWarning: "Live web research was unavailable; this result is not confirmed.",
  critical: [{ label: "Check passport validity", value: "Six months remaining", type: "rule", source: "https://example.gov/passport" }],
  checklist: {
    status: "available", message: "", warnings: ["Verify with the authority."],
    items: [{ category: "document", text: "Valid passport", status: "supported", sources: [{ title: "Immigration office", url: "https://example.gov/apply" }], warnings: [] }],
  },
};

const themes = [
  { name: "light", scheme: "light", className: "theme-light" },
  { name: "dark", scheme: "light", className: "theme-dark" },
  { name: "system dark", scheme: "dark", className: null },
];

async function audit(page) {
  return page.evaluate(() => {
    const parse = (value) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const blend = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1,
    });
    const luminance = ({ r, g, b }) => {
      const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const backgroundOf = (element) => {
      const layers = [];
      // A highlight drawn by the element's own ::before/::after (for example a marker box) sits directly behind its text.
      for (const pseudo of ["::before", "::after"]) {
        const style = getComputedStyle(element, pseudo);
        const color = parse(style.backgroundColor);
        if (style.content !== "none" && color && color.a >= 1 && style.position === "absolute") return color;
      }
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage && style.backgroundImage !== "none") return null; // gradients and images are checked by eye
        const color = parse(style.backgroundColor);
        if (color && color.a > 0) { layers.push(color); if (color.a >= 1) break; }
      }
      let result = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of layers.reverse()) result = blend(layer, result);
      return result;
    };
    const failures = [];
    const seen = new Set();
    for (const element of document.querySelectorAll("body *")) {
      const own = [...element.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
      if (!own) continue;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || box.width === 0 || box.height === 0 || element.closest("[hidden],[aria-hidden='true'],.sr-only")) continue;
      if (element.matches(":disabled") || element.closest(":disabled")) continue; // WCAG exempts inactive controls
      const fg = parse(style.color), bg = backgroundOf(element);
      if (!fg || !bg) continue;
      const text = blend(fg, bg);
      const [hi, lo] = [luminance(text), luminance(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize), weight = Number(style.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;
      if (ratio + 0.01 < required) {
        const key = `${element.tagName}.${element.className}|${style.color}|${ratio.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        failures.push(`${element.tagName.toLowerCase()}${element.className ? "." + String(element.className).trim().split(/\s+/).join(".") : ""} "${own.slice(0, 40)}" ${ratio.toFixed(2)}:1 < ${required}:1 (${style.color} on rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)}))`);
      }
    }
    return failures;
  });
}

for (const theme of themes) {
  test(`text contrast meets WCAG AA on form and report · ${theme.name}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("visa-advisor.disclaimer", "v1"));
    await page.emulateMedia({ colorScheme: theme.scheme, reducedMotion: "reduce" });
    await page.route("https://visa-advisor.sopetine.workers.dev/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) }));
    await page.goto("/");
    if (theme.className) await page.evaluate((name) => { document.body.classList.remove("theme-light", "theme-dark"); document.body.classList.add(name); }, theme.className);
    const failures = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      failures.push(...(await audit(page)).map((f) => `form @${width}: ${f}`));
    }
    await page.getByLabel(/Passport nationality/).fill("Indian");
    await page.getByLabel(/Based in/).fill("Georgia");
    await page.getByLabel(/Destination city/).fill("Paris");
    await page.getByRole("button", { name: /Check requirements/ }).click();
    await expect(page.locator(".status-badge")).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      failures.push(...(await audit(page)).map((f) => `report @${width}: ${f}`));
    }
    expect(failures, `Contrast failures (${failures.length}):\n${failures.join("\n")}`).toEqual([]);
  });
}
