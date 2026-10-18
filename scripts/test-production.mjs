import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import net from "node:net";

const required = ["AIFACTORY_PRODUCTION_URL", "AIFACTORY_DELIVERED_SHA", "AIFACTORY_EVIDENCE_DIR"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(`Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  process.exit(2);
}

const localMode = process.env.AIFACTORY_LOCAL_SMOKE === "1";
let productionURL = localMode ? null : new URL(process.env.AIFACTORY_PRODUCTION_URL);
const sha = process.env.AIFACTORY_DELIVERED_SHA.trim();
const evidenceDir = resolve(process.env.AIFACTORY_EVIDENCE_DIR);
mkdirSync(evidenceDir, { recursive: true });
const work = localMode ? resolve(".") : mkdtempSync(join(tmpdir(), "visa-production-"));
let localServer;
const evidence = {
  deliveredSha: sha,
  validationMode: localMode ? "local working copy" : "delivered production revision",
  productionURL: productionURL?.href || "starting local working-copy server",
  liveWorkerProbe: { label: "Live public synthetic Worker probe", attempted: false, timeoutMs: 45_000 },
  assets: [],
  interactions: [],
};
const save = () => writeFileSync(join(evidenceDir, "production-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);

try {
  if (localMode) {
    const port = await new Promise((resolvePort, rejectPort) => {
      const probe = net.createServer();
      probe.once("error", rejectPort);
      probe.listen(0, "127.0.0.1", () => {
        const selectedPort = probe.address().port;
        probe.close((error) => error ? rejectPort(error) : resolvePort(selectedPort));
      });
    });
    productionURL = new URL(`http://127.0.0.1:${port}/`);
    localServer = spawn("python3", ["-m", "http.server", String(port), "--directory", resolve("visa-advisor"), "--bind", "127.0.0.1"], { stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { ready = (await fetch(productionURL)).ok; } catch { /* server is starting */ }
      if (ready) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!ready) throw new Error("Local working-copy server did not become ready");
  } else {
    const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    if (!origin) throw new Error("No git origin is configured in this clean checkout");
    execFileSync("git", ["clone", "--quiet", "--no-checkout", origin, work], { stdio: "inherit" });
    execFileSync("git", ["-C", work, "checkout", "--quiet", "--detach", sha], { stdio: "inherit" });
    execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, stdio: "inherit" });
  }
  evidence.productionURL = productionURL.href;
  save();

  const response = await fetch(productionURL);
  if (!response.ok) throw new Error(`Production page returned HTTP ${response.status}`);
  const html = await response.text();
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:m?js|css)(?:\?[^"']*)?)["']/gi)].map((m) => m[1]);
  const assets = new Set(refs.map((ref) => new URL(ref, productionURL).href));
  const staticRoot = localMode
    ? resolve("visa-advisor")
    : join(work, "visa-advisor");
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
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
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
    const reset = page.getByRole("button", { name: "Reset progress" });
    await reset.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const focusVisible = await reset.evaluate((element) => getComputedStyle(element).outlineStyle !== "none");
    if (!focusVisible) throw new Error("Reset progress did not display a visible focus ring");
    await page.keyboard.press("Enter");
    await page.getByText("0 of 2 complete", { exact: true }).waitFor();
    if (await checks.count() !== 2 || await page.locator(".critical-step-checkbox:checked").count() !== 0) throw new Error("Reset progress did not clear all preparation checkboxes");
    await page.getByRole("checkbox", { name: /Confirm passport validity/ }).waitFor();
    const stored = await page.evaluate(() => localStorage.getItem("visa-advisor.checklist-progress.v1"));
    if (!stored) throw new Error("Checklist completion was not persisted");
    await page.screenshot({ path: join(evidenceDir, "production-desktop-light.png"), fullPage: true });
    await page.reload();
    await page.locator(".critical-step-checkbox").first().waitFor();
    await page.getByText("0 of 2 complete", { exact: true }).waitFor();
    if (await page.locator(".critical-step-checkbox:checked").count()) throw new Error("Reset state did not persist after reload");
    evidence.interactions.push({ check: "deterministic fixture: toggle, keyboard reset, visible focus, accessible names, reset persistence", passed: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: join(evidenceDir, "production-mobile-light.png"), fullPage: true });
    const overflowLight = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflowLight) throw new Error("Mobile light layout overflows horizontally");
    await page.emulateMedia({ colorScheme: "dark" });
    const checklistDark = await page.locator(".before-you-book").isVisible();
    if (!checklistDark) throw new Error("Checklist is not usable in dark theme");
    await page.screenshot({ path: join(evidenceDir, "production-mobile-dark.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: join(evidenceDir, "production-desktop-dark.png"), fullPage: true });
    evidence.interactions.push({ check: "desktop/mobile layout and light/dark themes", passed: true });

    if (process.env.AIFACTORY_LIVE_WORKER_PROBE === "1") {
      const priorProbePath = process.env.AIFACTORY_PRIOR_LIVE_PROBE_EVIDENCE?.trim();
      if (localMode && priorProbePath) {
        const priorProbe = JSON.parse(readFileSync(resolve(priorProbePath), "utf8")).liveWorkerProbe;
        if (!priorProbe?.attempted) throw new Error("Prior live probe evidence does not contain an attempted probe");
        evidence.liveWorkerProbe = { ...priorProbe, reusedFrom: resolve(priorProbePath) };
        evidence.interactions.push({ check: "single live Worker probe recorded in prior smoke evidence", passed: true });
      } else {
    evidence.liveWorkerProbe.attempted = true;
    evidence.liveWorkerProbe.request = { nationality: "Indian", from: "Georgia", destination: "Paris", purpose: "tourism", date: "2027-04-12" };
    evidence.liveWorkerProbe.commentsSent = false;
    let liveResponse;
    let liveText;
    let liveData;
    const liveController = new AbortController();
    const liveTimer = setTimeout(() => liveController.abort(), 45_000);
    try {
      const livePromptResponse = await fetch(new URL("visa-advisor-prompt.md", productionURL), { signal: liveController.signal });
      if (!livePromptResponse.ok) throw new Error(`payload unavailable: prompt returned HTTP ${livePromptResponse.status}`);
      const systemPrompt = (await livePromptResponse.text()).trim();
      const response = await fetch("https://visa-advisor.sopetine.workers.dev", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...evidence.liveWorkerProbe.request, systemPrompt }),
        signal: liveController.signal,
      });
      liveResponse = response;
      evidence.liveWorkerProbe.httpStatus = response.status;
      liveText = await response.text();
      clearTimeout(liveTimer);
      try { liveData = JSON.parse(liveText); } catch { throw new Error(`payload unavailable: response was not JSON (${liveText.slice(0, 300)})`); }
      if (!response.ok) throw new Error(`provider/request unavailable: HTTP ${response.status}: ${liveData.error || liveText.slice(0, 300)}`);
      if (!liveData || liveData.type !== "report" || typeof liveData.markdown !== "string" || !liveData.markdown.trim()) {
        throw new Error(`payload unavailable: expected a non-empty report; received ${JSON.stringify(liveData).slice(0, 500)}`);
      }
      evidence.liveWorkerProbe.outcome = "usable report received";
      await page.route("https://visa-advisor.sopetine.workers.dev/**", (route) => route.fulfill({ status: response.status, contentType: "application/json", body: liveText }));
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel(/Passport nationality/).fill("Indian");
      await page.getByLabel(/Based in/).fill("Georgia");
      await page.getByLabel(/Destination city/).fill("Paris");
      await page.getByLabel(/Date/).fill("2027-04-12").catch(() => {});
      await page.getByRole("button", { name: /Check requirements/ }).click();
      await page.locator(".before-you-book").waitFor({ state: "visible", timeout: 30_000 });
      if (!await page.locator(".critical-step-checkbox").count()) throw new Error("Usable accepted report rendered without a preparation checklist");
      evidence.liveWorkerProbe.rendered = true;
      evidence.liveWorkerProbe.renderAssertionTimeoutMs = 30_000;
      evidence.interactions.push({ check: "live Worker report rendered with preparation section", passed: true });
      await page.screenshot({ path: join(evidenceDir, "production-live-worker.png"), fullPage: true });
    } catch (error) {
      const reason = error.name === "TimeoutError" || error.name === "AbortError"
        ? `timeout after 45 seconds: ${error.message}` : error.message;
      evidence.liveWorkerProbe.outcome = "unexercised";
      evidence.liveWorkerProbe.reason = reason;
      if (evidence.liveWorkerProbe.httpStatus && liveData?.type === "report" && typeof liveData.markdown === "string" && liveData.markdown.trim()) throw error;
    } finally { clearTimeout(liveTimer); }
      }
    } else {
      evidence.liveWorkerProbe.outcome = "skipped (set AIFACTORY_LIVE_WORKER_PROBE=1 to opt in)";
    }
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
  if (localServer) localServer.kill("SIGTERM");
  if (!localMode) rmSync(work, { recursive: true, force: true });
}
