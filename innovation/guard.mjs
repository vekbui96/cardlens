// PreToolUse hook for the cardlens innovation loop's headless Claude session.
// Reads the hook JSON on stdin; exit 0 = allow, exit 2 = block (stderr is shown to the model).
// It FAILS CLOSED: any parse error blocks the call.
//
// This is a guardrail, not a sandbox: the session runs as Ve's (non-elevated) Windows user, and an allowed
// script or interpreter can do anything that user can. It stops the obvious and the accidental, and turns
// the LOOP.md rules that a string check can express into code. The permission allowlist in run-loop.ps1
// is the other half: anything not listed there is denied before this hook even runs.
//
// Env: INNOVATION_LOOP_CARDLENS_HOME (state dir), INNOVATION_LOOP_CARDLENS_SCRIPTS (the pinned innovation/ dir).
// Test: node guard.mjs < case.json   (see test-guard.mjs)
/* global process */
import { readFileSync } from "node:fs";
import path from "node:path";

const norm = (p) => path.win32.normalize(String(p || "").replace(/\//g, "\\")).toLowerCase();
const HOME = norm(
  process.env.INNOVATION_LOOP_CARDLENS_HOME ||
    path.join(process.env.USERPROFILE || "c:\\users\\unknown", ".innovation-loop-cardlens"),
).replace(/\\$/, "");
const SCRIPTS = norm(
  process.env.INNOVATION_LOOP_CARDLENS_SCRIPTS || "d:\\projects\\cardlens\\innovation",
).replace(/\\$/, "");
const CLONE = HOME + "\\clones\\cardlens";
const REPO = "vekbui96/cardlens";
// The session kind, set by run-loop.ps1 before each session: BUILD (one approved issue), PROPOSE (Phase B
// proposals), PRODUCT_REVIEW (the weekly review). FULL (unset: tests, older runners) allows both build and
// proposal commands. PROPOSE and PRODUCT_REVIEW are read-only research plus opening issues.
// INTAKE plans ONE of Ve's loop:request issues (INNOVATION_LOOP_CARDLENS_REQUEST = its number): read-only
// research plus opening proposals/specs that say "From request #N", and commenting on / adding loop:needs-info
// or loop:declined to that one request. MEMORY (the memory agent) has no tools at all.
// OBSERVE (Phase 2, the Observer) is read-only research with NO GitHub writes, no innovation script and file writes
// only in WORK; it reports findings as JSON that the runner validates. PM (Phase 2, the product manager) is PROPOSE
// plus one rule: every issue it opens cites a known finding / decision id in a <!-- loop-refs: ... --> line (the ids
// the runner wrote to <HOME>\state\pm-refs.json before the session). INNOVATION_LOOP_CARDLENS_NO_GH_WRITES=1
// (run-loop -DryRun -AgentsDryRun) refuses every GitHub write in any mode.
// QA and UX (Phase 3: the QA session after a deploy, the UX reviewer) have the Observer's posture: read-only, no
// GitHub writes (no gh at all), no innovation script, files only in WORK and ARTIFACTS (screenshots), HTTP GET to the
// live site and the public API routes only (never a token, never a write route, never the local server's data).
const MODE = String(process.env.INNOVATION_LOOP_CARDLENS_MODE || "FULL").toUpperCase();
const INTAKE = MODE === "INTAKE";
const OBSERVE = MODE === "OBSERVE";
const PM = MODE === "PM";
const QA = MODE === "QA";
const UX = MODE === "UX";
// the read-only agents: the runner validates their JSON; they change nothing
const AGENT_RO = OBSERVE || QA || UX;
const NO_GH_WRITES = process.env.INNOVATION_LOOP_CARDLENS_NO_GH_WRITES === "1";
const READ_ONLY = [
  "PRODUCT_REVIEW",
  "PROPOSE",
  "PROPOSE_ONLY",
  "INTAKE",
  "OBSERVE",
  "PM",
  "QA",
  "UX",
].includes(MODE);
// keep identical to product-intel.ps1 $script:LoopRefsRx
const LOOP_REFS = /<!--\s*loop-refs:\s*([^>]*?)\s*-->/g;
const REQUEST = String(process.env.INNOVATION_LOOP_CARDLENS_REQUEST || "").trim();
const MARKER = "<!-- innovation-loop -->";

function block(msg) {
  process.stderr.write(`innovation-loop guard blocked this: ${msg}\n`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  block("could not parse hook input (failing closed)");
}
const tool = input.tool_name || "";
const ti = input.tool_input || {};

if (MODE === "MEMORY") block("the memory session has no tools: reply with the JSON object only");

// The product store (D:\hub\state\product\...: decisions, preferences, cursors) is written by the runner only,
// after it validated an agent's JSON; no session reads or writes it (so none can mark a preference confirmed).
const STORE = /hub[\\/]+state[\\/]+product\b|preferences\.json|decisions\.jsonl/i;
{
  const all = [ti.file_path, ti.path, ti.notebook_path, ti.glob, ti.pattern, ti.command]
    .filter(Boolean)
    .join(" ");
  if (STORE.test(all))
    block(
      "the product store (decisions, preferences) is written only by the runner; sessions never touch it",
    );
  const content = [ti.content, ti.new_string].filter(Boolean).join("\n");
  if (/"status"\s*:\s*"confirmed"/i.test(content) && /preference|statement/i.test(content))
    block("a session never writes a confirmed preference (only Ve confirms; the runner records it)");
}

// ---- never-touch items, by name (anywhere: paths, patterns, commands) ------------------------
const NEVER = [
  [/solid-website|personal-site-api/i, "the portfolio site repos"],
  [/target-stock-checker/i, "the Target stock bot"],
  [/palworld/i, "Palworld"],
  [/tailscale|\bfunnel\s+(serve|on|off|reset)/i, "Tailscale / Funnel"],
  [/openclaw|\bwsl(\.exe)?\b/i, "OpenClaw / WSL"],
  [/\\\.ssh\b|\/\.ssh\b|~[\\/]\.ssh|id_(rsa|ed25519|ecdsa)/i, "SSH keys"],
  [/\bnssm\b/i, "NSSM"],
  [
    /\.server-setup|04-install-services|06-install-recognition|07-[\w-]*secret/i,
    "server setup / secret scripts",
  ],
  [
    /services[\\/]+recognition|restart-service\s+recognition|cardrec[\\/]|judge\.py/i,
    "the recognition service",
  ],
  [/cardlens-backup/i, "the cardlens-backup task"],
  [
    /design-taste-frontend|taste-skill|tasteskill/i,
    "the taste design skill (not used by this loop: marketing-site rules, and its Stop hook must never arm)",
  ],
  [/services[\\/]+scripts/i, "D:\\services\\scripts"],
  [/\.innovation-loop(?!-cardlens)\b/i, "the website loop's state"],
  [
    /currentcontrolset[\\/]+services|hklm:|hkey_local_machine/i,
    "service registry keys (NSSM env holds secrets)",
  ],
];
// secrets: .env files (not .env.example), credential stores, env dumps, gh token
const SECRET = [
  [/(^|[\\/\s"'=:])\.env(?!\.example)(\.[\w-]+)?($|[\s"'\\/;|),])/i, ".env files"],
  [/\$env:[\w]*(key|token|secret|password|pass|origins)\b/i, "secret environment variables"],
  [/\b(Get-ChildItem|gci|dir|ls|Get-Item|gi)\s+env:/i, "environment dumps"],
  [
    /\benv:\\?\s*$|\[(System\.)?Environment\]::GetEnvironmentVariable|\b(printenv|set)\s*$/i,
    "environment dumps",
  ],
  [/gh(\.exe)?["']?\s+auth\b/i, "gh auth"],
  [/hosts\.yml|github cli[\\/]/i, "gh's token store"],
  [/\.credentials|git\s+credential|cmdkey|Get-StoredCredential|vault/i, "credential stores"],
  [/\\users\\[^\\]+\\\.claude(\\|$)|~[\\/]\.claude([\\/]|$)/i, "Claude's own config and credentials"],
];

function checkNames(s, what) {
  for (const [re, name] of NEVER) if (re.test(s)) block(`${what} references a never-touch item: ${name}`);
  for (const [re, name] of SECRET)
    if (re.test(s)) block(`${what} looks like it reads or prints a secret: ${name}`);
}

// D:\services: only the cardlens service logs may be read (by file tools or Get-Content/Select-String).
function checkServices(s, what, readOnlyLogsOk) {
  const n = norm(s);
  const hits = n.match(/d:\\+services[^\s"';|]*/g) || [];
  for (const h of hits) {
    if (readOnlyLogsOk && /^d:\\+services\\+logs\\+cardlens[\w.-]*$/.test(h)) continue;
    block(
      `${what} touches D:\\services (${h}); only the fixed deploy scripts may. Readable: D:\\services\\logs\\cardlens*`,
    );
  }
}

// Repo-relative protected paths in the clone (mirror of lib.ps1 ProtectedPathPatterns).
const PROTECTED = [
  /^\.github\//,
  /^\.claude\//,
  /^innovation\//,
  /(^|\/)\.env/,
  /^public\/card-index\//,
  /^src\/scan\/phash\.ts$/,
  /^src\/storage\/printings\.ts$/,
  /^src\/storage\/binders\.ts$/,
  /^src\/models\/binderparse\.ts$/,
  /^src\/storage\/caches\.ts$/,
  /^server\/targetbot\.ts$/,
  /^server\/collectionstore\.ts$/,
  /^server\/binderstore\.ts$/,
  /^scripts\/build-card-index\.mjs$/,
  /^playwright\.config\.ts$/,
  /^render\.yaml$/,
  /^netlify\.toml$/,
  /^vercel\.json$/,
];

// ---- design skills (sessions.json options.designSkills; LOOP.md section 9) ----------------------
// run-loop.ps1 sets INNOVATION_LOOP_CARDLENS_DESIGN_SKILLS=1 only when the flag is on and the engine's hash
// checked out. The engine and the skill copies are pinned under D:\loop-tools (never Ve's ~\.claude, which the
// SECRET rule keeps out of reach). Only read-only verbs: context, shot (into WORK/ARTIFACTS), detect.
// hooks, pin, live, doctor, foundations, install, update, login, telemetry, world, ignores are refused, and so
// are search.py's writing flags (--persist, --page, --output-dir, --force, --preview, --tokens).
const DESIGN = process.env.INNOVATION_LOOP_CARDLENS_DESIGN_SKILLS === "1";
const ENGINE = "d:\\loop-tools\\impeccable-engine\\0.1.27\\impeccable.exe";
const SEARCH = "d:\\loop-tools\\skills\\ui-ux-pro-max\\scripts\\search.py";
const SHOT_URL =
  /^(https:\/\/vekbui96\.github\.io\/cardlens(\/[^\s"']*)?|http:\/\/(127\.0\.0\.1|localhost):(5273|4173)(\/[^\s"']*)?)$/i;
const VIEWPORT = /^\d{2,4}x\d{2,4}(,\d{2,4}x\d{2,4}){0,3}$/i;
function checkDesignCommand(c, isPy) {
  if (!DESIGN) block("design skills are off for this run (sessions.json options.designSkills)");
  if (/\$/.test(c)) block("design skill commands take literal arguments only (no $ variables)");
  const toks = [...c.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => ({
    v: m[1] ?? m[2] ?? m[3],
    sq: m[2] !== undefined,
  }));
  const inClone = (p) => {
    const n = norm(p);
    return n === CLONE || n.startsWith(CLONE + "\\");
  };
  const inWork = (p) => {
    const n = norm(p);
    return n.startsWith(HOME + "\\work\\") || n === HOME + "\\work" || n.startsWith(HOME + "\\artifacts");
  };
  if (isPy) {
    if (!toks[1] || norm(toks[1].v) !== SEARCH)
      block(`ui-ux-pro-max: run exactly python ${SEARCH} '<query>' [read-only flags] (no interpreter flags)`);
    if (!toks[2] || !toks[2].sq) block("ui-ux-pro-max: the query must be one single-quoted string");
    const withValue =
      /^(--domain|-d|--stack|-s|--max-results|-n|--project-name|-p|--format|-f|--variance|--motion|--density)$/;
    for (let i = 3; i < toks.length; i++) {
      const t = toks[i].v;
      if (/^(--persist|--page|--output-dir|-o|--force|--preview|--tokens)(=|$)/.test(t))
        block(`ui-ux-pro-max: ${t} writes files; the loop only searches (never persists a design system)`);
      if (/^(--json|--full|--design-system|-ds)$/.test(t)) continue;
      if (withValue.test(t) && toks[i + 1] && /^[\w .-]{1,40}$/.test(toks[i + 1].v)) {
        i++;
        continue;
      }
      block(`ui-ux-pro-max: ${t} is not an allowed search flag`);
    }
    return;
  }
  if (norm(toks[0].v) !== ENGINE)
    block(
      `impeccable: call the pinned engine by bare full path ${ENGINE} (never the launcher or another copy)`,
    );
  const verb = (toks[1] && toks[1].v.toLowerCase()) || "";
  const rest = toks.slice(2);
  if (verb === "context") {
    if (rest.length === 0) return;
    if (rest.length === 2 && rest[0].v === "--target" && inClone(rest[1].v)) return;
    block(`impeccable context takes only --target <path in the loop clone ${CLONE}>`);
  }
  if (verb === "shot") {
    let url = 0;
    let out = false;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i].v;
      if (t === "--full") continue;
      if (t === "--viewport" && rest[i + 1] && VIEWPORT.test(rest[i + 1].v)) {
        i++;
        continue;
      }
      if (t === "--out" && rest[i + 1] && inWork(rest[i + 1].v)) {
        if (OBSERVE && !norm(rest[i + 1].v).startsWith(HOME + "\\work"))
          block(`the Observer's screenshots go to a folder in ${HOME}\\work`);
        out = true;
        i++;
        continue;
      }
      if (SHOT_URL.test(t)) {
        url++;
        continue;
      }
      block(
        `impeccable shot: ${t} is not allowed (one URL: the live site or a local preview on 5273/4173; --viewport, --full, --out <WORK or ARTIFACTS>)`,
      );
    }
    if (url !== 1) block("impeccable shot takes exactly one page URL");
    if (!out) block(`impeccable shot needs --out <a folder in ${HOME}\\work or artifacts>`);
    return;
  }
  if (verb === "detect") {
    let targets = 0;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i].v;
      if (/^(--json|--quiet)$/.test(t)) continue;
      if (t === "--scope" && rest[i + 1] && /^(type|layout)(,(type|layout))?$/.test(rest[i + 1].v)) {
        i++;
        continue;
      }
      if (t === "--viewport" && rest[i + 1] && VIEWPORT.test(rest[i + 1].v)) {
        i++;
        continue;
      }
      if (inClone(t) || SHOT_URL.test(t)) {
        targets++;
        continue;
      }
      block(`impeccable detect: ${t} is not allowed (targets: paths in the loop clone or the live site)`);
    }
    if (targets === 0) block("impeccable detect needs a target (a path in the loop clone or the live site)");
    return;
  }
  block(
    `impeccable ${verb || "(no verb)"} is not allowed for the loop: only context, shot and detect (never hooks, pin, live, doctor, foundations, install, update, login, telemetry, world or ignores)`,
  );
}

// ---- PM: every issue it opens cites a known finding or decision ------------------------------------------
// The runner writes <HOME>\state\pm-refs.json ({ids: [f-..., d-...], specs: [n]}) before the PM session; the
// session cannot write there (writes: clone / WORK / artifacts only). A slice cites spec-<n> for a spec in `specs`.
function checkPmRefs(c) {
  const bf = (c.match(/--body-file\s+("([^"]+)"|'([^']+)'|(\S+))/i) || []).slice(2).find(Boolean);
  let text = "";
  try {
    text = readFileSync(String(bf || ""), "utf8");
  } catch {
    block("the PM's issue body file could not be read (failing closed)");
  }
  let refs;
  try {
    refs = JSON.parse(readFileSync(HOME + "\\state\\pm-refs.json", "utf8").replace(/^\uFEFF/, ""));
  } catch {
    block("the runner's list of citable ids (state\\pm-refs.json) is missing (failing closed)");
  }
  const ids = new Set((refs.ids || []).map(String));
  const specs = new Set((refs.specs || []).map((n) => String(n)));
  const cited = [...text.matchAll(LOOP_REFS)].flatMap((m) => m[1].split(/[\s,]+/).filter(Boolean));
  if (cited.length === 0)
    block(
      "every PM issue cites what it acts on: add a last line <!-- loop-refs: f-xxxxxxxx d-xxxxxxxxxx --> (section 11)",
    );
  const ok = cited.some(
    (r) =>
      (/^(f-[0-9a-f]{8}|d-[0-9a-f]{10})$/.test(r) && ids.has(r)) ||
      (/^spec-\d+$/.test(r) && specs.has(r.slice(5))),
  );
  if (!ok)
    block(
      `loop-refs cites no known finding or decision (${cited.slice(0, 4).join(" ")}); use ids from OPEN_FINDINGS / RECENT_DECISIONS, or spec-<n> for a slice`,
    );
}

// ---- file tools --------------------------------------------------------------------------------
if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep"].includes(tool)) {
  const p = ti.file_path || ti.path || ti.notebook_path || "";
  checkNames(p, `${tool} ${p}`);
  if (ti.glob) checkNames(ti.glob, `${tool} glob`);
  checkServices(p, `${tool} ${p}`, ["Read", "Grep", "Glob"].includes(tool));
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const n = norm(p);
    const inClone = n.startsWith(CLONE + "\\");
    const inWork = n.startsWith(HOME + "\\work\\") || n.startsWith(HOME + "\\artifacts\\");
    if (!inClone && !inWork)
      block(`writes are only allowed in the loop clone (${CLONE}) and ${HOME}\\work / artifacts`);
    if (OBSERVE && !n.startsWith(HOME + "\\work\\"))
      block(`the Observer writes files only in ${HOME}\\work (it reports findings; it changes nothing)`);
    if ((QA || UX) && inClone)
      block(
        `the ${MODE} session writes files only in ${HOME}\\work and artifacts (it reports; it changes nothing)`,
      );
    if (inClone) {
      const rel = n.slice(CLONE.length + 1).replace(/\\/g, "/");
      if (rel === ".git" || rel.startsWith(".git/")) block("do not edit .git directly");
      for (const re of PROTECTED)
        if (re.test(rel)) block(`${rel} is a protected path (out of scope for the loop: manual / needs Ve)`);
    }
    const content = [
      ti.content,
      ti.new_string,
      ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e && e.new_string) : []),
    ]
      .filter(Boolean)
      .join("\n");
    if (/D:[\\/]+services/i.test(content))
      block("new content references D:\\services (tests and code must never point at live data)");
    if (/VITE_[A-Z_]*(TOKEN|SECRET|PASSWORD|API_KEY)/.test(content))
      block("a secret-looking name in a VITE_ variable ships in the public bundle");
  }
  process.exit(0);
}

// ---- web ---------------------------------------------------------------------------------------
if (tool === "WebFetch") {
  const u = String(ti.url || "");
  if ((QA || UX) && /token|secret|[?&]key=|\/api\/sync/i.test(u))
    block(`the ${MODE} session never sends a token or a sync call (${u})`);
  if (
    !/^https:\/\/(vekbui96\.github\.io\/cardlens|server-pc\.tail0e4194\.ts\.net:8443\/api\/(health|catalog|printings|metrics\/summary)|api\.pokemontcg\.io|api\.tcgdex\.net)(\/|\?|$)/i.test(
      u,
    )
  ) {
    block(
      "WebFetch is limited to the live site, GET-safe live API routes (health/catalog/printings/metrics/summary), pokemontcg.io and TCGdex",
    );
  }
  process.exit(0);
}
if (tool === "WebSearch") block("WebSearch is not used by the loop");

// ---- shell -------------------------------------------------------------------------------------
if (tool === "Bash" || tool === "PowerShell") {
  const c = String(ti.command || "");
  checkNames(c, "command");
  checkServices(c, "command", /^\s*(Get-Content|Select-String|gc|cat|type)\b/i.test(c));

  // single-quoted strings are literal in PowerShell (e.g. a --jq filter), so separators inside them are fine;
  // double-quoted strings can run $(...) and are checked as they are.
  const unquoted = c.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  const isGhOrGit = /^\s*["']?(gh|git)(\.exe)?["']?\s/i.test(c);
  if (
    /`|\$\(|\r|\n/.test(c) ||
    /[{}]/.test(unquoted) ||
    /[;&|]/.test(
      unquoted.replace(
        /\|\s*(Select-Object|Where-Object|ForEach-Object|Sort-Object|Measure-Object|Format-List|Format-Table|Out-String|ConvertFrom-Json|ConvertTo-Json|Select-String)\b/gi,
        "",
      ),
    )
  ) {
    block(
      "one command per call: no ; & && || backticks, $(...), { } script blocks or newlines (pipes only into read-only formatting cmdlets)",
    );
  }
  if (/^\s*(cd|Set-Location|sl|Push-Location|pushd|chdir)\b/i.test(c))
    block('do not change directory; use git -C "<clone>" and absolute paths');

  // design skills (LOOP.md section 9): the pinned impeccable engine and ui-ux-pro-max's search.py, read-only
  // verbs only. Judged here in full, then allowed: they are the one exception to the interpreter rule below.
  const first0 = (c.trim().match(/^\S+/) || [""])[0];
  const isPy = /^(python3?|py)(\.exe)?$/i.test(path.win32.basename(first0));
  if (
    /impeccable/i.test(first0) ||
    (!isGhOrGit && /impeccable(\.exe|\.cmd)?(["'\s]|$)/i.test(c)) ||
    (isPy && /ui-ux-pro-max/i.test(c))
  ) {
    checkDesignCommand(c, isPy);
    process.exit(0);
  }

  // only this repo
  for (const r of c.match(/vekbui96\/[A-Za-z0-9_.-]+/gi) || []) {
    if (!/^vekbui96\/cardlens(\.git)?$/i.test(r)) block(`only ${REPO} may be touched (saw ${r})`);
  }
  if (/github\.com[:/](?!vekbui96\/cardlens(\.git)?\b)/i.test(c))
    block("git/gh against a repo other than vekbui96/cardlens");

  // gh
  const isGh = /(^|[\s"'\\])gh(\.exe)?["']?\s/i.test(c);
  if (isGh) {
    const sub = (c.match(/gh(?:\.exe)?["']?\s+([a-z-]+)(?:\s+([a-z-]+))?/i) || [])
      .slice(1)
      .map((x) => (x || "").toLowerCase());
    const [g1, g2] = sub;
    if (QA || UX)
      block(`the ${MODE} session uses no gh at all: the runner gave it the issue, the diff and the criteria`);
    if (OBSERVE) {
      // the Observer reads GitHub at most; it never writes (no issue / PR / label / comment of any kind)
      const readOnlyGh =
        (["issue", "pr"].includes(g1) && ["view", "list", "diff", "status", "checks"].includes(g2)) ||
        (g1 === "run" && ["list", "view"].includes(g2)) ||
        g1 === "api";
      if (!readOnlyGh)
        block(
          `the Observer never writes to GitHub (gh ${g1} ${g2 || ""} refused); report findings in your JSON`,
        );
    }
    if (
      NO_GH_WRITES &&
      ((["issue", "pr"].includes(g1) && !["view", "list", "diff", "status", "checks"].includes(g2)) ||
        g1 === "label")
    )
      block(
        `dry run: no GitHub writes (gh ${g1} ${g2 || ""}); list what you would open in your JSON (wouldOpen)`,
      );
    const named =
      new RegExp(`(-R|--repo)\\s+["']?${REPO}\\b`, "i").test(c) ||
      new RegExp(`repos/${REPO}\\b`, "i").test(c);
    if (!named) block(`every gh command must name the repo: -R ${REPO} (or a repos/${REPO}/... API path)`);
    if (
      [
        "repo",
        "secret",
        "variable",
        "ssh-key",
        "gpg-key",
        "auth",
        "extension",
        "codespace",
        "gist",
        "org",
        "ruleset",
        "cache",
        "alias",
        "config",
        "release",
        "label",
        "workflow",
        "attestation",
        "project",
      ].includes(g1)
    ) {
      if (
        !(g1 === "repo" && g2 === "view") &&
        !(g1 === "workflow" && (g2 === "list" || g2 === "view")) &&
        !(g1 === "release" && (g2 === "list" || g2 === "view")) &&
        !(g1 === "label" && g2 === "list")
      ) {
        block(
          `gh ${g1} ${g2 || ""} is not allowed for the loop (deploys and Pages runs go through deploy.ps1)`,
        );
      }
    }
    if (g1 === "api") {
      if (/\bgraphql\b/i.test(c))
        block("gh api graphql is not used by the session (check-approval.ps1 does that)");
      if (/(-X|--method)\s*["']?(?!GET\b)\w+/i.test(c) || /\s(-f|-F|--field|--raw-field|--input)\s/i.test(c))
        block("gh api is read-only for the session (GET); use gh issue / gh pr subcommands to write");
    }
    // CI is the e2e gate: the session may READ runs and checks to fix a CI failure (gh run list / view,
    // incl. --log-failed, and gh pr checks), all on this repo (the naming rule above). It never dispatches,
    // cancels, watches or re-runs: waiting is wait-ci.ps1's (and merge-pr.ps1's) job, and the one allowed rerun of known-flaky
    // specs goes through ci-rerun.ps1, which checks the run belongs to the PR's current head.
    if (g1 === "run" && !["list", "view"].includes(g2))
      block(
        `gh run ${g2} is not allowed (read CI with gh run list/view; wait with wait-ci.ps1; flaky rerun via ci-rerun.ps1)`,
      );
    if (g1 === "run" && g2 === "view" && /\s--web\b|\s-w\b/i.test(c))
      block("gh run view --web is not allowed");
    if (g1 === "pr") {
      if (g2 === "merge")
        block(
          "merging is done only by merge-pr.ps1 (it verifies approval, protected paths and CI on the head sha)",
        );
      if (["edit", "review", "ready", "reopen", "lock", "unlock", "update-branch", "revert"].includes(g2))
        block(`gh pr ${g2} is not allowed`);
      if (g2 === "checks" && /\s--watch\b|\s-w\b/i.test(c))
        block("wait for CI with wait-ci.ps1 -Pr <n> (one call, one result line), not gh pr checks --watch");
      if (g2 === "create" && !/--head\s+["']?loop\/\d+-[a-z0-9-]+\b/i.test(c))
        block("gh pr create needs --head loop/<issue#>-<slug>");
      if ((g2 === "create" || g2 === "comment") && /\s(-b|--body)\s/i.test(c))
        block("use --body-file <file in WORK>, not an inline body");
    }
    if (g1 === "issue") {
      if (["delete", "transfer", "lock", "unlock", "pin", "unpin", "reopen", "develop"].includes(g2))
        block(`gh issue ${g2} is not allowed`);
      // Ve's requests: only Ve files, labels or edits them (the loop acts as Ve's GitHub account)
      if (/\bloop:request\b/i.test(c) && !/^\s*\S*gh(\.exe)?["']?\s+issue\s+(list|view|status)\b/i.test(c))
        block("loop:request is Ve's label: the loop never files a request or adds/removes loop:request");
      if (/\bloop:planned\b/i.test(c) && !/^\s*\S*gh(\.exe)?["']?\s+issue\s+(list|view|status)\b/i.test(c))
        block("loop:planned is set by the runner after its plan comment, never by a session");
      if (g2 === "edit") {
        if (
          /\s(--body|--body-file|-b|--title|-t|--milestone|--assignee|--add-assignee|--remove-assignee|--add-project)\b/i.test(
            c,
          )
        )
          block("the loop never edits issue bodies/titles/assignees; post a comment instead");
        const labels = [...c.matchAll(/--(?:add|remove)-label\s+["']?([^"'\s]+)/gi)].flatMap((m) =>
          m[1].split(","),
        );
        if (labels.length === 0) block("gh issue edit is only for the loop:* state labels");
        if (INTAKE) {
          // the intake session labels only its own request, and only loop:needs-info or loop:declined
          const num = (c.match(/gh(?:\.exe)?["']?\s+issue\s+edit\s+["']?#?(\d+)\b/i) || [])[1];
          if (!REQUEST || num !== REQUEST)
            block(
              `the intake session may only label its request #${REQUEST || "?"} (saw ${num || "no number"})`,
            );
          if (/--remove-label/i.test(c)) block("the intake session never removes labels");
          for (const l of labels)
            if (!/^loop:(needs-info|declined)$/i.test(l))
              block(`the intake session may only add loop:needs-info or loop:declined (saw ${l})`);
        } else {
          for (const l of labels)
            if (!/^loop:(in-progress|deployed|failed|retried)$/i.test(l))
              block(
                `the loop may only add/remove loop:in-progress, loop:deployed, loop:failed (and add loop:retried) (saw ${l}); never 'approved'`,
              );
        }
        // loop:retried caps the automatic retry of a failed build at one; only Ve may take it off
        if (/--remove-label\s+["']?[^"'\s]*loop:retried\b/i.test(c))
          block("the loop never removes loop:retried (it limits a failed build to one automatic retry)");
      }
      if (g2 === "create") {
        // a build session builds its one issue and opens nothing (proposals are the proposal session's job)
        if (MODE === "BUILD")
          block("a build session does not open issues (proposals and specs come from the proposal session)");
        // every --label value, comma lists split: gh issue create --label a --label b,c
        const created = [...c.matchAll(/--label[\s=]+["']?([^"'\s]+)/gi)].flatMap((m) =>
          m[1].toLowerCase().split(","),
        );
        // the weekly product review opens ONE loop:product-review issue (never built: no loop:proposal),
        // and only in that mode; every other issue the loop opens is a loop:proposal. A spec is a proposal
        // too (it takes one slot) that check-approval.ps1 never builds: loop:proposal + loop:spec.
        const isReview = created.includes("loop:product-review");
        if (isReview && MODE !== "PRODUCT_REVIEW")
          block("loop:product-review issues are opened only by the weekly product review run");
        if (isReview && created.includes("loop:proposal"))
          block("a product review issue is never a loop:proposal (it must never be buildable)");
        if (!isReview && !created.includes("loop:proposal"))
          block("gh issue create needs --label loop:proposal");
        if (isReview && created.includes("loop:spec")) block("a product review issue is not a spec");
        if (created.includes("device-feedback")) block("device-feedback issues are Ve's, never the loop's");
        if (created.some((l) => /\bapproved\b/.test(l))) block("only Ve adds 'approved'");
        for (const l of created)
          if (!/^(loop:proposal|loop:spec|loop:product-review|size:small|test-only)$/.test(l))
            block(
              `gh issue create may only use the labels loop:proposal, loop:spec, size:small, test-only (and loop:product-review in the review run); saw ${l}`,
            );
        if (!/--body-file\s/i.test(c)) block("gh issue create needs --body-file <file in WORK>");
        if (INTAKE) {
          if (isReview) block("the intake session opens proposals or a spec, never a product review");
          // what the intake session opens must link back to its request and carry the loop marker
          const bf = (c.match(/--body-file\s+("([^"]+)"|'([^']+)'|(\S+))/i) || []).slice(2).find(Boolean);
          let text = "";
          try {
            text = readFileSync(String(bf || ""), "utf8");
          } catch {
            block("the intake session's issue body file could not be read (failing closed)");
          }
          const first = (text.split(/\r?\n/).find((l) => l.trim()) || "").trim();
          if (first !== MARKER) block("an issue from a request must start with the loop marker line");
          const link = (text.match(/^[ \t>*_]*From request #(\d+)\b/im) || [])[1];
          if (!REQUEST || link !== REQUEST)
            block(`an issue from request #${REQUEST || "?"} must say "From request #${REQUEST || "?"}"`);
        }
        if (PM) checkPmRefs(c);
      }
      if (INTAKE && g2 === "comment") {
        const num = (c.match(/gh(?:\.exe)?["']?\s+issue\s+comment\s+["']?#?(\d+)\b/i) || [])[1];
        if (!REQUEST || num !== REQUEST)
          block(
            `the intake session comments only on its request #${REQUEST || "?"} (saw ${num || "no number"})`,
          );
      }
      if (g2 === "comment" && (/\s(-b|--body)\s/i.test(c) || /--edit-last|--delete-last/i.test(c)))
        block("comment with --body-file <file in WORK>; never edit/delete comments");
    }
    if (
      /\bapproved\b/i.test(c) &&
      /(--add-label|--remove-label|--label|labels)/i.test(c) &&
      !/^\s*\S*gh(\.exe)?["']?\s+(issue|pr)\s+(list|view|status)\b/i.test(c)
    )
      block("only Ve adds or removes 'approved'");
  }

  // proposal and review sessions are read-only research: no pushes, commits, PRs or label changes
  if (READ_ONLY) {
    if (
      /\bgit(\.exe)?\b[^|;&]*\b(push|commit|merge|rebase|reset|checkout\s+-b|switch\s+-c|branch\s+\S)/i.test(
        c,
      )
    )
      block("proposal and review sessions are read-only: no commits, branches or pushes");
    if (/\bgh(\.exe)?["']?\s+(pr\s+(create|merge|comment|close)|issue\s+close)\b/i.test(c))
      block(
        "proposal, review and intake sessions only read and open issues (proposals, specs, the review); no PRs or closes",
      );
    if (!INTAKE && /\bgh(\.exe)?["']?\s+issue\s+(edit|comment)\b/i.test(c))
      block(
        "proposal and review sessions only read and open issues (proposals, specs, the review); no edits or comments",
      );
  }

  // git
  if (/\bgit(\.exe)?\b/i.test(c)) {
    if (/\bpush\b/i.test(c)) {
      if (
        /(\s--force\b|\s-f\b|--force-with-lease|--mirror|--delete|\s-d\s|\s\+[\w/]|:refs\/|\s:[\w/]|\bmain\b|--all|--tags|\s[\w./-]+:[\w./-]+)/i.test(
          c,
        )
      )
        block(
          "no force/delete/main/refspec pushes (main changes only via merge-pr.ps1; reverts via deploy.ps1/rollback.ps1)",
        );
      if (!/\bpush\s+(-u\s+|--set-upstream\s+)?origin\s+loop\/\d+-[a-z0-9-]+\s*$/i.test(c))
        block("the loop may only `git push [-u] origin loop/<issue#>-<slug>`");
    }
    if (
      /\b(filter-branch|filter-repo|replace|update-ref|reflog\s+expire|gc\s+--prune|worktree|clone|submodule)\b/i.test(
        c,
      )
    )
      block("history rewriting, worktrees, clones and submodules are not allowed");
    if (/\badd\s+(-A\b|--all\b|-u\b|\.(\s|$)|\*)/i.test(c))
      block("stage explicit paths only (no git add -A / . / -u / *)");
    if (/\bconfig\b/i.test(c) && !/\bconfig\s+(--get|-l|--list)\b/i.test(c)) block("no git config changes");
    if (/\bremote\s+(add|set-url|remove|rm|rename|set-head)/i.test(c)) block("no remote changes");
    if (/--no-verify|\bcommit\b[^]*\s-m\s/i.test(c))
      block("commit with -F <message file in WORK> (and never --no-verify)");
    const dirs = [...c.matchAll(/\s-C\s+("([^"]+)"|'([^']+)'|(\S+))/gi)].map((m) =>
      norm(m[2] || m[3] || m[4]),
    );
    for (const d of dirs)
      if (d !== CLONE && !d.startsWith(CLONE + "\\"))
        block(`git -C must point at the loop clone ${CLONE} (saw ${d})`);
    if (dirs.length === 0 && !/^\s*git(\.exe)?\s+(--version|version|help)\b/i.test(c))
      block(`always run git as git -C "${CLONE}" ...`);
  }

  // HTTP: GET only, allowed hosts only, never a token, never the write routes
  if (/\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm|curl|wget)\b/i.test(c)) {
    if (
      /-Method\s+["']?(?!GET\b|HEAD\b)\w+|\s-(Body|InFile|Form)\b|\s(-X|--request|-d|--data[\w-]*|-F|--form|-T|--upload-file)\s/i.test(
        c,
      )
    )
      block("HTTP from the session is GET-only (never POST to production)");
    if (/authorization|bearer|-Headers|\s-H\s|-Credential|-UseDefaultCredentials/i.test(c))
      block("no auth headers / credentials in HTTP calls");
    const urls = c.match(/https?:\/\/[^\s"']+/gi) || [];
    if (urls.length === 0) block("HTTP calls must spell out a full URL");
    for (const u of urls) {
      if (
        !/^https?:\/\/(127\.0\.0\.1|localhost):(8787|8200|5273|8887|4173)\/|^https:\/\/(vekbui96\.github\.io\/cardlens|server-pc\.tail0e4194\.ts\.net:8443\/|api\.pokemontcg\.io\/|api\.tcgdex\.net\/)/i.test(
          u,
        )
      )
        block(`HTTP host not allowed: ${u}`);
      if (
        /\/(merge|share|binders|target|collection|recognize|session|companion)\b|\/metrics(?!\/summary\b)/i.test(
          u.replace(/^https?:\/\/[^/]+/, ""),
        ) &&
        !/api\.(pokemontcg|tcgdex)/i.test(u)
      )
        block(`route not allowed from the session: ${u} (metrics: GET /api/metrics/summary only)`);
      // QA / UX look at what a collector sees: the live site and the public, GET-safe API routes; never the local
      // server or the recognition service, never a token in a URL
      if ((QA || UX) && /token|secret|[?&]key=|\/api\/sync/i.test(u))
        block(`the ${MODE} session never sends a token or a sync call (${u})`);
      if (
        (QA || UX) &&
        !/^https:\/\/(vekbui96\.github\.io\/cardlens(\/|#|$)|server-pc\.tail0e4194\.ts\.net:8443\/api\/(health|catalog|printings|metrics\/summary)\b|api\.pokemontcg\.io\/|api\.tcgdex\.net\/)/i.test(
          u,
        )
      )
        block(`the ${MODE} session reads the live site and the public API routes only (saw ${u})`);
    }
  }

  // machine safety (gh/git commands are exempt: their text is titles, messages and refs, and they cannot run these)
  if (
    !isGhOrGit &&
    /\b(Stop|Start|Restart|Set|New|Remove|Suspend|Resume)-Service\b|\bsc(\.exe)?\s+(stop|start|config|delete|create)\b|\bnet\s+(stop|start|user|localgroup)\b/i.test(
      c,
    )
  )
    block("services are only restarted by the elevated deploy task");
  if (
    !isGhOrGit &&
    /schtasks|ScheduledTask|Set-ExecutionPolicy|\breg(\.exe)?\s|New-ItemProperty|Set-ItemProperty|Remove-ItemProperty|NetFirewall|netsh|Restart-Computer|Stop-Computer|shutdown(\.exe)?\b|bcdedit|diskpart|format\s+[a-z]:|takeown|icacls|Set-Acl|Add-MpPreference|Set-MpPreference|Stop-Process|\bkill\b|taskkill|runas|Start-Process|docker/i.test(
      c,
    )
  ) {
    block(
      "system administration commands are out of scope (deploys go through deploy.ps1, which triggers only the one elevated task)",
    );
  }
  if (
    !isGhOrGit &&
    /\b(Invoke-Expression|iex|Invoke-Command|icm)\b|DownloadString|DownloadFile|-EncodedCommand|\s-enc\s|FromBase64String|Add-Type|\[scriptblock\]/i.test(
      c,
    )
  )
    block("no dynamic/encoded code execution");
  // Only the first token runs (separators, $(...) and script blocks are blocked), so judge that token.
  const first = (unquoted.trim().split(/\s+/)[0] || "").replace(/^["']|["']$/g, "");
  const exe = path.win32
    .basename(first)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "");
  if (
    !/\.ps1$/i.test(first) &&
    [
      "npm",
      "npx",
      "pnpm",
      "yarn",
      "node",
      "tsx",
      "vite",
      "vitest",
      "playwright",
      "python",
      "python3",
      "py",
      "cmd",
      "bash",
      "sh",
      "wsl",
      "pwsh",
      "powershell",
      "powershell_ise",
      "cscript",
      "wscript",
      "mshta",
      "rundll32",
      "regsvr32",
      "java",
      "ruby",
      "perl",
      "deno",
      "bun",
      "start",
    ].includes(exe)
  ) {
    block(
      "no interpreters or package managers directly: install/format/verify/build/e2e go through test-gate.ps1, snapshots through update-snapshots.ps1",
    );
  }
  // scripts: only the pinned innovation scripts the session may run
  if (/\.ps1\b/i.test(c)) {
    const ps1 = [...c.matchAll(/"([^"]*\.ps1)"|'([^']*\.ps1)'|([^\s"';|&]+\.ps1)\b/gi)].map(
      (m) => m[1] || m[2] || m[3],
    );
    for (const s of ps1) {
      const f = norm(s);
      if (!f.startsWith(SCRIPTS + "\\"))
        block(`scripts must be called by bare full path from ${SCRIPTS}\\<name>.ps1 (saw ${s})`);
      if (
        !/\\(check-approval|test-gate|update-snapshots|wait-ci|merge-pr|deploy|rollback|ci-rerun|progress)\.ps1$/.test(
          f,
        )
      )
        block(
          `${s} is not a script the session may run (run-loop, install-task, lib and the elevated scripts are off limits)`,
        );
      if (AGENT_RO)
        block(
          `the ${OBSERVE ? "Observer" : MODE + " session"} runs no innovation script (${s}); the runner gave it what it needs`,
        );
      if (READ_ONLY && !/\\check-approval\.ps1$/.test(f))
        block(
          `proposal and review sessions are read-only: ${s} builds, merges or deploys and is not allowed in this session`,
        );
    }
  }

  // shell writes: confine to the loop home's work/artifacts and the clone
  if (
    !isGhOrGit &&
    /\b(Remove-Item|rm|rmdir|del|erase|rd|ri|Move-Item|mv|move|Rename-Item|ren|Copy-Item|cp|copy|cpi|New-Item|ni|mkdir|md|Set-Content|sc|Add-Content|ac|Out-File|Clear-Content|Expand-Archive|Compress-Archive)\b|\s>>?\s?/i.test(
      c,
    )
  ) {
    const re = /"([A-Za-z]:[\\/][^"]*)"|'([A-Za-z]:[\\/][^']*)'|([A-Za-z]:[\\/][^\s;|"']*)/g;
    const paths = [...c.matchAll(re)].map((m) => norm(m[1] || m[2] || m[3]));
    if (paths.length === 0)
      block("file-changing commands must use absolute paths (inside the loop clone or WORK)");
    for (const p of paths) {
      if (OBSERVE && !(p.startsWith(HOME + "\\work\\") || p === HOME + "\\work"))
        block(`the Observer changes files only in ${HOME}\\work (saw ${p})`);
      if ((QA || UX) && p.startsWith(CLONE + "\\"))
        block(`the ${MODE} session changes files only in ${HOME}\\work and artifacts (saw ${p})`);
      const ok =
        p.startsWith(CLONE + "\\") ||
        p.startsWith(HOME + "\\work\\") ||
        p.startsWith(HOME + "\\artifacts\\") ||
        p === HOME + "\\work";
      if (!ok) block(`file changes outside the loop clone / WORK: ${p}`);
      if (p.startsWith(CLONE + "\\")) {
        const rel = p.slice(CLONE.length + 1).replace(/\\/g, "/");
        for (const r of PROTECTED) if (r.test(rel)) block(`${rel} is a protected path`);
      }
    }
  }
  process.exit(0);
}

// Agent, Task, NotebookEdit, etc. are denied by the allowlist; TodoWrite/ToolSearch are harmless.
process.exit(0);
