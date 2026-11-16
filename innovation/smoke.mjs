// Render check for the live (or a local) CardLens page: a blank SPA returns HTTP 200, so status codes
// prove nothing. Loads the URL in headless Edge/Chrome via the clone's playwright-core (no browser
// download), waits for React to mount into #root, and fails on an empty root or an uncaught page error.
//
// usage: node smoke.mjs <repoPath> <url> [screenshot.png]
// exit 0 = rendered, 1 = did not render / page error, 2 = could not run (no playwright-core / no browser)
/* global process, console, document */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

const [repoPath, url, shot] = process.argv.slice(2);
if (!repoPath || !url) {
  console.error("usage: node smoke.mjs <repoPath> <url> [screenshot.png]");
  process.exit(2);
}

let chromium;
try {
  // resolve from the repo under test (@playwright/test depends on playwright-core)
  const req = createRequire(path.join(repoPath, "package.json"));
  try {
    ({ chromium } = req("playwright-core"));
  } catch {
    ({ chromium } = req("@playwright/test"));
  }
} catch {
  console.error("playwright-core not installed in", repoPath);
  process.exit(2);
}

const candidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error("no Edge/Chrome found");
  process.exit(2);
}

const browser = await chromium.launch({ executablePath, headless: true });
const pageErrors = [];
const consoleErrors = [];
try {
  // a phone-shaped viewport resolves to the web shell, the one most visitors get
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .waitForFunction(
      () => {
        const r = document.getElementById("root");
        return !!r && r.childElementCount > 0 && (r.textContent || "").trim().length > 10;
      },
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const r = document.getElementById("root");
    const scripts = Array.from(document.querySelectorAll("script[src]")).map((s) => s.getAttribute("src"));
    return {
      rootChildren: r ? r.childElementCount : -1,
      textLength: r ? (r.textContent || "").trim().length : 0,
      title: document.title,
      scripts,
    };
  });
  if (shot) await page.screenshot({ path: shot, fullPage: false });
  const ok = info.rootChildren > 0 && info.textLength > 10 && pageErrors.length === 0;
  console.log(
    JSON.stringify({
      ok,
      ...info,
      screenshot: shot || null,
      pageErrors: pageErrors.slice(0, 5),
      consoleErrors: consoleErrors.slice(0, 5),
    }),
  );
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error("smoke failed:", e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
