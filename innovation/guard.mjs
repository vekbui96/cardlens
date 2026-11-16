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
// FULL | PROPOSE_ONLY | PRODUCT_REVIEW (set by run-loop.ps1). PRODUCT_REVIEW is read-only research.
const MODE = String(process.env.INNOVATION_LOOP_CARDLENS_MODE || "FULL").toUpperCase();

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
  if (
    !/^https:\/\/(vekbui96\.github\.io\/cardlens|server-pc\.tail0e4194\.ts\.net:8443\/api\/(health|catalog|printings)|api\.pokemontcg\.io|api\.tcgdex\.net)(\/|\?|$)/i.test(
      u,
    )
  ) {
    block(
      "WebFetch is limited to the live site, GET-safe live API routes (health/catalog/printings), pokemontcg.io and TCGdex",
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
    // cancels, watches or re-runs: waiting is merge-pr.ps1's job, and the one allowed rerun of known-flaky
    // specs goes through ci-rerun.ps1, which checks the run belongs to the PR's current head.
    if (g1 === "run" && !["list", "view"].includes(g2))
      block(
        `gh run ${g2} is not allowed (read CI with gh run list/view; wait with merge-pr.ps1; flaky rerun via ci-rerun.ps1)`,
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
      if (g2 === "create" && !/--head\s+["']?loop\/\d+-[a-z0-9-]+\b/i.test(c))
        block("gh pr create needs --head loop/<issue#>-<slug>");
      if ((g2 === "create" || g2 === "comment") && /\s(-b|--body)\s/i.test(c))
        block("use --body-file <file in WORK>, not an inline body");
    }
    if (g1 === "issue") {
      if (["delete", "transfer", "lock", "unlock", "pin", "unpin", "reopen", "develop"].includes(g2))
        block(`gh issue ${g2} is not allowed`);
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
        for (const l of labels)
          if (!/^loop:(in-progress|deployed|failed)$/i.test(l))
            block(
              `the loop may only add/remove loop:in-progress, loop:deployed, loop:failed (saw ${l}); never 'approved'`,
            );
      }
      if (g2 === "create") {
        // the weekly product review opens ONE loop:product-review issue (never built: no loop:proposal),
        // and only in that mode; every other issue the loop opens is a loop:proposal
        const isReview = /--label\s+["']?loop:product-review\b/i.test(c);
        if (isReview && MODE !== "PRODUCT_REVIEW")
          block("loop:product-review issues are opened only by the weekly product review run");
        if (isReview && /--label\s+["']?loop:proposal\b/i.test(c))
          block("a product review issue is never a loop:proposal (it must never be buildable)");
        if (!isReview && !/--label\s+["']?loop:proposal\b/i.test(c))
          block("gh issue create needs --label loop:proposal");
        if (/--label\s+["']?device-feedback\b/i.test(c))
          block("device-feedback issues are Ve's, never the loop's");
        if (/--label\s+["']?[^"'\s]*\bapproved\b/i.test(c)) block("only Ve adds 'approved'");
        if (!/--body-file\s/i.test(c)) block("gh issue create needs --body-file <file in WORK>");
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

  // the weekly product review is read-only research: no pushes, commits, PRs or label changes
  if (MODE === "PRODUCT_REVIEW") {
    if (
      /\bgit(\.exe)?\b[^|;&]*\b(push|commit|merge|rebase|reset|checkout\s+-b|switch\s+-c|branch\s+\S)/i.test(
        c,
      )
    )
      block("the product review is read-only: no commits, branches or pushes");
    if (/\bgh(\.exe)?["']?\s+(pr\s+(create|merge|comment|close)|issue\s+(edit|close|comment))\b/i.test(c))
      block(
        "the product review only reads and opens its review issue / proposals; no PRs, edits or comments",
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
        /\/(merge|share|binders|target|collection|recognize|session|companion)\b/i.test(
          u.replace(/^https?:\/\/[^/]+/, ""),
        ) &&
        !/api\.(pokemontcg|tcgdex)/i.test(u)
      )
        block(`route not allowed from the session: ${u}`);
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
        !/\\(check-approval|test-gate|update-snapshots|merge-pr|deploy|rollback|ci-rerun|progress)\.ps1$/.test(
          f,
        )
      )
        block(
          `${s} is not a script the session may run (run-loop, install-task, lib and the elevated scripts are off limits)`,
        );
      if (MODE === "PRODUCT_REVIEW" && !/\\check-approval\.ps1$/.test(f))
        block(
          `the product review is read-only: ${s} builds, merges or deploys and is not allowed in this mode`,
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
