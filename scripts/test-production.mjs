import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const required = ["AIFACTORY_PRODUCTION_URL", "AIFACTORY_DELIVERED_SHA", "AIFACTORY_EVIDENCE_DIR"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(`Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  process.exit(2);
}

const productionURL = new URL(process.env.AIFACTORY_PRODUCTION_URL);
const sha = process.env.AIFACTORY_DELIVERED_SHA.trim();
const evidenceDir = resolve(process.env.AIFACTORY_EVIDENCE_DIR);
mkdirSync(evidenceDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "visa-production-"));
const evidence = {
  deliveredSha: sha,
  productionURL: productionURL.href,
  workerPath: {
    feasible: false,
    decision: "infeasible",
    reason: "The production Worker performs live LLM research whose responses vary across runs and model versions and depend on credentials, billing, and rate limits unavailable to a reliable clean-checkout smoke. Interactions therefore substitute only the Worker response with a deterministic public synthetic report; deployed HTML, JavaScript, and CSS are fetched and verified directly.",
  },
  assets: [],
  interactions: [],
};
const save = () => writeFileSync(join(evidenceDir, "production-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);

try {
  const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  if (!origin) throw new Error("No git origin is configured in this clean checkout");
  execFileSync("git", ["clone", "--quiet", "--no-checkout", origin, work], { stdio: "inherit" });
  execFileSync("git", ["-C", work, "checkout", "--quiet", "--detach", sha], { stdio: "inherit" });
  execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, stdio: "inherit" });

  const response = await fetch(productionURL);
  if (!response.ok) throw new Error(`Production page returned HTTP ${response.status}`);
  const html = await response.text();
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:m?js|css)(?:\?[^"']*)?)["']/gi)].map((m) => m[1]);
  const assets = new Set(refs.map((ref) => new URL(ref, productionURL).href));
  const staticRoot = join(work, "visa-advisor");
  if (!assets.size) throw new Error("No JavaScript or CSS assets were referenced by the deployed page");
  while (assets.size) {
    const assetURL = assets.values().next().value;
    assets.delete(assetURL);
    if (evidence.assets.some((asset) => asset.url === assetURL)) continue;
    const url = new URL(assetURL);
    const relative = decodeURIComponent(url.pathname.replace(productionURL.pathname.replace(/\/$/, ""), "").replace(/^\//, ""));
    const candidate = resolve(staticRoot, relative);
    if (!candidate.startsWith(`${staticRoot}${sep}`)) throw new Error(`Unsafe deployed asset path: ${url.pathname}`);
    const served = await fetch(assetURL);
    if (!served.ok) throw new Error(`Asset ${assetURL} returned HTTP ${served.status}`);
    const actual = Buffer.from(await served.arrayBuffer());
    const expected = readFileSync(candidate);
    const equal = actual.equals(expected);
    evidence.assets.push({ url: assetURL, deliveredPath: relative, equal, bytes: actual.length });
    save();
    if (!equal) throw new Error(`Deployed asset differs from ${sha}: ${assetURL}`);
    const text = actual.toString("utf8");
    const imports = url.pathname.endsWith(".js")
      ? [...text.matchAll(/(?:\bimport\s*(?:[^'";]*?\sfrom\s*)?|\bexport\s+[^'";]*?\sfrom\s*)["']([^"']+)["']/g)].map((match) => match[1])
      : [...text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/gi)].map((match) => match[1]);
    for (const imported of imports) {
      if (!/\.(?:m?js|css)(?:[?#]|$)/i.test(imported)) continue;
      assets.add(new URL(imported, assetURL).href);
    }
  }

  const require = createRequire(pathToFileURL(join(work, "package.json")));
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const syntheticReport = {
      type: "report", markdown: "### Visa status\nVisa-free\n\n### Required documents\n- Required: Valid passport\n\n### Official application\nhttps://example.gov/apply",
      sources: [{ title: "Synthetic public authority", url: "https://example.gov/apply", domain: "example.gov" }], sourcesReturned: 1,
      checklist: { status: "available", message: "", warnings: [], items: [{ category: "document", text: "Valid passport", status: "supported", sources: [{ title: "Synthetic public authority", url: "https://example.gov/apply" }], warnings: [] }] },
      critical: [
        { label: "Confirm passport validity", value: "Six months remaining", type: "rule", source: "https://example.gov/passport" },
        { label: "Check transit rules", value: "Before booking", type: "rule", source: "https://example.gov/transit" },
      ],
    };
    await page.route("https://visa-advisor.sopetine.workers.dev/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(syntheticReport) }));
    await page.goto(productionURL.href);
    const disclaimer = page.getByRole("button", { name: "I understand" });
    if (await disclaimer.isVisible().catch(() => false)) await disclaimer.click();
    await page.getByLabel(/Passport nationality/).fill("Public synthetic traveler");
    await page.getByLabel(/Based in/).fill("Tbilisi");
    await page.getByLabel(/Destination city/).fill("Paris");
    await page.getByRole("button", { name: /Check requirements/ }).click();
    const checks = page.locator(".critical-step-checkbox");
    await checks.first().check();
    await page.getByText("1 of 2 complete", { exact: true }).waitFor();
    await checks.nth(1).focus();
    await page.keyboard.press("Space");
    await page.getByText("2 of 2 complete", { exact: true }).waitFor();
    await page.getByRole("checkbox", { name: /Confirm passport validity/ }).waitFor();
    const stored = await page.evaluate(() => localStorage.getItem("visa-advisor.checklist-progress.v1"));
    if (!stored) throw new Error("Checklist completion was not persisted");
    await page.screenshot({ path: join(evidenceDir, "production-desktop-light.png"), fullPage: true });
    await page.reload();
    await page.locator(".critical-step-checkbox").first().waitFor();
    if (!(await page.locator(".critical-step-checkbox").first().isChecked())) throw new Error("Checklist progress did not restore after reload");
    evidence.interactions.push({ check: "toggle, keyboard Space, accessible names and checked state, reload persistence", passed: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: join(evidenceDir, "production-mobile-light.png"), fullPage: true });
    const overflowLight = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflowLight) throw new Error("Mobile light layout overflows horizontally");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: join(evidenceDir, "production-mobile-dark.png"), fullPage: true });
    evidence.interactions.push({ check: "390px mobile layout and light/dark themes", passed: true });
    save();
    await context.close();
  } finally { await browser.close(); }
  evidence.result = "passed";
  save();
  console.log(`Production verification passed. Evidence: ${evidenceDir}`);
} catch (error) {
  evidence.result = "failed";
  evidence.error = error.message;
  save();
  console.error(`Production verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
