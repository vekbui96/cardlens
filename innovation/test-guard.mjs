// Allow/deny cases for guard.mjs. Run:  node innovation\test-guard.mjs
// Each case spawns guard.mjs with the hook JSON on stdin, exactly as Claude Code does.
/* global process, console */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = "C:\\Users\\Ve Bui\\.innovation-loop-cardlens";
const S = "D:\\projects\\cardlens\\innovation";
const C = `${HOME}\\clones\\cardlens`;
const W = `${HOME}\\work`;
const env = { ...process.env, INNOVATION_LOOP_CARDLENS_HOME: HOME, INNOVATION_LOOP_CARDLENS_SCRIPTS: S };

const ps = (command) => ({ tool_name: "PowerShell", tool_input: { command } });
const allow = [
  ps(`${S}\\check-approval.ps1 -List`),
  ps(`${S}\\test-gate.ps1 -Issue 12 -Step all -ExpectString "Open binder"`),
  ps(`${S}\\test-gate.ps1 -Issue 12 -Step unit -UnitFilter src/models/binderLayout.test.ts`),
  ps(`${S}\\merge-pr.ps1 -Pr 40 -Issue 12`),
  ps(
    `${S}\\deploy.ps1 -Issue 12 -MergeSha 0123456789abcdef0123456789abcdef01234567 -ExpectString "Open binder"`,
  ),
  ps(`${S}\\rollback.ps1 -Issue 12 -MergeSha 0123456789abcdef0123456789abcdef01234567 -RevertOnly`),
  ps(`${S}\\update-snapshots.ps1 -Issue 12`),
  ps(`git -C "${C}" status`),
  ps(`git -C "${C}" checkout -b loop/12-binder-hint origin/main`),
  ps(`git -C "${C}" add src/web/binders/WebBinderScreen.tsx src/web/binders/hint.test.ts`),
  ps(`git -C "${C}" commit -F "${W}\\msg-12.txt"`),
  ps(`git -C "${C}" push -u origin loop/12-binder-hint`),
  ps(`gh issue list -R vekbui96/cardlens --label loop:proposal --state open --json number --limit 50`),
  ps(`gh issue view 12 -R vekbui96/cardlens --json title,body,labels,comments`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --add-label loop:in-progress`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --add-label loop:deployed --remove-label loop:in-progress`),
  // the one automatic retry of a failed build: swap loop:failed for loop:retried, continue the open PR
  ps(`${S}\\check-approval.ps1 -Slots`),
  ps(
    `gh issue edit 12 -R vekbui96/cardlens --remove-label loop:failed --add-label loop:retried --add-label loop:in-progress`,
  ),
  ps(`git -C "${C}" checkout -b loop/12-binder-hint origin/loop/12-binder-hint`),
  ps(`git -C "${C}" merge --no-edit origin/main`),
  ps(`git -C "${C}" merge --abort`),
  ps(`gh pr list -R vekbui96/cardlens --state open --json number,headRefName,title`),
  ps(`gh issue comment 12 -R vekbui96/cardlens --body-file "${W}\\c.md"`),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Copy set link" --label loop:proposal --body-file "${W}\\p.md"`,
  ),
  ps(`gh issue close 12 -R vekbui96/cardlens`),
  ps(
    `gh pr create -R vekbui96/cardlens --base main --head loop/12-binder-hint --title "x" --body-file "${W}\\pr.md"`,
  ),
  ps(`gh run view 123 -R vekbui96/cardlens --log-failed`),
  // before/after screenshots (LOOP.md "Screenshots"): pin raw links to full shas, re-post after a fix round
  ps(`git -C "${C}" merge-base HEAD origin/main`),
  ps(`git -C "${C}" rev-parse HEAD`),
  ps(`git -C "${C}" rev-parse 0123456789abcdef0123456789abcdef01234567^1`),
  ps(`gh pr comment 40 -R vekbui96/cardlens --body-file "${W}\\shots.md"`),
  // CI is the e2e gate: read-only run/check commands on this repo, the wait helper, the flaky-rerun helper
  ps(`gh run list -R vekbui96/cardlens --branch loop/12-binder-hint --json databaseId,status,conclusion`),
  ps(`gh run view 123 -R vekbui96/cardlens --json jobs`),
  ps(`gh run view 123 -R vekbui96/cardlens --job 456 --log-failed`),
  ps(`gh pr checks 40 -R vekbui96/cardlens`),
  ps(`${S}\\merge-pr.ps1 -Pr 40 -Issue 12 -WaitMinutes 9`),
  ps(`${S}\\ci-rerun.ps1 -Pr 40 -Issue 12 -RunId 123456789`),
  // progress.ps1: the only way the session updates its live progress comment
  ps(`${S}\\progress.ps1 -Issue 12 -Stage approval -Status ok -Detail "approval verified"`),
  ps(`${S}\\progress.ps1 -Issue 12 -Stage ci -Detail "waiting for Playwright E2E (run 123)"`),
  ps(`${S}\\progress.ps1 -Issue 12 -Stage done -Outcome rolled-back -Detail "health check failed"`),
  ps(`gh api "repos/vekbui96/cardlens/actions/runs?per_page=5" --jq '.workflow_runs[] | .status'`),
  ps(`Invoke-RestMethod http://127.0.0.1:8787/api/health`),
  ps(`Invoke-RestMethod "https://api.pokemontcg.io/v2/sets?pageSize=1&page=1"`),
  ps(`Get-Content "${C}\\docs\\handoff.md" -TotalCount 50`),
  ps(`Get-Content D:\\services\\logs\\cardlens.err.log -Tail 50`),
  ps(`Start-Sleep -Seconds 120`),
  ps(`Get-ChildItem "${C}\\src" -Recurse -Filter *.tsx | Select-Object -First 5`),
  ps(`Remove-Item "${W}\\old.md"`),
  { tool_name: "Read", tool_input: { file_path: `${C}\\CLAUDE.md` } },
  { tool_name: "Read", tool_input: { file_path: `${S}\\FOCUS.md` } },
  ps(`git -C "${C}" fetch origin`),
  { tool_name: "Read", tool_input: { file_path: `${C}\\.claude\\skills\\advance\\SKILL.md` } },
  { tool_name: "Read", tool_input: { file_path: `${C}\\.env.example` } },
  { tool_name: "Read", tool_input: { file_path: "D:\\services\\logs\\cardlens.out.log" } },
  { tool_name: "Grep", tool_input: { pattern: "COLLECTION_TOKEN", path: `${C}\\server` } },
  {
    tool_name: "Edit",
    tool_input: {
      file_path: `${C}\\src\\web\\binders\\WebBinderScreen.tsx`,
      old_string: "a",
      new_string: "b",
    },
  },
  { tool_name: "Write", tool_input: { file_path: `${W}\\c.md`, content: "<!-- innovation-loop -->\nhello" } },
  { tool_name: "WebFetch", tool_input: { url: "https://vekbui96.github.io/cardlens/", prompt: "x" } },
  {
    tool_name: "WebFetch",
    tool_input: { url: "https://server-pc.tail0e4194.ts.net:8443/api/health", prompt: "x" },
  },
  { tool_name: "TodoWrite", tool_input: { todos: [] } },
  // wait-ci.ps1: one blocking CI wait instead of polling turn by turn
  ps(`${S}\\wait-ci.ps1 -Pr 40`),
  ps(`${S}\\wait-ci.ps1 -Pr 40 -TimeoutMinutes 45`),
  // specs: a loop:proposal that is also loop:spec; slices are plain proposals (the "Part of #N" line is in
  // the body file), optionally marked size:small / test-only (the cheaper build model)
  ps(
    `gh issue create -R vekbui96/cardlens --title "Spec: collection value over time" --label loop:proposal --label loop:spec --body-file "${W}\\spec.md"`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Value history: store daily totals" --label loop:proposal --label size:small --body-file "${W}\\s1.md"`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Pin the merge rule" --label loop:proposal,test-only --body-file "${W}\\t.md"`,
  ),
  ps(`gh issue view 70 -R vekbui96/cardlens --json title,body,labels,comments`),
  // usage metrics: the public counts-only summary, GET only
  {
    tool_name: "WebFetch",
    tool_input: { url: "https://server-pc.tail0e4194.ts.net:8443/api/metrics/summary?days=30", prompt: "x" },
  },
  ps(`Invoke-RestMethod "https://server-pc.tail0e4194.ts.net:8443/api/metrics/summary?days=30"`),
  ps(`Invoke-RestMethod "http://127.0.0.1:8787/api/metrics/summary?days=7"`),
];
const deny = [
  // comments are never edited by the session (only progress.ps1, marker-checked, edits its own comment)
  ps(`gh api repos/vekbui96/cardlens/issues/comments/123 -X PATCH -f body=x`),
  ps(`gh api -X PATCH repos/vekbui96/cardlens/issues/comments/123 --input "${W}\\b.json"`),
  ps(`gh api repos/vekbui96/cardlens/issues/comments/123 -f body=x`),
  ps(`gh issue comment 12 -R vekbui96/cardlens --edit-last --body-file "${W}\\c.md"`),
  // runner-only helpers
  ps(`${S}\\reporting.ps1`),
  ps(`${S}\\test-reporting.ps1`),
  ps(`${C}\\innovation\\progress.ps1 -Issue 12 -Stage plan`),
  // other repos / never-touch
  ps(`gh issue list -R vekbui96/solid-website`),
  ps(`gh api repos/vekbui96/target-stock-checker/issues`),
  ps(`gh issue list`),
  { tool_name: "Read", tool_input: { file_path: "D:\\projects\\solid-website\\CLAUDE.md" } },
  { tool_name: "Read", tool_input: { file_path: "C:\\Users\\Ve Bui\\.ssh\\config" } },
  { tool_name: "Read", tool_input: { file_path: "C:\\Users\\Ve Bui\\.claude\\.credentials.json" } },
  { tool_name: "Read", tool_input: { file_path: "D:\\services\\recognition\\cardrec\\judge.py" } },
  { tool_name: "Read", tool_input: { file_path: "C:\\Users\\Ve Bui\\.innovation-loop\\state\\x.json" } },
  ps(`Get-ScheduledTask -TaskName cardlens-backup`),
  // secrets
  { tool_name: "Read", tool_input: { file_path: "D:\\services\\cardlens\\.env" } },
  { tool_name: "Read", tool_input: { file_path: `${C}\\.env` } },
  { tool_name: "Read", tool_input: { file_path: "D:\\services\\scripts\\07-secrets.ps1" } },
  ps(`Get-ChildItem env:`),
  ps(`Write-Output $env:COLLECTION_TOKEN`),
  ps(`gh auth token`),
  ps(`Get-ItemProperty HKLM:\\SYSTEM\\CurrentControlSet\\Services\\cardlens\\Parameters`),
  ps(`Get-Content "C:\\Users\\Ve Bui\\AppData\\Roaming\\GitHub CLI\\hosts.yml"`),
  // live data / services
  { tool_name: "Read", tool_input: { file_path: "D:\\services\\data\\collection.json" } },
  { tool_name: "Write", tool_input: { file_path: "D:\\services\\cardlens\\server\\index.ts", content: "x" } },
  ps(`git -C D:\\services\\cardlens reset --hard origin/main`),
  ps(`Restart-Service cardlens`),
  ps(`schtasks /run /tn innovation-loop-cardlens-deploy`),
  ps(`Start-ScheduledTask -TaskName innovation-loop-cardlens-deploy`),
  ps(`Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/collection/merge -Body '{}'`),
  ps(`Invoke-RestMethod http://127.0.0.1:8787/api/collection`),
  ps(`Invoke-RestMethod https://example.com/`),
  ps(`Invoke-RestMethod http://127.0.0.1:8787/api/health -Headers @{Authorization='Bearer x'}`),
  // approval / issues
  ps(`gh issue edit 12 -R vekbui96/cardlens --add-label approved`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --remove-label approved`),
  // loop:retried caps the automatic retry at one: the loop may add it, never remove it
  ps(`gh issue edit 12 -R vekbui96/cardlens --remove-label loop:retried`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --add-label loop:failed --remove-label loop:retried`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --remove-label loop:in-progress,loop:retried`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --add-label loop:retry-forever`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --body "new scope"`),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:proposal --label approved --body-file "${W}\\p.md"`,
  ),
  ps(`gh issue create -R vekbui96/cardlens --title x --body-file "${W}\\p.md"`),
  ps(`gh issue comment 3 -R vekbui96/cardlens --body "hi"`),
  ps(`gh api -X POST repos/vekbui96/cardlens/issues/12/labels -f labels[]=approved`),
  ps(`gh api graphql -f query=x`),
  ps(`gh label create approved -R vekbui96/cardlens`),
  // merging / deploying by hand
  ps(`gh pr merge 40 -R vekbui96/cardlens --merge`),
  ps(`gh workflow run deploy-pages.yml -R vekbui96/cardlens`),
  ps(`gh run cancel 123 -R vekbui96/cardlens`),
  // CI: no rerun / watch / dispatch / other repos from the session (the flaky rerun is ci-rerun.ps1's)
  ps(`gh run rerun 123 -R vekbui96/cardlens --failed`),
  ps(`gh run rerun 123 -R vekbui96/cardlens`),
  ps(`gh run watch 123 -R vekbui96/cardlens`),
  ps(`gh run download 123 -R vekbui96/cardlens`),
  ps(`gh run delete 123 -R vekbui96/cardlens`),
  ps(`gh run view 123 -R vekbui96/cardlens --web`),
  ps(`gh run view 123 --log-failed`),
  ps(`gh pr checks 40`),
  ps(`gh pr checks 40 -R vekbui96/solid-website`),
  ps(`gh workflow run ci.yml -R vekbui96/cardlens --ref loop/12-x`),
  ps(`gh api -X POST repos/vekbui96/cardlens/actions/runs/123/rerun-failed-jobs`),
  ps(`gh api repos/vekbui96/cardlens/actions/runs/123/rerun --method POST`),
  ps(`${S}\\gate-rules.ps1`),
  ps(`${S}\\test-gate-rules.ps1`),
  ps(`${C}\\innovation\\ci-rerun.ps1 -Pr 40 -Issue 12 -RunId 1`),
  ps(`gh pr create -R vekbui96/cardlens --base main --head feature --title x --body-file "${W}\\pr.md"`),
  // git
  ps(`git -C "${C}" push origin main`),
  ps(`git -C "${C}" push --force origin loop/12-x`),
  ps(`git -C "${C}" push origin loop/12-x:main`),
  ps(`git -C "${C}" add -A`),
  ps(`git -C "${C}" add .`),
  ps(`git -C "${C}" commit -m "x"`),
  ps(`git -C "${C}" worktree add ../wt`),
  ps(`git -C "${C}" config --global user.name x`),
  ps(`git -C "${C}" remote set-url origin git@github.com:someone/else.git`),
  ps(`git -C D:\\projects\\cardlens status`),
  ps(`git status`),
  // tools / interpreters / chaining
  ps(`npm.cmd ci`),
  ps(`npx playwright test`),
  ps(`node -e "1"`),
  ps(`cmd /c dir`),
  ps(`powershell -File ${S}\\deploy.ps1`),
  ps(`${S}\\deploy-server.ps1 -TargetSha 0123456789abcdef0123456789abcdef01234567`),
  ps(`${S}\\elevated-task.ps1`),
  ps(`${S}\\run-loop.ps1`),
  ps(`${S}\\install-task.ps1`),
  ps(`C:\\temp\\evil.ps1`),
  ps(`git -C "${C}" status; Remove-Item C:\\x`),
  ps(`git -C "${C}" status && gh pr merge 1 -R vekbui96/cardlens`),
  ps(`Get-Content x | Remove-Item`),
  ps(`Get-ChildItem "${C}" | ForEach-Object { node x }`),
  ps(`Get-ChildItem "${C}" | Where-Object { Remove-Item C:\\x }`),
  ps(`& node x`),
  ps(`C:\\Windows\\System32\\cmd.exe /c dir`),
  ps(`Write-Output "$(Remove-Item C:\\x)"`),
  ps(`cd D:\\services`),
  ps(`Invoke-Expression "Get-Date"`),
  ps(`Stop-Process -Id 4`),
  ps(`docker run --rm alpine`),
  ps(`Remove-Item D:\\projects\\cardlens\\README.md`),
  ps(`New-Item -ItemType File "${HOME}\\elevated\\request.json"`),
  // protected paths and content
  {
    tool_name: "Edit",
    tool_input: { file_path: `${C}\\src\\scan\\phash.ts`, old_string: "a", new_string: "b" },
  },
  {
    tool_name: "Edit",
    tool_input: { file_path: `${C}\\playwright.config.ts`, old_string: "a", new_string: "b" },
  },
  {
    tool_name: "Edit",
    tool_input: { file_path: `${C}\\.github\\workflows\\ci.yml`, old_string: "a", new_string: "b" },
  },
  { tool_name: "Write", tool_input: { file_path: `${C}\\innovation\\LOOP.md`, content: "x" } },
  { tool_name: "Write", tool_input: { file_path: `${S}\\guard.mjs`, content: "x" } },
  // FOCUS.md is Ve's steering: read-only to the loop, in the pinned scripts dir and in the clone
  { tool_name: "Write", tool_input: { file_path: `${S}\\FOCUS.md`, content: "x" } },
  { tool_name: "Edit", tool_input: { file_path: `${S}\\FOCUS.md`, old_string: "a", new_string: "b" } },
  { tool_name: "Write", tool_input: { file_path: `${C}\\innovation\\FOCUS.md`, content: "x" } },
  {
    tool_name: "Edit",
    tool_input: { file_path: `${C}\\innovation\\FOCUS.md`, old_string: "a", new_string: "b" },
  },
  ps(`Set-Content "${S}\\FOCUS.md" x`),
  ps(`Remove-Item "${S}\\FOCUS.md"`),
  ps(`Copy-Item "${W}\\f.md" "${C}\\innovation\\FOCUS.md"`),
  ps(`Write-Output x > "${S}\\FOCUS.md"`),
  { tool_name: "Write", tool_input: { file_path: `${HOME}\\elevated\\request.json`, content: "{}" } },
  { tool_name: "Write", tool_input: { file_path: `${HOME}\\state\\deploy-12.json`, content: "{}" } },
  {
    tool_name: "Edit",
    tool_input: {
      file_path: `${C}\\server\\index.ts`,
      old_string: "a",
      new_string: 'const F = "D:/services/data/collection.json"',
    },
  },
  {
    tool_name: "Edit",
    tool_input: {
      file_path: `${C}\\src\\app\\x.ts`,
      old_string: "a",
      new_string: "import.meta.env.VITE_COLLECTION_TOKEN",
    },
  },
  { tool_name: "Write", tool_input: { file_path: "D:\\projects\\cardlens\\src\\x.ts", content: "x" } },
  { tool_name: "WebFetch", tool_input: { url: "https://evil.example/", prompt: "x" } },
  {
    tool_name: "WebFetch",
    tool_input: { url: "https://server-pc.tail0e4194.ts.net:8443/api/collection", prompt: "x" },
  },
  { tool_name: "WebSearch", tool_input: { query: "x" } },
  // PRODUCT.md is Ve's, read-only (like FOCUS.md); the review label is only for the review run
  { tool_name: "Write", tool_input: { file_path: `${S}\\PRODUCT.md`, content: "x" } },
  { tool_name: "Edit", tool_input: { file_path: `${S}\\PRODUCT.md`, old_string: "a", new_string: "b" } },
  { tool_name: "Write", tool_input: { file_path: `${C}\\innovation\\PRODUCT.md`, content: "x" } },
  ps(
    `gh issue create -R vekbui96/cardlens --title "Product review" --label loop:product-review --body-file "${W}\\r.md"`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:proposal --label device-feedback --body-file "${W}\\p.md"`,
  ),
  // specs: always a proposal too; never added, removed or approved by edit; no other labels on create
  ps(`gh issue create -R vekbui96/cardlens --title "Spec: x" --label loop:spec --body-file "${W}\\spec.md"`),
  ps(`gh issue edit 70 -R vekbui96/cardlens --add-label loop:spec`),
  ps(`gh issue edit 70 -R vekbui96/cardlens --remove-label loop:spec`),
  ps(`gh issue edit 70 -R vekbui96/cardlens --add-label size:small`),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:proposal,approved --body-file "${W}\\p.md"`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:proposal --label area:server --body-file "${W}\\p.md"`,
  ),
  ps(`gh issue edit 70 -R vekbui96/cardlens --body-file "${W}\\checklist.md"`),
  ps(`gh api repos/vekbui96/cardlens/issues/comments/99 -X PATCH --input "${W}\\spec.json"`),
  // sessions.json (models, caps) is Ve's, like FOCUS.md
  { tool_name: "Write", tool_input: { file_path: `${S}\\sessions.json`, content: "{}" } },
  {
    tool_name: "Edit",
    tool_input: { file_path: `${C}\\innovation\\sessions.json`, old_string: "a", new_string: "b" },
  },
  // wait-ci only from the pinned scripts dir; CI is never watched or re-run by hand
  ps(`${C}\\innovation\\wait-ci.ps1 -Pr 40`),
  ps(`gh pr checks 40 -R vekbui96/cardlens --watch`),
  // metrics: GET the summary only; the ingest route is the device's (POST, behind the token)
  ps(`Invoke-RestMethod -Method Post "https://server-pc.tail0e4194.ts.net:8443/api/metrics" -Body '{}'`),
  ps(`Invoke-RestMethod "https://server-pc.tail0e4194.ts.net:8443/api/metrics"`),
  {
    tool_name: "WebFetch",
    tool_input: { url: "https://server-pc.tail0e4194.ts.net:8443/api/metrics", prompt: "x" },
  },
];

// the weekly product review (MODE=PRODUCT_REVIEW): read-only research plus ONE review issue
const reviewEnv = { ...env, INNOVATION_LOOP_CARDLENS_MODE: "PRODUCT_REVIEW" };
const reviewAllow = [
  { tool_name: "Read", tool_input: { file_path: `${S}\\PRODUCT.md` } },
  ps(
    `gh issue list -R vekbui96/cardlens --label device-feedback --state open --author vekbui96 --json number,title,body`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Product review 2026-11-22" --label loop:product-review --body-file "${W}\\r.md"`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Measure chroma hash" --label loop:proposal --body-file "${W}\\p.md"`,
  ),
  ps(`Invoke-RestMethod https://server-pc.tail0e4194.ts.net:8443/api/health`),
  ps(`${S}\\check-approval.ps1 -List`),
];
const reviewDeny = [
  ps(`${S}\\test-gate.ps1 -Issue 12 -Step all`),
  ps(`${S}\\merge-pr.ps1 -Pr 40 -Issue 12`),
  ps(`${S}\\deploy.ps1 -Issue 12 -MergeSha 0123456789abcdef0123456789abcdef01234567`),
  ps(`${S}\\update-snapshots.ps1 -Issue 12`),
  ps(`git -C "${C}" push -u origin loop/12-x`),
  ps(`git -C "${C}" commit -F "${W}\\m.txt"`),
  ps(`git -C "${C}" checkout -b loop/12-x origin/main`),
  ps(`gh pr create -R vekbui96/cardlens --base main --head loop/12-x --title x --body-file "${W}\\pr.md"`),
  ps(`gh issue comment 9 -R vekbui96/cardlens --body-file "${W}\\c.md"`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --add-label loop:in-progress`),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:product-review --label loop:proposal --body-file "${W}\\r.md"`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:product-review --label approved --body-file "${W}\\r.md"`,
  ),
  { tool_name: "Write", tool_input: { file_path: `${S}\\PRODUCT.md`, content: "x" } },
];

// a build session (MODE=BUILD) builds its one issue; it opens no issues
const buildEnv = { ...env, INNOVATION_LOOP_CARDLENS_MODE: "BUILD" };
const buildAllow = [
  ps(`${S}\\wait-ci.ps1 -Pr 40`),
  ps(`${S}\\merge-pr.ps1 -Pr 40 -Issue 12`),
  ps(`${S}\\test-gate.ps1 -Issue 12 -Step all -ExpectString "Open binder"`),
  ps(`git -C "${C}" push -u origin loop/12-binder-hint`),
  ps(`gh issue comment 12 -R vekbui96/cardlens --body-file "${W}\\c.md"`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --add-label loop:in-progress`),
];
const buildDeny = [
  ps(`gh issue create -R vekbui96/cardlens --title x --label loop:proposal --body-file "${W}\\p.md"`),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:proposal --label loop:spec --body-file "${W}\\s.md"`,
  ),
];
// a proposal session (MODE=PROPOSE): read-only research, then proposals, slices and at most one spec
const proposeEnv = { ...env, INNOVATION_LOOP_CARDLENS_MODE: "PROPOSE" };
const proposeAllow = [
  ps(`${S}\\check-approval.ps1 -Slots`),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Spec: faster shop mode" --label loop:proposal --label loop:spec --body-file "${W}\\spec.md"`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Shop mode: one-tap add" --label loop:proposal --label size:small --body-file "${W}\\s2.md"`,
  ),
  ps(
    `gh issue list -R vekbui96/cardlens --label loop:proposal --state all --json number,title,state,labels --limit 200`,
  ),
  {
    tool_name: "WebFetch",
    tool_input: { url: "https://server-pc.tail0e4194.ts.net:8443/api/metrics/summary?days=30", prompt: "x" },
  },
  {
    tool_name: "Write",
    tool_input: { file_path: `${W}\\spec.md`, content: "<!-- innovation-loop -->\n## Problem and evidence" },
  },
];
const proposeDeny = [
  ps(`${S}\\wait-ci.ps1 -Pr 40`),
  ps(`${S}\\test-gate.ps1 -Issue 12 -Step all`),
  ps(`${S}\\merge-pr.ps1 -Pr 40 -Issue 12`),
  ps(`${S}\\progress.ps1 -Issue 12 -Stage plan`),
  ps(`git -C "${C}" commit -F "${W}\\m.txt"`),
  ps(`git -C "${C}" push -u origin loop/12-x`),
  ps(`gh issue comment 70 -R vekbui96/cardlens --body-file "${W}\\c.md"`),
  ps(`gh issue edit 12 -R vekbui96/cardlens --add-label loop:in-progress`),
  ps(`gh issue close 70 -R vekbui96/cardlens`),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Product review" --label loop:product-review --body-file "${W}\\r.md"`,
  ),
];
reviewAllow.push(
  ps(
    `gh issue create -R vekbui96/cardlens --title "Spec: scanner gap" --label loop:proposal --label loop:spec --body-file "${W}\\spec.md"`,
  ),
);
reviewDeny.push(
  ps(`${S}\\wait-ci.ps1 -Pr 40`),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:product-review --label loop:spec --body-file "${W}\\r.md"`,
  ),
);

// the intake session (MODE=INTAKE) plans ONE of Ve's requests (#170 here): read-only research, proposals or a
// spec that start with the loop marker and say "From request #170", one comment / needs-info / declined on #170
const intakeEnv = {
  ...env,
  INNOVATION_LOOP_CARDLENS_MODE: "INTAKE",
  INNOVATION_LOOP_CARDLENS_REQUEST: "170",
};
const tmp = mkdtempSync(path.join(os.tmpdir(), "guard-intake-"));
const bodyFile = (name, text) => {
  const p = path.join(tmp, name);
  writeFileSync(p, text, "utf8");
  return p;
};
const goodBody = bodyFile(
  "good.md",
  "<!-- innovation-loop -->\nFrom request #170\n\n## Problem and evidence\nx\n",
);
const wrongReq = bodyFile("wrong.md", "<!-- innovation-loop -->\nFrom request #171\n\n## Problem\nx\n");
const noMarker = bodyFile("nomarker.md", "From request #170\n\n## Problem\nx\n");
const noLink = bodyFile("nolink.md", "<!-- innovation-loop -->\n## Problem\nx\n");
const intakeAllow = [
  ps(`${S}\\check-approval.ps1 -List`),
  ps(`gh issue view 170 -R vekbui96/cardlens --json title,body,labels,comments`),
  ps(`gh issue list -R vekbui96/cardlens --label loop:request --state open --json number`),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Settings: show build SHA" --label loop:proposal --label size:small --body-file "${goodBody}"`,
  ),
  ps(
    `gh issue create -R vekbui96/cardlens --title "Spec: x" --label loop:proposal --label loop:spec --body-file "${goodBody}"`,
  ),
  ps(`gh issue comment 170 -R vekbui96/cardlens --body-file "${W}\\q.md"`),
  ps(`gh issue edit 170 -R vekbui96/cardlens --add-label loop:needs-info`),
  ps(`gh issue edit 170 -R vekbui96/cardlens --add-label loop:declined`),
  ps(`git -C "${C}" log --oneline -5`),
  { tool_name: "Read", tool_input: { file_path: `${C}\\src\\app\\App.tsx` } },
  { tool_name: "Write", tool_input: { file_path: `${W}\\q.md`, content: "One question: which screen?" } },
];
const intakeDeny = [
  // never a request: no filing, labelling or editing of loop:request issues, and never loop:planned
  ps(`gh issue create -R vekbui96/cardlens --title x --label loop:request --body-file "${goodBody}"`),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:proposal,loop:request --body-file "${goodBody}"`,
  ),
  ps(`gh issue edit 170 -R vekbui96/cardlens --remove-label loop:request`),
  ps(`gh issue edit 170 -R vekbui96/cardlens --add-label loop:planned`),
  ps(`gh issue edit 170 -R vekbui96/cardlens --body-file "${W}\\b.md"`),
  ps(`gh issue edit 170 -R vekbui96/cardlens --title "x"`),
  ps(`gh api repos/vekbui96/cardlens/issues/170 -X PATCH --input "${W}\\b.json"`),
  // never approved, never labels outside its two, never on another issue
  ps(`gh issue edit 171 -R vekbui96/cardlens --add-label approved`),
  ps(`gh issue edit 170 -R vekbui96/cardlens --add-label approved`),
  ps(`gh issue edit 170 -R vekbui96/cardlens --add-label loop:in-progress`),
  ps(`gh issue edit 170 -R vekbui96/cardlens --remove-label loop:needs-info`),
  ps(`gh issue edit 171 -R vekbui96/cardlens --add-label loop:needs-info`),
  ps(`gh issue comment 171 -R vekbui96/cardlens --body-file "${W}\\q.md"`),
  ps(`gh issue close 170 -R vekbui96/cardlens`),
  ps(
    `gh issue create -R vekbui96/cardlens --title x --label loop:proposal --label approved --body-file "${goodBody}"`,
  ),
  // what it opens must say "From request #170" and start with the loop marker
  ps(`gh issue create -R vekbui96/cardlens --title x --label loop:proposal --body-file "${wrongReq}"`),
  ps(`gh issue create -R vekbui96/cardlens --title x --label loop:proposal --body-file "${noMarker}"`),
  ps(`gh issue create -R vekbui96/cardlens --title x --label loop:proposal --body-file "${noLink}"`),
  ps(`gh issue create -R vekbui96/cardlens --title x --label loop:proposal --body-file "${W}\\missing.md"`),
  ps(`gh issue create -R vekbui96/cardlens --title x --label loop:product-review --body-file "${goodBody}"`),
  // read-only: no code, no builds, no PRs
  ps(`git -C "${C}" commit -F "${W}\\m.txt"`),
  ps(`git -C "${C}" push -u origin loop/170-x`),
  ps(`${S}\\test-gate.ps1 -Issue 170 -Step all`),
  ps(`gh pr create -R vekbui96/cardlens --head loop/170-x --title x --body-file "${W}\\p.md"`),
];
// the product store is the runner's: no session reads or writes it, nobody writes `confirmed`
const storeDeny = [
  {
    tool_name: "Write",
    tool_input: {
      file_path: "D:\\hub\\state\\product\\cardlens\\preferences.json",
      content: '{"items":[{"id":"p-abc123","statement":"x","status":"confirmed"}]}',
    },
  },
  { tool_name: "Read", tool_input: { file_path: "D:\\hub\\state\\product\\cardlens\\decisions.jsonl" } },
  ps(`Set-Content -Path "D:\\hub\\state\\product\\cardlens\\preferences.json" -Value x`),
  ps(`Get-Content "D:\\hub\\state\\product\\cardlens\\preferences.json"`),
  {
    tool_name: "Write",
    tool_input: {
      file_path: `${W}\\prefs.json`,
      content: '{"statement":"Ve wants dark mode","status":"confirmed"}',
    },
  },
];
// the memory agent has no tools at all
const memoryEnv = { ...env, INNOVATION_LOOP_CARDLENS_MODE: "MEMORY" };
const memoryDeny = [
  { tool_name: "Read", tool_input: { file_path: `${C}\\src\\app\\App.tsx` } },
  ps(`gh issue list -R vekbui96/cardlens --state open --json number`),
  { tool_name: "Write", tool_input: { file_path: `${W}\\x.md`, content: "x" } },
];

let failures = 0;
for (const [name, e, list, want] of [
  ["build", buildEnv, buildAllow, 0],
  ["build", buildEnv, buildDeny, 2],
  ["propose", proposeEnv, proposeAllow, 0],
  ["propose", proposeEnv, proposeDeny, 2],
  ["intake", intakeEnv, intakeAllow, 0],
  ["intake", intakeEnv, intakeDeny, 2],
  ["store (full)", env, storeDeny, 2],
  ["store (intake)", intakeEnv, storeDeny, 2],
  ["memory", memoryEnv, memoryDeny, 2],
]) {
  for (const c of list) {
    const r = run(c, e);
    if (r.code !== want) {
      failures++;
      console.log(
        `FAIL (${name} session, should ${want ? "deny" : "allow"}) ${JSON.stringify(c.tool_input).slice(0, 110)}\n   -> ${r.err}`,
      );
    }
  }
}
function run(c, e = env) {
  const r = spawnSync(process.execPath, [path.join(here, "guard.mjs")], {
    input: JSON.stringify(c),
    env: e,
    encoding: "utf8",
  });
  return { code: r.status, err: (r.stderr || "").trim() };
}
for (const c of reviewAllow) {
  const r = run(c, reviewEnv);
  if (r.code !== 0) {
    failures++;
    console.log(
      `FAIL (review mode, should allow) ${JSON.stringify(c.tool_input).slice(0, 110)}\n   -> ${r.err}`,
    );
  }
}
for (const c of reviewDeny) {
  if (run(c, reviewEnv).code !== 2) {
    failures++;
    console.log(`FAIL (review mode, should deny)  ${JSON.stringify(c.tool_input).slice(0, 110)}`);
  }
}
const label = (c) => `${c.tool_name} ${JSON.stringify(c.tool_input).slice(0, 110)}`;
for (const c of allow) {
  const r = run(c);
  if (r.code !== 0) {
    failures++;
    console.log(`FAIL (should allow) ${label(c)}\n   -> ${r.err}`);
  }
}
for (const c of deny) {
  const r = run(c);
  if (r.code !== 2) {
    failures++;
    console.log(`FAIL (should deny)  ${label(c)}`);
  }
}
const nullInput = run({ tool_name: "PowerShell", tool_input: null });
if (nullInput.code !== 0 && nullInput.code !== 2) {
  failures++;
  console.log("FAIL: null tool_input crashed the guard");
}
const garbage = spawnSync(process.execPath, [path.join(here, "guard.mjs")], {
  input: "not json",
  env,
  encoding: "utf8",
});
if (garbage.status !== 2) {
  failures++;
  console.log("FAIL: unparsable input must block");
}
console.log(
  `${allow.length} allow cases, ${deny.length} deny cases, ${reviewAllow.length + reviewDeny.length} review-mode, ${buildAllow.length + buildDeny.length} build-session and ${proposeAllow.length + proposeDeny.length} proposal-session, ${intakeAllow.length + intakeDeny.length} intake-session, ${storeDeny.length * 2} product-store and ${memoryDeny.length} memory cases, ${failures} failure(s)`,
);
process.exit(failures ? 1 : 0);
