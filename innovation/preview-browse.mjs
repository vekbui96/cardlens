// The QA session's browser, for PR PREVIEWS ONLY (LOOP.md section 14). Called by preview-browse.ps1, which
// validated the arguments; this file checks them again and fails closed.
//
//   node preview-browse.mjs --url <preview url> --port <the session's preview port> --steps <steps.json>
//                           --out <folder> --clone <loop clone (for @playwright/test)>
//
// Every request the page makes goes through one route: GET/HEAD to the preview origin and a few public image /
// font hosts pass; anything else (another port on the tailnet name, localhost, the live API, any POST) is aborted
// and listed. So a preview can never reach the live API (8443 / 8787) or write anywhere, whatever its code does.
/* global process, console, setTimeout, clearTimeout, URL */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const HOST = "server-pc.tail0e4194.ts.net";
const PORTS = [8460, 8461, 8462];
const PUBLIC_HOSTS = new Set([
  "images.pokemontcg.io",
  "wsrv.nl",
  "assets.tcgdex.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);
const MAX_STEPS = 30;
const VIEWPORTS = { "390x844": [390, 844], "1440x900": [1440, 900] };

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] || "" : "";
}
function die(msg) {
  console.log(`PREVIEW-BROWSE REFUSED ${msg}`);
  process.exit(1);
}

const url = arg("url");
const port = Number(arg("port"));
const out = arg("out");
const clone = arg("clone");
let origin;
try {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.hostname !== HOST ||
    !PORTS.includes(Number(u.port)) ||
    u.username ||
    u.password
  )
    die(`not a preview URL: ${url}`);
  if (Number(u.port) !== port) die(`port ${u.port} is not this session's preview (${port})`);
  if (/^\/api(\/|$)/i.test(u.pathname)) die("the preview has no API");
  origin = u.origin;
} catch (e) {
  die(`bad URL ${url} (${e.message})`);
}

let plan;
try {
  plan = JSON.parse(readFileSync(arg("steps"), "utf8").replace(/^\uFEFF/, ""));
} catch (e) {
  die(`steps file unreadable (${e.message})`);
}
const steps = Array.isArray(plan) ? plan : plan.steps;
if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS)
  die(`steps must be a list of 1-${MAX_STEPS} steps`);
const vps = (
  Array.isArray(plan.viewports) && plan.viewports.length ? plan.viewports : ["390x844", "1440x900"]
).map(String);
for (const v of vps) if (!VIEWPORTS[v]) die(`viewport ${v} (allowed: ${Object.keys(VIEWPORTS).join(", ")})`);

const okPath = (p) =>
  typeof p === "string" &&
  p.length <= 200 &&
  /^(\/|#)/.test(p) &&
  !/^\/\/|\\|\s|[<>"'`]|^\/api\b|\.\./i.test(p) &&
  !/^\/[^?#]+/.test(p);
const shotName = (s) =>
  String(s || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 40);
for (const s of steps) {
  if (!s || typeof s !== "object") die("each step is an object");
  if (!["goto", "click", "fill", "press", "wait", "waitFor", "expectText", "shot", "scroll"].includes(s.do))
    die(`unknown step '${s.do}' (goto, click, fill, press, wait, waitFor, expectText, shot, scroll)`);
  if (s.do === "goto" && !okPath(s.path)) die(`goto path not allowed: ${s.path}`);
  if (s.do === "fill" && typeof s.value !== "string") die("fill needs a string value");
  if (s.do === "press" && !/^[A-Za-z0-9+]{1,30}$/.test(String(s.key || "")))
    die(`press key not allowed: ${s.key}`);
}

let chromium;
try {
  const req = createRequire(path.join(clone, "package.json"));
  ({ chromium } = req("@playwright/test"));
} catch (e) {
  die(`@playwright/test not found in the loop clone (${e.message})`);
}
mkdirSync(out, { recursive: true });

// one locator from a step: role+name, label, placeholder, testid, text, or a CSS selector
function locate(page, s) {
  let l;
  if (s.role) l = page.getByRole(s.role, s.name ? { name: s.name, exact: !!s.exact } : {});
  else if (s.label) l = page.getByLabel(s.label, { exact: !!s.exact });
  else if (s.placeholder) l = page.getByPlaceholder(s.placeholder, { exact: !!s.exact });
  else if (s.testid) l = page.getByTestId(s.testid);
  else if (s.text) l = page.getByText(s.text, { exact: !!s.exact });
  else if (s.selector) l = page.locator(s.selector);
  else throw new Error("needs role/name, label, placeholder, testid, text or selector");
  return s.nth !== undefined ? l.nth(Number(s.nth)) : l.first();
}

const killer = setTimeout(() => {
  console.log("PREVIEW-BROWSE FAIL timed out after 150 s");
  process.exit(1);
}, 150000);

const result = { url, viewports: [] };
// this box resolves its own tailnet name to the public Funnel addresses; reach the preview on the tailnet IP instead
const ip = /^100\.\d+\.\d+\.\d+$/.test(arg("ip")) ? arg("ip") : "";
const browser = await chromium.launch(ip ? { args: [`--host-resolver-rules=MAP ${HOST} ${ip}`] } : {});
try {
  for (const v of vps) {
    const [w, h] = VIEWPORTS[v];
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const r = {
      viewport: v,
      steps: [],
      shots: [],
      consoleErrors: [],
      pageErrors: [],
      blocked: [],
      failed: [],
      texts: [],
    };
    await ctx.route("**/*", (route) => {
      const req = route.request();
      let u;
      try {
        u = new URL(req.url());
      } catch {
        return route.abort();
      }
      const same = u.origin === origin;
      const pub = u.protocol === "https:" && PUBLIC_HOSTS.has(u.hostname);
      const method = req.method();
      if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
      if ((method === "GET" || method === "HEAD") && (same || pub)) return route.continue();
      if (r.blocked.length < 40) r.blocked.push(`${method} ${u.origin}${u.pathname}`);
      return route.abort("blockedbyclient");
    });
    page.on("console", (m) => {
      if (m.type() === "error" && r.consoleErrors.length < 20) r.consoleErrors.push(m.text().slice(0, 300));
    });
    page.on(
      "pageerror",
      (e) => r.pageErrors.length < 20 && r.pageErrors.push(String(e.message || e).slice(0, 300)),
    );
    page.on("response", (resp) => {
      if (resp.status() >= 400 && r.failed.length < 20) {
        const p = new URL(resp.url());
        // the preview is static: the app's own /api calls (sync, metrics) 404 there by design
        const note =
          p.origin === origin && p.pathname.startsWith("/api") ? " (no API in a preview: expected)" : "";
        r.failed.push(`${resp.status()} ${p.origin}${p.pathname}${note}`);
      }
    });
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    let broken = false;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const t0 = Date.now();
      const rec = { i: i + 1, do: s.do, ok: true };
      if (broken && s.do !== "shot") {
        rec.ok = false;
        rec.error = "skipped (an earlier step failed)";
        r.steps.push(rec);
        continue;
      }
      try {
        const to = Math.min(Number(s.timeoutMs) || 8000, 15000);
        if (s.do === "goto")
          await page.goto(origin + (s.path.startsWith("#") ? "/" + s.path : s.path), {
            waitUntil: "load",
            timeout: 30000,
          });
        else if (s.do === "click") await locate(page, s).click({ timeout: to });
        else if (s.do === "fill") await locate(page, s).fill(s.value, { timeout: to });
        else if (s.do === "press") await page.keyboard.press(s.key);
        else if (s.do === "wait") await page.waitForTimeout(Math.min(Number(s.ms) || 500, 5000));
        else if (s.do === "waitFor") await locate(page, s).waitFor({ state: "visible", timeout: to });
        else if (s.do === "scroll")
          await page.mouse.wheel(0, Math.max(-5000, Math.min(5000, Number(s.y) || 600)));
        else if (s.do === "expectText") {
          const n = await page.getByText(String(s.text), { exact: !!s.exact }).count();
          rec.found = n > 0;
          rec.ok = n > 0;
          r.texts.push({ text: String(s.text).slice(0, 120), found: n > 0 });
        } else if (s.do === "shot") {
          const f = `${shotName(s.name) || `step${i + 1}`}-${v}.png`;
          await page.screenshot({ path: path.join(out, f), fullPage: !!s.full });
          r.shots.push(f);
        }
      } catch (e) {
        rec.ok = false;
        rec.error = String(e.message || e)
          .split("\n")[0]
          .slice(0, 240);
        if (s.do !== "expectText") broken = true;
      }
      rec.ms = Date.now() - t0;
      r.steps.push(rec);
    }
    const fin = `${v}.png`;
    await page.screenshot({ path: path.join(out, fin) });
    r.shots.push(fin);
    r.finalUrl = page.url();
    result.viewports.push(r);
    await ctx.close();
  }
} finally {
  await browser.close();
  clearTimeout(killer);
}
writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
let allOk = true;
for (const r of result.viewports) {
  const ok = r.steps.filter((s) => s.ok).length;
  if (ok !== r.steps.length) allOk = false;
  console.log(
    `BROWSE ${r.viewport}: steps ${ok}/${r.steps.length} ok; final ${r.finalUrl}; shots ${r.shots.join(", ")}; ` +
      `console errors ${r.consoleErrors.length}; page errors ${r.pageErrors.length}; blocked ${r.blocked.length}; http errors ${r.failed.length}`,
  );
  for (const s of r.steps.filter((x) => !x.ok))
    console.log(`  step ${s.i} ${s.do}: ${s.error || "text not found"}`);
  for (const e of r.pageErrors) console.log(`  page error: ${e}`);
  for (const e of r.consoleErrors.slice(0, 5)) console.log(`  console error: ${e}`);
  for (const b of r.blocked.slice(0, 5)) console.log(`  blocked: ${b}`);
}
console.log(`PREVIEW-BROWSE ${allOk ? "OK" : "STEPS-FAILED"} ${path.join(out, "result.json")}`);
process.exit(0);
